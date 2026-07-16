import type { ConnectionState } from "@tooled-voice/shared";
import {
  type MediaStream,
  type MediaStreamTrack,
  mediaDevices,
  RTCPeerConnection,
  RTCSessionDescription,
} from "react-native-webrtc";
import {
  ApiClientError,
  createRealtimeCredential,
  executeTool,
  finishConversation,
  persistConversationItem,
} from "../api/client";
import {
  type AudioRoute,
  type AudioSessionEvent,
  setSpeakerRoute,
  startAudioSession,
  stopAudioSession,
} from "./audio-session";

const nonRetryableConnectionErrorPattern =
  /MICROPHONE|PERMISSION|NOT.?ALLOWED|AUTH_REQUIRED|AUTH_INVALID/i;

const readOnlyMcpToolPattern =
  /(^|_)(get|list|search|find|read|fetch|retrieve)(_|$)/i;

export interface VoiceDiagnostic {
  at: number;
  detail?: string;
  elapsedMs?: number;
  event: string;
  id: string;
}

export interface McpApproval {
  arguments: string;
  id: string;
  name: string;
  serverLabel: string;
}

type Listener = (event: {
  state?: ConnectionState;
  muted?: boolean;
  speaker?: boolean;
  route?: AudioRoute;
  diagnostic?: VoiceDiagnostic;
  transcript?: {
    id: string;
    role: "user" | "assistant";
    text: string;
    final: boolean;
  };
  mcpApproval?: McpApproval | null;
  error?: string;
}) => void;

interface Events {
  addEventListener: (
    type: string,
    listener: (event: { data?: unknown; streams?: MediaStream[] }) => void
  ) => void;
}

type Channel = Events & {
  readyState: string;
  send: (data: string) => void;
  close: () => void;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const nestedString = (value: unknown, key: string): string | undefined => {
  if (!isRecord(value)) {
    return;
  }

  const nested = value[key];

  return typeof nested === "string" ? nested : undefined;
};

export class RealtimeClient {
  private pc: RTCPeerConnection | undefined;
  private channel: Channel | undefined;
  private stream: MediaStream | undefined;
  private microphone: MediaStreamTrack | undefined;
  private remote: MediaStream | undefined;
  private conversationId: string | undefined;
  private toolApprovalPolicies: Record<string, "ask" | "automatic"> = {};
  private closed: boolean;
  private retries: number;
  private responseActive: boolean;
  private userSpeaking: boolean;
  private desiredMuted: boolean;
  private speaker: boolean;
  private route: AudioRoute = "speaker";
  private vadEagerness: "auto" | "high" = "high";
  private reconnecting: boolean;
  private openTimer: ReturnType<typeof setTimeout> | undefined;
  private statsTimer: ReturnType<typeof setInterval> | undefined;
  private statsReading: boolean;
  private lastInboundAudioBytes: number;
  private readonly streamingTranscripts = new Map<string, string>();
  private readonly mcpStarted = new Map<string, number>();
  private connectStarted: number;
  private speechStoppedAt: number;
  private responseCreatedAt: number;
  private firstAudioSeen: boolean;
  private diagnosticId: number;

  private readonly listener: Listener;

  constructor(listener: Listener, conversationId?: string) {
    this.closed = false;
    this.connectStarted = 0;
    this.conversationId = conversationId;
    this.desiredMuted = false;
    this.diagnosticId = 0;
    this.firstAudioSeen = false;
    this.lastInboundAudioBytes = 0;
    this.listener = listener;
    this.reconnecting = false;
    this.responseActive = false;
    this.responseCreatedAt = 0;
    this.retries = 0;
    this.speaker = true;
    this.speechStoppedAt = 0;
    this.statsReading = false;
    this.userSpeaking = false;
  }

  setConversationIfUnset(conversationId: string) {
    this.conversationId ??= conversationId;
  }

  private state(state: ConnectionState) {
    this.listener({ state });
  }

  private diagnostic(event: string, elapsedMs?: number, detail?: string) {
    this.diagnosticId += 1;

    const diagnostic = {
      at: Date.now(),
      event,
      id: String(this.diagnosticId),
      ...(elapsedMs === undefined ? {} : { elapsedMs: Math.round(elapsedMs) }),
      ...(detail ? { detail } : {}),
    };

    console.info(
      JSON.stringify({ scope: "tooled-voice/realtime", ...diagnostic })
    );

    this.listener({ diagnostic });
  }

  private audioEvent(event: AudioSessionEvent) {
    if (event.route) {
      this.route = event.route;
      this.speaker = event.route === "speaker";
      this.listener({ route: event.route, speaker: this.speaker });
    }

    this.diagnostic(event.event, undefined, event.detail);
  }

  async connect(reconnecting = false): Promise<void> {
    this.closed = false;
    this.connectStarted = performance.now();
    this.diagnostic(reconnecting ? "reconnect_started" : "connect_started");

    if (reconnecting) {
      this.state("reconnecting");
    }

    try {
      const credentialStarted = performance.now();
      const credential = await createRealtimeCredential(this.conversationId);

      this.conversationId = credential.conversationId;
      this.toolApprovalPolicies = credential.toolApprovalPolicies ?? {};

      this.diagnostic(
        "credential_ready",
        performance.now() - credentialStarted,
        credential.model
      );

      this.state("connecting");

      const audioSessionStarted = performance.now();

      await startAudioSession((event) => this.audioEvent(event));

      this.diagnostic(
        "native_audio_ready",
        performance.now() - audioSessionStarted
      );

      const microphoneStarted = performance.now();

      const stream = await mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      this.stream = stream;

      this.diagnostic(
        "microphone_ready",
        performance.now() - microphoneStarted
      );

      const [microphone] = stream.getAudioTracks();

      if (!microphone) {
        throw new Error("MICROPHONE_UNAVAILABLE");
      }

      microphone.enabled = false;
      this.microphone = microphone;

      const pc = new RTCPeerConnection();

      this.pc = pc;

      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }

      const pcEvents = pc as unknown as Events;

      pcEvents.addEventListener("track", (event) => {
        this.remote = event.streams?.[0];
      });

      pcEvents.addEventListener("connectionstatechange", () => {
        if (
          this.pc === pc &&
          ["failed", "disconnected"].includes(pc.connectionState)
        ) {
          this.reconnect().catch(() => undefined);
        }
      });

      const channel = pc.createDataChannel("oai-events") as unknown as Channel;

      this.channel = channel;

      channel.addEventListener("message", (event) =>
        this.onEvent(event.data).catch(() => undefined)
      );

      channel.addEventListener("open", () => {
        if (this.openTimer) {
          clearTimeout(this.openTimer);
        }

        this.openTimer = undefined;
        this.retries = 0;
        microphone.enabled = !this.desiredMuted;

        this.listener({
          muted: this.desiredMuted,
          route: this.route,
          speaker: this.speaker,
        });

        this.setVadEagerness(this.vadEagerness);

        this.diagnostic(
          "channel_open",
          performance.now() - this.connectStarted
        );

        this.state("connected");
      });

      channel.addEventListener("error", () => {
        this.diagnostic("channel_error");

        if (this.channel === channel) {
          this.reconnect().catch(() => undefined);
        }
      });

      channel.addEventListener("close", () => {
        this.diagnostic("channel_closed");

        if (this.channel === channel) {
          this.reconnect().catch(() => undefined);
        }
      });

      const negotiationStarted = performance.now();
      const offer = await pc.createOffer({ offerToReceiveAudio: true });

      await pc.setLocalDescription(offer);

      const response = await fetch("https://api.openai.com/v1/realtime/calls", {
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${credential.clientSecret}`,
          "Content-Type": "application/sdp",
        },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`WEBRTC_NEGOTIATION_${response.status}`);
      }

      await pc.setRemoteDescription(
        new RTCSessionDescription({
          sdp: await response.text(),
          type: "answer",
        })
      );

      this.diagnostic(
        "webrtc_negotiated",
        performance.now() - negotiationStarted
      );

      this.openTimer = setTimeout(() => {
        if (channel.readyState !== "open") {
          this.reconnect().catch(() => undefined);
        }
      }, 15_000);
    } catch (error) {
      this.cleanup(false);

      if (
        isRetryableConnectionError(error) &&
        this.retries < 4 &&
        !this.closed
      ) {
        return this.retry();
      }

      this.fail(error instanceof Error ? error.message : "CONNECTION_FAILED");
    }
  }

  setMuted(muted: boolean) {
    this.desiredMuted = muted;

    if (this.microphone) {
      this.microphone.enabled = !muted;
    }

    this.listener({ muted });
  }

  setSpeaker(speaker: boolean) {
    this.speaker = speaker;
    setSpeakerRoute(speaker, (event) => this.audioEvent(event));
    this.listener({ route: this.route, speaker });
  }

  setVadEagerness(eagerness: "auto" | "high") {
    this.vadEagerness = eagerness;

    this.send({
      session: {
        audio: {
          input: {
            turn_detection: {
              create_response: true,
              eagerness,
              interrupt_response: true,
              type: "semantic_vad",
            },
          },
        },
        type: "realtime",
      },
      type: "session.update",
    });

    this.diagnostic("vad_eagerness", undefined, eagerness);
  }

  respondToMcpApproval(approvalRequestId: string, approve: boolean) {
    this.send({
      item: {
        approval_request_id: approvalRequestId,
        approve,
        type: "mcp_approval_response",
        ...(approve ? {} : { reason: "The user declined this action." }),
      },
      type: "conversation.item.create",
    });

    this.listener({ mcpApproval: null });
    this.diagnostic(approve ? "mcp_action_approved" : "mcp_action_declined");
  }

  private send(event: Record<string, unknown>) {
    if (this.channel?.readyState === "open") {
      this.channel.send(JSON.stringify(event));
    }
  }

  private async inboundAudioBytes() {
    if (!this.pc) {
      return 0;
    }

    const stats = await this.pc.getStats();
    let bytes = 0;

    for (const report of stats.values()) {
      if (
        report?.type === "inbound-rtp" &&
        (report.kind === "audio" || report.mediaType === "audio") &&
        typeof report.bytesReceived === "number"
      ) {
        bytes += report.bytesReceived;
      }
    }

    return bytes;
  }

  private async startResponseAudioMonitoring() {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
    }

    try {
      this.lastInboundAudioBytes = await this.inboundAudioBytes();
    } catch {
      // Stats are optional diagnostics and may be unavailable initially.
    }

    this.statsTimer = setInterval(
      () => this.readInboundAudio().catch(() => undefined),
      100
    );
  }

  private async readInboundAudio() {
    if (!this.pc || this.statsReading || !this.responseActive) {
      return;
    }

    this.statsReading = true;

    try {
      const bytes = await this.inboundAudioBytes();

      if (!this.firstAudioSeen && bytes > this.lastInboundAudioBytes) {
        this.firstAudioSeen = true;

        if (this.statsTimer) {
          clearInterval(this.statsTimer);
        }

        this.statsTimer = undefined;

        this.diagnostic(
          "first_audio",
          this.speechStoppedAt
            ? performance.now() - this.speechStoppedAt
            : undefined,
          this.responseCreatedAt
            ? `model_ms=${Math.round(performance.now() - this.responseCreatedAt)}`
            : undefined
        );
      }

      this.lastInboundAudioBytes = Math.max(this.lastInboundAudioBytes, bytes);
    } catch {
      // A transient stats failure must not interrupt response audio.
    } finally {
      this.statsReading = false;
    }
  }

  private persist(item: Parameters<typeof persistConversationItem>[1]) {
    if (this.conversationId) {
      persistConversationItem(this.conversationId, item).catch(() =>
        this.listener({ error: "HISTORY_PERSIST_FAILED" })
      );
    }
  }

  private async onEvent(raw: unknown) {
    if (typeof raw !== "string") {
      return;
    }

    let event: unknown;

    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }

    if (!isRecord(event) || typeof event.type !== "string") {
      return;
    }

    const eventType: string = event.type;

    if (this.handleVoiceEvent(eventType, event)) {
      return;
    }

    await this.handleIntegrationEvent(eventType, event);
  }

  private handleVoiceEvent(
    eventType: string,
    event: Record<string, unknown>
  ): boolean {
    switch (eventType) {
      case "input_audio_buffer.speech_started":
        if (this.responseActive) {
          this.diagnostic("interruption_detected");
        }
        this.userSpeaking = true;
        this.diagnostic("speech_started");
        this.state("listening");
        return true;

      case "input_audio_buffer.speech_stopped":
        this.userSpeaking = false;
        this.speechStoppedAt = performance.now();
        this.diagnostic("speech_stopped");
        this.state("thinking");
        return true;

      default:
        if (this.handleTranscriptionEvent(eventType, event)) {
          return true;
        }
        return this.handleResponseEvent(eventType, event);
    }
  }

  private handleTranscriptionEvent(
    eventType: string,
    event: Record<string, unknown>
  ): boolean {
    switch (eventType) {
      case "conversation.item.input_audio_transcription.delta":
        this.transcriptDelta(event, "user");
        return true;

      case "conversation.item.input_audio_transcription.completed":
        this.transcriptDone(event, "user");
        return true;

      case "conversation.item.input_audio_transcription.failed":
        this.diagnostic(
          "transcription_failed",
          undefined,
          nestedString(event.error, "code")
        );
        this.listener({
          error: nestedString(event.error, "code") ?? "TRANSCRIPTION_FAILED",
        });
        return true;

      case "response.output_audio_transcript.delta":
        this.transcriptDelta(event, "assistant");
        return true;

      case "response.audio_transcript.done":
      case "response.output_audio_transcript.done":
        this.transcriptDone(event, "assistant");
        return true;

      default:
        return false;
    }
  }

  private handleResponseEvent(
    eventType: string,
    event: Record<string, unknown>
  ): boolean {
    switch (eventType) {
      case "response.created":
        this.responseActive = true;
        this.responseCreatedAt = performance.now();
        this.firstAudioSeen = false;
        this.startResponseAudioMonitoring().catch(() => undefined);
        this.diagnostic(
          "response_created",
          this.speechStoppedAt
            ? this.responseCreatedAt - this.speechStoppedAt
            : undefined
        );
        if (!this.userSpeaking) {
          this.state("thinking");
        }
        return true;

      case "response.audio.delta":
      case "response.output_audio.delta":
        if (!this.firstAudioSeen) {
          this.firstAudioSeen = true;

          this.diagnostic(
            "first_audio",
            this.speechStoppedAt
              ? performance.now() - this.speechStoppedAt
              : undefined,
            this.responseCreatedAt
              ? `model_ms=${Math.round(performance.now() - this.responseCreatedAt)}`
              : undefined
          );
        }
        if (!this.userSpeaking) {
          this.state("speaking");
        }
        return true;

      case "response.done":
        this.finishResponse(event);
        return true;

      default:
        return false;
    }
  }

  private finishResponse(event: Record<string, unknown>) {
    this.responseActive = false;

    if (this.statsTimer) {
      clearInterval(this.statsTimer);
    }

    this.statsTimer = undefined;

    this.diagnostic(
      "response_done",
      this.responseCreatedAt
        ? performance.now() - this.responseCreatedAt
        : undefined,
      nestedString(event.response, "status")
    );

    this.state(this.userSpeaking ? "listening" : "connected");
  }

  private async handleIntegrationEvent(
    eventType: string,
    event: Record<string, unknown>
  ) {
    switch (eventType) {
      case "response.function_call_arguments.done":
        await this.handleTool(event);
        break;

      case "mcp_list_tools.in_progress":
        this.diagnostic("linear_tools_loading");
        break;

      case "mcp_list_tools.completed":
        this.diagnostic("linear_tools_ready");
        break;

      case "mcp_list_tools.failed":
        this.diagnostic("linear_tools_failed");
        this.listener({ error: "LINEAR_TOOLS_UNAVAILABLE" });
        break;

      case "conversation.item.done":
        this.handleMcpItem(event.item);
        break;

      case "response.mcp_call.in_progress":
        if (
          typeof event.item_id === "string" &&
          !this.mcpStarted.has(event.item_id)
        ) {
          this.mcpStarted.set(event.item_id, performance.now());
        }
        break;

      case "response.mcp_call_arguments.done":
        this.handleMcpArguments(event);
        break;

      case "response.mcp_call.failed":
        this.handleMcpFailure(event);
        break;

      case "response.output_item.done":
        if (isRecord(event.item) && event.item.type === "mcp_call") {
          this.handleMcpResult(event.item);
        }
        break;

      case "error":
        this.diagnostic(
          "realtime_error",
          undefined,
          nestedString(event.error, "code")
        );
        this.listener({
          error: nestedString(event.error, "code") ?? "REALTIME_ERROR",
        });
        break;

      default:
        break;
    }
  }

  private transcriptDelta(
    event: Record<string, unknown>,
    role: "user" | "assistant"
  ) {
    if (typeof event.item_id !== "string" || typeof event.delta !== "string") {
      return;
    }

    const text =
      (this.streamingTranscripts.get(event.item_id) ?? "") + event.delta;

    this.streamingTranscripts.set(event.item_id, text);

    this.listener({
      transcript: { final: false, id: event.item_id, role, text },
    });
  }

  private transcriptDone(
    event: Record<string, unknown>,
    role: "user" | "assistant"
  ) {
    if (
      typeof event.item_id !== "string" ||
      typeof event.transcript !== "string"
    ) {
      return;
    }

    const transcript = event.transcript.trim();

    this.streamingTranscripts.delete(event.item_id);

    this.listener({
      transcript: { final: true, id: event.item_id, role, text: transcript },
    });

    if (transcript) {
      this.persist({ kind: "transcript", role, transcript });
    }
  }

  private async handleTool(event: Record<string, unknown>) {
    if (
      typeof event.call_id !== "string" ||
      typeof event.name !== "string" ||
      typeof event.arguments !== "string"
    ) {
      return;
    }

    this.state("thinking");

    const started = performance.now();

    this.diagnostic("tool_started", undefined, event.name);

    let args: unknown;

    try {
      args = JSON.parse(event.arguments);
    } catch {
      args = null;
    }

    this.persist({
      callId: event.call_id,
      kind: "tool_call",
      payload: { arguments: args, tool: event.name },
      role: "tool",
    });

    let output: unknown;

    try {
      output = await executeTool({
        arguments: args,
        callId: event.call_id,
        tool: event.name,
        ...(this.conversationId ? { conversationId: this.conversationId } : {}),
      });
    } catch (error) {
      output = {
        callId: event.call_id,
        error: {
          code:
            error instanceof ApiClientError ? error.code : "TOOL_BRIDGE_FAILED",
          message:
            error instanceof ApiClientError
              ? error.message
              : "The tool request failed",
          retryable: error instanceof ApiClientError && error.retryable,
        },
        ok: false,
      };
    }

    this.diagnostic("tool_finished", performance.now() - started, event.name);

    this.persist({
      callId: event.call_id,
      kind: "tool_result",
      payload: output,
      role: "tool",
    });

    this.send({
      item: {
        call_id: event.call_id,
        output: JSON.stringify(output),
        type: "function_call_output",
      },
      type: "conversation.item.create",
    });

    this.send({ type: "response.create" });
  }

  private handleMcpItem(item: unknown) {
    if (!isRecord(item) || typeof item.type !== "string") {
      return;
    }

    if (item.type === "mcp_list_tools") {
      const count = Array.isArray(item.tools) ? item.tools.length : undefined;

      this.diagnostic(
        "mcp_tools_available",
        undefined,
        count === undefined ? undefined : String(count)
      );

      return;
    }

    if (
      item.type !== "mcp_approval_request" ||
      typeof item.id !== "string" ||
      typeof item.name !== "string"
    ) {
      return;
    }

    const approval = {
      arguments: typeof item.arguments === "string" ? item.arguments : "{}",
      id: item.id,
      name: item.name,
      serverLabel:
        typeof item.server_label === "string" ? item.server_label : "mcp",
    };

    const toolkit = item.name.split("_")[0]?.toLowerCase();

    if (
      isReadOnlyMcpTool(item.name) ||
      (toolkit && this.toolApprovalPolicies[toolkit] === "automatic")
    ) {
      this.diagnostic("mcp_auto_approved", undefined, item.name);
      this.respondToMcpApproval(item.id, true);
    } else {
      this.state("thinking");
      this.diagnostic("mcp_approval_required", undefined, item.name);
      this.listener({ mcpApproval: approval });
    }
  }

  private handleMcpArguments(event: Record<string, unknown>) {
    if (typeof event.item_id !== "string" || typeof event.name !== "string") {
      return;
    }

    this.mcpStarted.set(event.item_id, performance.now());

    const args = parseJson(event.arguments);

    this.diagnostic("tool_started", undefined, event.name);

    this.persist({
      callId: event.item_id,
      kind: "tool_call",
      payload: {
        arguments: args,
        provider:
          typeof event.server_label === "string" ? event.server_label : "mcp",
        tool: event.name,
      },
      role: "tool",
    });
  }

  private handleMcpFailure(event: Record<string, unknown>) {
    if (typeof event.item_id !== "string") {
      return;
    }

    const started = this.mcpStarted.get(event.item_id);

    this.mcpStarted.delete(event.item_id);

    this.diagnostic(
      "tool_finished",
      started === undefined ? undefined : performance.now() - started,
      "linear_failed"
    );

    this.persist({
      callId: event.item_id,
      kind: "tool_result",
      payload: {
        error: event.error ?? { code: "LINEAR_TOOL_FAILED" },
        ok: false,
      },
      role: "tool",
    });

    this.listener({ error: "LINEAR_TOOL_FAILED" });
  }

  private handleMcpResult(item: Record<string, unknown>) {
    if (typeof item.id !== "string") {
      return;
    }

    const started = this.mcpStarted.get(item.id);

    this.mcpStarted.delete(item.id);

    this.diagnostic(
      "tool_finished",
      started === undefined ? undefined : performance.now() - started,
      typeof item.name === "string" ? item.name : "mcp"
    );

    this.persist({
      callId: item.id,
      kind: "tool_result",
      payload: {
        ok: true,
        provider:
          typeof item.server_label === "string" ? item.server_label : "mcp",
        result: parseJson(item.output),
      },
      role: "tool",
    });
  }

  private async retry() {
    this.retries += 1;
    this.state("reconnecting");

    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.min(1000 * 2 ** (this.retries - 1), 8000) + Math.random() * 250
      )
    );

    if (!this.closed) {
      await this.connect(true);
    }
  }

  private async reconnect() {
    if (this.closed || this.reconnecting) {
      return;
    }

    if (this.retries >= 4) {
      this.fail("RECONNECT_EXHAUSTED");

      return;
    }

    this.reconnecting = true;
    this.cleanup(false);

    try {
      await this.retry();
    } finally {
      this.reconnecting = false;
    }
  }

  disconnect(complete = false) {
    this.closed = true;
    this.cleanup(true);

    if (complete) {
      this.desiredMuted = false;
      this.listener({ muted: false });
    }

    if (complete && this.conversationId) {
      finishConversation(this.conversationId, "completed").catch(() =>
        this.listener({ error: "HISTORY_PERSIST_FAILED" })
      );

      this.conversationId = undefined;
    }

    this.state("disconnected");
  }

  private fail(message: string) {
    this.state("error");
    this.listener({ error: message });

    if (this.conversationId) {
      finishConversation(this.conversationId, "failed").catch(() => undefined);
    }
  }

  private cleanup(stop = true) {
    if (this.openTimer) {
      clearTimeout(this.openTimer);
    }

    this.openTimer = undefined;

    if (this.statsTimer) {
      clearInterval(this.statsTimer);
    }

    this.statsTimer = undefined;
    this.lastInboundAudioBytes = 0;

    const { channel } = this;

    this.channel = undefined;

    try {
      channel?.close();
    } catch {
      // Data channel teardown is best-effort.
    }

    const { pc } = this;

    this.pc = undefined;

    try {
      pc?.close();
    } catch {
      // Peer connection teardown is best-effort.
    }

    for (const track of this.stream?.getTracks() ?? []) {
      try {
        track.stop();
      } catch {
        // Individual tracks can already be stopped.
      }
    }

    for (const track of this.remote?.getTracks() ?? []) {
      try {
        track.stop();
      } catch {
        // Individual tracks can already be stopped.
      }
    }

    stopAudioSession();
    this.stream = undefined;
    this.microphone = undefined;
    this.remote = undefined;
    this.userSpeaking = false;
    this.streamingTranscripts.clear();
    this.mcpStarted.clear();
    this.listener({ mcpApproval: null });

    if (stop) {
      this.responseActive = false;
    }
  }
}

function isRetryableConnectionError(error: unknown) {
  const value =
    error instanceof Error ? `${error.name}:${error.message}` : String(error);

  return !nonRetryableConnectionErrorPattern.test(value);
}

function isReadOnlyMcpTool(name: string) {
  return readOnlyMcpToolPattern.test(name);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
