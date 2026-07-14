import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";

describe("authentication boundary", () => {
  it("rejects unauthenticated API requests with a stable error", async () => {
    const response = await createApp({} as never).request("/api/tools", {
      body: "{}",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "AUTH_REQUIRED", retryable: false },
      ok: false,
    });
  });
});
describe("Linear OAuth callback", () => {
  it("returns malformed callbacks to the native app without exposing an exception", async () => {
    const response = await createApp({} as never).request(
      "/oauth/linear/callback?error=access_denied",
      { redirect: "manual" }
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "tooledvoice://integrations/linear?status=error&code=access_denied"
    );
  });
});
describe("readiness", () => {
  it("checks database connectivity without requiring a token", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const response = await createApp({ execute } as never).request(
      "/api/health"
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ database: "connected", ok: true });
    expect(execute).toHaveBeenCalledOnce();
  });
});
