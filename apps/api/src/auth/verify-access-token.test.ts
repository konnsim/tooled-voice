import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { jwtVerify } = vi.hoisted(() => ({ jwtVerify: vi.fn() }));

vi.mock("jose", () => ({ createRemoteJWKSet: vi.fn(() => ({})), jwtVerify }));

import { verifyAccessToken } from "./verify-access-token.js";

const previousUrl = process.env.SUPABASE_URL;

beforeEach(() => {
  process.env.SUPABASE_URL = "https://project.supabase.co";
  jwtVerify.mockReset();
});

afterEach(() => {
  if (previousUrl === undefined) {
    delete process.env.SUPABASE_URL;
  } else {
    process.env.SUPABASE_URL = previousUrl;
  }
});

describe("verifyAccessToken", () => {
  it("requires a bearer token", async () => {
    await expect(verifyAccessToken(undefined)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      status: 401,
    });
  });

  it("normalizes invalid or expired tokens", async () => {
    jwtVerify.mockRejectedValue(new Error("signature details"));

    await expect(verifyAccessToken("Bearer invalid")).rejects.toMatchObject({
      code: "AUTH_INVALID",
      message: "The access token is invalid or expired",
    });
  });

  it("returns the authenticated subject and trusted app permissions", async () => {
    jwtVerify.mockResolvedValue({
      payload: {
        app_metadata: { permissions: ["tools:read"] },
        sub: "00000000-0000-4000-8000-000000000001",
      },
    });

    await expect(verifyAccessToken("Bearer valid")).resolves.toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      permissions: new Set(["tools:read"]),
    });
  });
});
