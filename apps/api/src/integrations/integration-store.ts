import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../database/client.js";
import { integrationAccounts, userProfiles } from "../database/schema.js";
import {
  createEnvironmentKeyring,
  decryptToken,
  encryptToken,
  type Keyring,
} from "../encryption/token-crypto.js";

export const linearCredentialsSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: z.string().datetime().optional(),
  refreshToken: z.string().min(1).optional(),
  scope: z.array(z.string()).default([]),
  tokenType: z.string().default("Bearer"),
});
export type LinearCredentials = z.infer<typeof linearCredentialsSchema>;

export class IntegrationStore {
  constructor(
    private readonly database: Database,
    private readonly configuredKeyring?: Keyring
  ) {}
  private keyring() {
    return this.configuredKeyring ?? createEnvironmentKeyring();
  }
  async getLinear(userId: string): Promise<LinearCredentials | null> {
    const [row] = await this.database
      .select()
      .from(integrationAccounts)
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          eq(integrationAccounts.provider, "linear")
        )
      )
      .limit(1);
    if (!row) return null;
    const plaintext = decryptToken(
      {
        ciphertext: row.encryptedCredentials,
        iv: row.encryptionIv,
        keyVersion: row.encryptionKeyVersion,
        tag: row.encryptionTag,
      },
      this.keyring()
    );
    return linearCredentialsSchema.parse(JSON.parse(plaintext));
  }
  async saveLinear(
    userId: string,
    credentials: LinearCredentials
  ): Promise<void> {
    const parsed = linearCredentialsSchema.parse(credentials);
    const encrypted = encryptToken(JSON.stringify(parsed), this.keyring());
    await this.database
      .insert(userProfiles)
      .values({ id: userId })
      .onConflictDoNothing();
    await this.database
      .insert(integrationAccounts)
      .values({
        encryptedCredentials: encrypted.ciphertext,
        encryptionIv: encrypted.iv,
        encryptionKeyVersion: encrypted.keyVersion,
        encryptionTag: encrypted.tag,
        expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
        provider: "linear",
        scopes: parsed.scope,
        userId,
      })
      .onConflictDoUpdate({
        set: {
          encryptedCredentials: encrypted.ciphertext,
          encryptionIv: encrypted.iv,
          encryptionKeyVersion: encrypted.keyVersion,
          encryptionTag: encrypted.tag,
          expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
          scopes: parsed.scope,
          updatedAt: new Date(),
        },
        target: [integrationAccounts.userId, integrationAccounts.provider],
      });
  }
  async deleteLinear(userId: string): Promise<void> {
    await this.database
      .delete(integrationAccounts)
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          eq(integrationAccounts.provider, "linear")
        )
      );
  }
}
