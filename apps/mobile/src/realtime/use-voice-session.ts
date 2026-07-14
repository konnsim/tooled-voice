import type { ConnectionState } from "@tooled-voice/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { getLatestConversation } from "../api/client";
import type { AudioRoute } from "./audio-session";
import {
  type McpApproval,
  RealtimeClient,
  type VoiceDiagnostic,
} from "./realtime-client";
export interface Transcript {
  id: string;
  role: "user" | "assistant";
  text: string;
}
export interface VoiceSession {
  approveMcpAction: () => void;
  connect: () => Promise<void>;
  diagnostics: VoiceDiagnostic[];
  disconnect: () => void;
  error: string | undefined;
  history: Transcript[];
  mcpApproval: McpApproval | null;
  muted: boolean;
  rejectMcpAction: () => void;
  route: AudioRoute;
  speaker: boolean;
  state: ConnectionState;
  toggleMuted: () => void;
  toggleSpeaker: () => void;
  toggleVadEagerness: () => void;
  vadEagerness: "auto" | "high";
}
type ClientEvent = Parameters<
  ConstructorParameters<typeof RealtimeClient>[0]
>[0];
const mergeTranscript = (
  items: Transcript[],
  transcript: NonNullable<ClientEvent["transcript"]>
): Transcript[] => {
  const index = items.findIndex((item) => item.id === transcript.id);
  if (!transcript.text.trim()) {
    return transcript.final
      ? items.filter((item) => item.id !== transcript.id)
      : items;
  }
  const next = {
    id: transcript.id,
    role: transcript.role,
    text: transcript.text,
  };
  if (index < 0) {
    return [...items, next];
  }
  return items.map((item, itemIndex) => (itemIndex === index ? next : item));
};
const RECONNECTABLE_STATES = new Set<ConnectionState>([
  "connected",
  "listening",
  "thinking",
  "speaking",
  "reconnecting",
]);
export function useVoiceSession(): VoiceSession {
  const [state, setState] = useState<ConnectionState>("idle");
  const [muted, setMuted] = useState<boolean>(false);
  const [speaker, setSpeaker] = useState<boolean>(true);
  const [route, setRoute] = useState<AudioRoute>("speaker");
  const [vadEagerness, setVadEagerness] = useState<"auto" | "high">("high");
  const [diagnostics, setDiagnostics] = useState<VoiceDiagnostic[]>([]);
  const [history, setHistory] = useState<Transcript[]>([]);
  const [mcpApproval, setMcpApproval] = useState<McpApproval | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const listener = useRef<(event: ClientEvent) => void>(() => undefined);
  const client = useRef<RealtimeClient | undefined>(undefined);
  const mounted = useRef(true);
  const shouldReconnect = useRef(false);
  const currentState = useRef<ConnectionState>("idle");
  listener.current = (event: ClientEvent) => {
    if (!mounted.current) {
      return;
    }
    if (event.state) {
      currentState.current = event.state;
      setState(event.state);
      shouldReconnect.current ||= RECONNECTABLE_STATES.has(event.state);
    }
    if (event.muted !== undefined) {
      setMuted(event.muted);
    }
    if (event.speaker !== undefined) {
      setSpeaker(event.speaker);
    }
    if (event.route) {
      setRoute(event.route);
    }
    const { diagnostic } = event;
    if (diagnostic) {
      setDiagnostics((items) => [diagnostic, ...items].slice(0, 24));
    }
    if (event.mcpApproval !== undefined) {
      setMcpApproval(event.mcpApproval);
    }
    if (event.error) {
      setError(event.error);
    }
    const { transcript } = event;
    if (transcript) {
      setHistory((items) => mergeTranscript(items, transcript));
    }
  };
  client.current ??= new RealtimeClient((event) => listener.current(event));
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    getLatestConversation()
      .then((latest) => {
        if (disposed) {
          return;
        }
        if (latest) {
          setHistory(
            latest.items
              .filter(
                (
                  item
                ): item is typeof item & {
                  role: "user" | "assistant";
                  transcript: string;
                } =>
                  item.kind === "transcript" &&
                  item.transcript !== null &&
                  (item.role === "user" || item.role === "assistant")
              )
              .map((item) => ({
                id: item.id,
                role: item.role,
                text: item.transcript,
              }))
          );
        }
        if (latest?.status === "active") {
          client.current?.setConversationIfUnset(latest.id);
        }
      })
      .catch(() => undefined);
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") {
        if (
          shouldReconnect.current &&
          [
            "connected",
            "listening",
            "thinking",
            "speaking",
            "reconnecting",
          ].includes(currentState.current)
        ) {
          client.current?.disconnect();
        }
      } else if (
        shouldReconnect.current &&
        currentState.current === "disconnected"
      ) {
        client.current?.connect(true).catch(() => undefined);
      }
    });
    return () => {
      disposed = true;
      mounted.current = false;
      subscription.remove();
      client.current?.disconnect();
    };
  }, []);
  const connect = useCallback(async () => {
    shouldReconnect.current = true;
    setError(undefined);
    currentState.current = "authenticating";
    setState("authenticating");
    await client.current?.connect();
  }, []);
  const disconnect = useCallback(() => {
    shouldReconnect.current = false;
    client.current?.disconnect(true);
    setHistory([]);
  }, []);
  const approveMcpAction = useCallback(() => {
    if (mcpApproval) {
      client.current?.respondToMcpApproval(mcpApproval.id, true);
    }
  }, [mcpApproval]);
  const rejectMcpAction = useCallback(() => {
    if (mcpApproval) {
      client.current?.respondToMcpApproval(mcpApproval.id, false);
    }
  }, [mcpApproval]);
  const toggleMuted = useCallback(() => {
    const next = !muted;
    client.current?.setMuted(next);
    setMuted(next);
  }, [muted]);
  const toggleSpeaker = useCallback(() => {
    const next = !speaker;
    client.current?.setSpeaker(next);
    setSpeaker(next);
  }, [speaker]);
  const toggleVadEagerness = useCallback(() => {
    const next = vadEagerness === "high" ? "auto" : "high";
    client.current?.setVadEagerness(next);
    setVadEagerness(next);
  }, [vadEagerness]);
  return {
    approveMcpAction,
    connect,
    diagnostics,
    disconnect,
    error,
    history,
    mcpApproval,
    muted,
    rejectMcpAction,
    route,
    speaker,
    state,
    toggleMuted,
    toggleSpeaker,
    toggleVadEagerness,
    vadEagerness,
  };
}
