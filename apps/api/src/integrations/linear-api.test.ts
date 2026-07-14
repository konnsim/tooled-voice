import { describe, expect, it, vi } from "vitest";
import { LinearApi } from "./linear-api.js";

describe("LinearApi", () => {
  it("exchanges an OAuth code with PKCE using form encoding", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access",
          expires_in: 3600,
          refresh_token: "refresh",
          scope: "read write",
          token_type: "Bearer",
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      )
    );
    const api = new LinearApi(fetcher as unknown as typeof fetch);
    const token = await api.exchangeCode(
      { clientId: "client", clientSecret: "secret" },
      {
        code: "code",
        codeVerifier: "verifier",
        redirectUri: "https://example.com/oauth/linear/callback",
      },
      AbortSignal.timeout(1000)
    );
    expect(token).toMatchObject({
      access_token: "access",
      refresh_token: "refresh",
    });
    const [, init] = fetcher.mock.calls[0]!;
    expect(String(init?.body)).toContain("code_verifier=verifier");
    expect(String(init?.body)).toContain("client_secret=secret");
  });
  it("normalizes OAuth network failures as retryable", async () => {
    const api = new LinearApi(
      vi
        .fn()
        .mockRejectedValue(
          new TypeError("socket details")
        ) as unknown as typeof fetch
    );
    await expect(
      api.exchangeCode(
        { clientId: "client", clientSecret: "secret" },
        {
          code: "code",
          codeVerifier: "verifier",
          redirectUri: "https://example.com/oauth/linear/callback",
        },
        new AbortController().signal
      )
    ).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      message: "The Linear API could not be reached",
      retryable: true,
    });
  });
});
