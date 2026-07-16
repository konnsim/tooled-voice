import { describe, expect, it } from "vitest";
import {
  createKeyring,
  decryptToken,
  encryptToken,
  type Keyring,
} from "./token-crypto.js";

const key = Buffer.alloc(32, 7);

const keyring: Keyring = {
  current: () => ({ key, version: "v1" }),
  get: (version) => (version === "v1" ? key : undefined),
};

describe("token encryption", () => {
  it("round trips using AES-256-GCM", () => {
    const encrypted = encryptToken("refresh-secret", keyring);

    expect(encrypted.ciphertext).not.toContain("refresh-secret");
    expect(decryptToken(encrypted, keyring)).toBe("refresh-secret");
  });

  it("rejects tampering", () => {
    const encrypted = encryptToken("secret", keyring);

    encrypted.tag = Buffer.alloc(16).toString("base64");
    expect(() => decryptToken(encrypted, keyring)).toThrow();
  });

  it("decrypts older key versions after rotation", () => {
    const old = createKeyring("v1", Buffer.alloc(32, 1).toString("base64"));
    const encrypted = encryptToken("rotated-secret", old);

    const rotated = createKeyring(
      "v2",
      Buffer.alloc(32, 2).toString("base64"),
      JSON.stringify({ v1: Buffer.alloc(32, 1).toString("base64") })
    );

    expect(decryptToken(encrypted, rotated)).toBe("rotated-secret");
  });
});
