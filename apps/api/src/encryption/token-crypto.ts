import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";

const encryptedSchema = z.object({
  ciphertext: z.string(),
  iv: z.string(),
  keyVersion: z.string(),
  tag: z.string(),
});
export type EncryptedValue = z.infer<typeof encryptedSchema>;
export interface Keyring {
  current(): { version: string; key: Buffer };
  get(version: string): Buffer | undefined;
}
export function createEnvironmentKeyring(): Keyring {
  const version = process.env.TOKEN_ENCRYPTION_KEY_VERSION ?? "v1";
  const encoded = process.env.TOKEN_ENCRYPTION_KEY;
  if (!encoded) throw new Error("TOKEN_ENCRYPTION_KEY is required");
  return createKeyring(
    version,
    encoded,
    process.env.TOKEN_ENCRYPTION_PREVIOUS_KEYS
  );
}
export function createKeyring(
  currentVersion: string,
  currentEncoded: string,
  previousJson?: string
): Keyring {
  const previous = previousJson
    ? z.record(z.string(), z.string()).parse(JSON.parse(previousJson))
    : {};
  const encodedKeys = { ...previous, [currentVersion]: currentEncoded };
  const keys = new Map(
    Object.entries(encodedKeys).map(([version, encoded]) => {
      const key = Buffer.from(encoded, "base64");
      if (key.length !== 32)
        throw new Error(`Encryption key ${version} must decode to 32 bytes`);
      return [version, key] as const;
    })
  );
  const current = keys.get(currentVersion);
  if (!current) throw new Error("Current encryption key is unavailable");
  return {
    current: () => ({ key: current, version: currentVersion }),
    get: (version) => keys.get(version),
  };
}
export function encryptToken(
  plaintext: string,
  keyring: Keyring
): EncryptedValue {
  const { version, key } = keyring.current();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    keyVersion: version,
    tag: cipher.getAuthTag().toString("base64"),
  };
}
export function decryptToken(value: EncryptedValue, keyring: Keyring): string {
  const parsed = encryptedSchema.parse(value);
  const key = keyring.get(parsed.keyVersion);
  if (!key) throw new Error("Unknown encryption key version");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(parsed.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(parsed.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
