import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken, type Keyring } from './token-crypto.js';
const key=Buffer.alloc(32,7);const keyring:Keyring={current:()=>({version:'v1',key}),get:version=>version==='v1'?key:undefined};
describe('token encryption',()=>{it('round trips using AES-256-GCM',()=>{const encrypted=encryptToken('refresh-secret',keyring);expect(encrypted.ciphertext).not.toContain('refresh-secret');expect(decryptToken(encrypted,keyring)).toBe('refresh-secret')});it('rejects tampering',()=>{const encrypted=encryptToken('secret',keyring);encrypted.tag=Buffer.alloc(16).toString('base64');expect(()=>decryptToken(encrypted,keyring)).toThrow()})});
