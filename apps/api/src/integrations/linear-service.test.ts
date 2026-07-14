import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  IntegrationStore,
  LinearCredentials,
} from "./integration-store.js";
import { LinearApi } from "./linear-api.js";
import { LinearService } from "./linear-service.js";

const originalEnv = { ...process.env };
beforeEach(() => {
  process.env.LINEAR_CLIENT_ID = "client";
  process.env.LINEAR_CLIENT_SECRET = "secret";
  process.env.LINEAR_REDIRECT_URI =
    "http://localhost:3000/oauth/linear/callback";
});
afterEach(() => {
  process.env = { ...originalEnv };
});

describe("LinearService OAuth", () => {
  it("stores a hashed one-time state and sends a PKCE challenge", async () => {
    let stateRow: Record<string, unknown> | undefined;
    const database = {
      delete: () => ({ where: async () => undefined }),
      insert: (_table: unknown) => ({
        values: (values: Record<string, unknown>) => ({
          onConflictDoNothing: async () => undefined,
          then: undefined,
          ...(values.provider === "linear"
            ? {
                then: (resolve: (value: unknown) => void) => {
                  stateRow = values;
                  resolve(undefined);
                },
              }
            : {}),
        }),
      }),
    };
    const service = new LinearService(
      database as never,
      new LinearApi(),
      {} as IntegrationStore
    );
    const { authorizationUrl } = await service.createAuthorization(
      "00000000-0000-4000-8000-000000000001"
    );
    const url = new URL(authorizationUrl);
    const state = url.searchParams.get("state");
    if (!state) throw new Error("Expected an OAuth state parameter");
    expect(stateRow?.stateHash).toBe(
      createHash("sha256").update(state).digest("hex")
    );
    expect(stateRow?.codeVerifier).not.toBe(state);
    expect(url.searchParams.get("code_challenge")).toBe(
      createHash("sha256")
        .update(String(stateRow?.codeVerifier))
        .digest("base64url")
    );
    expect(url.searchParams.get("scope")).toBe("read,write");
  });
  it("refreshes an expired credential before returning it for MCP", async () => {
    const expired: LinearCredentials = {
      accessToken: "old-access",
      expiresAt: new Date(0).toISOString(),
      refreshToken: "refresh",
      scope: ["read", "write"],
      tokenType: "Bearer",
    };
    const store = {
      getLinear: vi.fn().mockResolvedValue(expired),
      saveLinear: vi.fn().mockResolvedValue(undefined),
    };
    const api = {
      refreshToken: vi.fn().mockResolvedValue({
        access_token: "new-access",
        expires_in: 3600,
        refresh_token: "new-refresh",
        scope: "read write",
        token_type: "Bearer",
      }),
    };
    const service = new LinearService(
      {} as never,
      api as unknown as LinearApi,
      store as unknown as IntegrationStore
    );
    await expect(
      service.accessToken(
        "00000000-0000-4000-8000-000000000002",
        AbortSignal.timeout(1000)
      )
    ).resolves.toBe("new-access");
    expect(api.refreshToken).toHaveBeenCalledWith(
      expect.anything(),
      "refresh",
      expect.any(AbortSignal)
    );
    expect(store.saveLinear).toHaveBeenCalledOnce();
  });
  it("returns null when Linear is not connected", async () => {
    const store = { getLinear: vi.fn().mockResolvedValue(null) };
    const service = new LinearService(
      {} as never,
      new LinearApi(),
      store as unknown as IntegrationStore
    );
    await expect(
      service.accessToken(
        "00000000-0000-4000-8000-000000000003",
        AbortSignal.timeout(1000)
      )
    ).resolves.toBeNull();
  });
});
