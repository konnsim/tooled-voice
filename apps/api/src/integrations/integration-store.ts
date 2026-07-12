import { and,eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../database/client.js';
import { integrationAccounts,userProfiles } from '../database/schema.js';
import { createEnvironmentKeyring,decryptToken,encryptToken,type Keyring } from '../encryption/token-crypto.js';

export const linearCredentialsSchema=z.object({
  accessToken:z.string().min(1),
  refreshToken:z.string().min(1).optional(),
  tokenType:z.string().default('Bearer'),
  scope:z.array(z.string()).default([]),
  expiresAt:z.string().datetime().optional(),
});
export type LinearCredentials=z.infer<typeof linearCredentialsSchema>;

export class IntegrationStore {
  constructor(private readonly database:Database,private readonly configuredKeyring?:Keyring){}
  private keyring(){return this.configuredKeyring??createEnvironmentKeyring()}
  async getLinear(userId:string):Promise<LinearCredentials|null>{
    const [row]=await this.database.select().from(integrationAccounts).where(and(eq(integrationAccounts.userId,userId),eq(integrationAccounts.provider,'linear'))).limit(1);
    if(!row)return null;
    const plaintext=decryptToken({ciphertext:row.encryptedCredentials,iv:row.encryptionIv,tag:row.encryptionTag,keyVersion:row.encryptionKeyVersion},this.keyring());
    return linearCredentialsSchema.parse(JSON.parse(plaintext));
  }
  async saveLinear(userId:string,credentials:LinearCredentials):Promise<void>{
    const parsed=linearCredentialsSchema.parse(credentials);
    const encrypted=encryptToken(JSON.stringify(parsed),this.keyring());
    await this.database.insert(userProfiles).values({id:userId}).onConflictDoNothing();
    await this.database.insert(integrationAccounts).values({userId,provider:'linear',encryptedCredentials:encrypted.ciphertext,encryptionIv:encrypted.iv,encryptionTag:encrypted.tag,encryptionKeyVersion:encrypted.keyVersion,expiresAt:parsed.expiresAt?new Date(parsed.expiresAt):null,scopes:parsed.scope}).onConflictDoUpdate({target:[integrationAccounts.userId,integrationAccounts.provider],set:{encryptedCredentials:encrypted.ciphertext,encryptionIv:encrypted.iv,encryptionTag:encrypted.tag,encryptionKeyVersion:encrypted.keyVersion,expiresAt:parsed.expiresAt?new Date(parsed.expiresAt):null,scopes:parsed.scope,updatedAt:new Date()}});
  }
  async deleteLinear(userId:string):Promise<void>{await this.database.delete(integrationAccounts).where(and(eq(integrationAccounts.userId,userId),eq(integrationAccounts.provider,'linear')))}
}
