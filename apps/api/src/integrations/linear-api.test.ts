import { describe,expect,it,vi } from 'vitest';
import { ApiError } from '../errors/api-error.js';
import { LinearApi } from './linear-api.js';

describe('LinearApi',()=>{
  it('exchanges an OAuth code with PKCE using form encoding',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({access_token:'access',refresh_token:'refresh',token_type:'Bearer',expires_in:3600,scope:'read write'}),{status:200,headers:{'content-type':'application/json'}}));
    const api=new LinearApi(fetcher as unknown as typeof fetch);
    const token=await api.exchangeCode({clientId:'client',clientSecret:'secret'},{code:'code',codeVerifier:'verifier',redirectUri:'https://example.com/oauth/linear/callback'},AbortSignal.timeout(1000));
    expect(token).toMatchObject({access_token:'access',refresh_token:'refresh'});
    const[,init]=fetcher.mock.calls[0]!;
    expect(String(init?.body)).toContain('code_verifier=verifier');
    expect(String(init?.body)).toContain('client_secret=secret');
  });
  it('resolves a team and creates a real issue through GraphQL',async()=>{
    const fetcher=vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({data:{teams:{nodes:[{id:'team-1',key:'TOO',name:'Tooled-voice'},{id:'team-2',key:'OTH',name:'Other'}]}}}),{status:200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({data:{issueCreate:{success:true,issue:{id:'issue-1',identifier:'TOO-7',title:'Voice issue',url:'https://linear.app/issue/TOO-7',team:{name:'Tooled-voice'}}}}}),{status:200}));
    const api=new LinearApi(fetcher as unknown as typeof fetch);
    await expect(api.createIssue('access',{title:'Voice issue'},AbortSignal.timeout(1000))).resolves.toMatchObject({identifier:'TOO-7',team:'Tooled-voice'});
    const mutation=JSON.parse(String(fetcher.mock.calls[1]![1]?.body)) as {variables:{input:{teamId:string;title:string}}};
    expect(mutation.variables.input).toMatchObject({teamId:'team-1',title:'Voice issue'});
  });
  it('uses an explicit team override instead of the default team',async()=>{
    const fetcher=vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({data:{teams:{nodes:[{id:'team-1',key:'TOO',name:'Tooled-voice'},{id:'team-2',key:'OTH',name:'Other'}]}}}),{status:200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({data:{issueCreate:{success:true,issue:{id:'issue-2',identifier:'OTH-1',title:'Other issue',url:'https://linear.app/issue/OTH-1',team:{name:'Other'}}}}}),{status:200}));
    const api=new LinearApi(fetcher as unknown as typeof fetch);
    await api.createIssue('access',{title:'Other issue',team:'OTH'},AbortSignal.timeout(1000));
    const mutation=JSON.parse(String(fetcher.mock.calls[1]![1]?.body)) as {variables:{input:{teamId:string}}};
    expect(mutation.variables.input.teamId).toBe('team-2');
  });
  it('normalizes Linear rate limits without exposing provider details',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({errors:[{message:'private provider message',extensions:{code:'RATELIMITED'}}]}),{status:200}));
    const api=new LinearApi(fetcher as unknown as typeof fetch);
    await expect(api.createIssue('access',{title:'Voice issue'},AbortSignal.timeout(1000))).rejects.toMatchObject({code:'PROVIDER_RATE_LIMITED',retryable:true,message:'Linear rate limited the request'} satisfies Partial<ApiError>);
  });
  it('normalizes provider network failures as retryable',async()=>{
    const api=new LinearApi(vi.fn().mockRejectedValue(new TypeError('socket details')) as unknown as typeof fetch);
    await expect(api.createIssue('access',{title:'Voice issue'},new AbortController().signal)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE',retryable:true,message:'The Linear API could not be reached'});
  });
});
