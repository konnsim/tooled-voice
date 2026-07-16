import { describe, expect, it } from "vitest";
import { userProfiles } from "../database/schema.js";
import type { Keyring } from "../encryption/token-crypto.js";
import {
  IntegrationStore,
  type LinearCredentials,
} from "./integration-store.js";

describe("IntegrationStore", () => {
  it("encrypts the complete Linear credential envelope before persistence and decrypts it on read", async () => {
    let row: Record<string, unknown> | undefined;

    const database = {
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) =>
          table === userProfiles
            ? { onConflictDoNothing: async () => undefined }
            : {
                onConflictDoUpdate: () => {
                  row = { ...values };

                  return Promise.resolve();
                },
              },
      }),
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => (row ? [row] : []) }),
        }),
      }),
    };

    const key = Buffer.alloc(32, 7);

    const keyring: Keyring = {
      current: () => ({ key, version: "v1" }),
      get: (version) => (version === "v1" ? key : undefined),
    };

    const store = new IntegrationStore(database as never, keyring);

    const credentials: LinearCredentials = {
      accessToken: "access-secret",
      expiresAt: "2026-07-13T00:00:00.000Z",
      refreshToken: "refresh-secret",
      scope: ["read", "write"],
      tokenType: "Bearer",
    };

    await store.saveLinear("00000000-0000-4000-8000-000000000001", credentials);
    expect(row?.encryptedCredentials).not.toContain("access-secret");
    expect(JSON.stringify(row)).not.toContain("refresh-secret");

    await expect(
      store.getLinear("00000000-0000-4000-8000-000000000001")
    ).resolves.toEqual(credentials);
  });
});
