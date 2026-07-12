import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
const encryptedSchema = z.object({ ciphertext: z.string(), iv: z.string(), tag: z.string(), keyVersion: z.string() });
export type EncryptedValue = z.infer<typeof encryptedSchema>;
export interface Keyring { current(): { version: string; key: Buffer }; get(version: string): Buffer | undefined }
export function createEnvironmentKeyring(): Keyring {
  const version = process.env.TOKEN_ENCRYPTION_KEY_VERSION ?? 'v1';
  const encoded = process.env.TOKEN_ENCRYPTION_KEY;
  if (!encoded) throw new Error('TOKEN_ENCRYPTION_KEY is required');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must decode to 32 bytes');
  return { current: () => ({ version, key }), get: candidate => candidate === version ? key : undefined };
}
export function encryptToken(plaintext: string, keyring: Keyring): EncryptedValue {
  const { version, key } = keyring.current(); const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), keyVersion: version };
}
export function decryptToken(value: EncryptedValue, keyring: Keyring): string {
  const parsed = encryptedSchema.parse(value); const key = keyring.get(parsed.keyVersion); if (!key) throw new Error('Unknown encryption key version');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv,'base64')); decipher.setAuthTag(Buffer.from(parsed.tag,'base64'));
  return Buffer.concat([decipher.update(Buffer.from(parsed.ciphertext,'base64')), decipher.final()]).toString('utf8');
}
