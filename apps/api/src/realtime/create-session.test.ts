import { afterEach, describe, expect, it, vi } from "vitest";
import { createRealtimeSession } from "./create-session.js";

describe("createRealtimeSession", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("creates a continuous gpt-realtime-2.1 session with semantic VAD and interruption", async () => {
    vi.stubEnv("OPENAI_API_KEY", "server-key");
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          expires_at: 123,
          session: { id: "sess_1" },
          value: "ephemeral",
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(
      createRealtimeSession("user-1", AbortSignal.timeout(1000))
    ).resolves.toMatchObject({
      clientSecret: "ephemeral",
      model: "gpt-realtime-2.1",
      sessionId: "sess_1",
    });
    const [call] = fetcher.mock.calls;
    if (!call) {
      throw new Error("Expected a Realtime session request");
    }
    const [, init] = call;
    const body = JSON.parse(String(init?.body)) as {
      session: {
        model: string;
        output_modalities: string[];
        max_output_tokens: number;
        instructions: string;
        audio: { input: { turn_detection: Record<string, unknown> } };
        tools: Record<string, unknown>[];
      };
    };
    expect(body.session).toMatchObject({
      max_output_tokens: 300,
      model: "gpt-realtime-2.1",
      output_modalities: ["audio"],
    });
    expect(body.session.instructions).toContain("natural live conversation");
    expect(body.session.audio.input.turn_detection).toEqual({
      create_response: true,
      eagerness: "high",
      interrupt_response: true,
      type: "semantic_vad",
    });
    expect(body.session.tools).toHaveLength(1);
  });
  it("attaches a user-scoped MCP connection", async () => {
    vi.stubEnv("OPENAI_API_KEY", "server-key");
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ session: { id: "sess_2" }, value: "ephemeral" }),
          { headers: { "content-type": "application/json" }, status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetcher);
    await createRealtimeSession("user-1", AbortSignal.timeout(1000), {
      approvalPolicy: "ask",
      authorization: "session-token",
      label: "composio",
      url: "https://mcp.example/session",
    });
    const [call] = fetcher.mock.calls;
    if (!call) {
      throw new Error("Expected a Realtime session request");
    }
    const [, init] = call;
    const body = JSON.parse(String(init?.body)) as {
      session: { tools: Record<string, unknown>[] };
    };
    expect(body.session.tools[1]).toEqual(
      expect.objectContaining({
        authorization: "session-token",
        require_approval: "always",
        server_label: "composio",
        server_url: "https://mcp.example/session",
        type: "mcp",
      })
    );
  });
  it("bypasses MCP prompts only when the user selected automatic changes", async () => {
    vi.stubEnv("OPENAI_API_KEY", "server-key");
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ session: { id: "sess_3" }, value: "ephemeral" }),
          { headers: { "content-type": "application/json" }, status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetcher);
    await createRealtimeSession("user-1", AbortSignal.timeout(1000), {
      approvalPolicy: "automatic",
      label: "composio",
      url: "https://mcp.example/session",
    });
    const [call] = fetcher.mock.calls;
    if (!call) {
      throw new Error("Expected a Realtime session request");
    }
    const [, init] = call;
    const body = JSON.parse(String(init?.body)) as {
      session: { tools: Record<string, unknown>[] };
    };
    expect(body.session.tools[1]).toMatchObject({
      require_approval: "never",
      type: "mcp",
    });
  });
});
