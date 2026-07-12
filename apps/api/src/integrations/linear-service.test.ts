import { createHash } from 'node:crypto';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { LinearApi } from './linear-api.js';
import { IntegrationStore,type LinearCredentials } from './integration-store.js';
import { LinearService } from './linear-service.js';

const originalEnv={...process.env};
beforeEach(()=>{process.env.LINEAR_CLIENT_ID='client';process.env.LINEAR_CLIENT_SECRET='secret';process.env.LINEAR_REDIRECT_URI='http://localhost:3000/oauth/linear/callback'});
afterEach(()=>{process.env={...originalEnv}});

describe('LinearService OAuth',()=>{
  it('stores a hashed one-time state and sends a PKCE challenge',async()=>{
    let stateRow:Record<string,unknown>|undefined;
    const database={insert:(table:unknown)=>({values:(values:Record<string,unknown>)=>({onConflictDoNothing:async()=>undefined,then:undefined,...(values.provider==='linear'?{then:(resolve:(value:unknown)=>void)=>{stateRow=values;resolve(undefined)}}:{})})}),delete:()=>({where:async()=>undefined})};
    const service=new LinearService(database as never,new LinearApi(),{} as IntegrationStore);
    const{authorizationUrl}=await service.createAuthorization('00000000-0000-4000-8000-000000000001');
    const url=new URL(authorizationUrl);
    const state=url.searchParams.get('state')!;
    expect(stateRow?.stateHash).toBe(createHash('sha256').update(state).digest('hex'));
    expect(stateRow?.codeVerifier).not.toBe(state);
    expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(String(stateRow?.codeVerifier)).digest('base64url'));
    expect(url.searchParams.get('scope')).toBe('read,write');
  });
  it('refreshes an expired credential before creating an issue',async()=>{
    const expired:LinearCredentials={accessToken:'old-access',refreshToken:'refresh',tokenType:'Bearer',scope:['read','write'],expiresAt:new Date(0).toISOString()};
    const store={getLinear:vi.fn().mockResolvedValue(expired),saveLinear:vi.fn().mockResolvedValue(undefined)};
    const api={refreshToken:vi.fn().mockResolvedValue({access_token:'new-access',refresh_token:'new-refresh',token_type:'Bearer',scope:'read write',expires_in:3600}),createIssue:vi.fn().mockResolvedValue({id:'issue-1',identifier:'TOO-7',title:'Voice issue',url:'https://linear.app/issue/TOO-7',team:'Tooled-voice'})};
    const service=new LinearService({} as never,api as unknown as LinearApi,store as unknown as IntegrationStore);
    await service.createIssue('00000000-0000-4000-8000-000000000002',{title:'Voice issue'},AbortSignal.timeout(1000));
    expect(api.refreshToken).toHaveBeenCalledWith(expect.anything(),'refresh',expect.any(AbortSignal));
    expect(api.createIssue).toHaveBeenCalledWith('new-access',{title:'Voice issue'},expect.any(AbortSignal));
    expect(store.saveLinear).toHaveBeenCalledOnce();
  });
});
