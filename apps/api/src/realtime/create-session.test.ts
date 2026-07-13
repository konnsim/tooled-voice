import { afterEach,describe,expect,it,vi } from 'vitest';
import { createRealtimeSession } from './create-session.js';

describe('createRealtimeSession',()=>{
  afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals()});

  it('creates a continuous gpt-realtime-2.1 session with semantic VAD and interruption',async()=>{
    vi.stubEnv('OPENAI_API_KEY','server-key');
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({value:'ephemeral',expires_at:123,session:{id:'sess_1'}}),{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher);

    await expect(createRealtimeSession('user-1',AbortSignal.timeout(1000))).resolves.toMatchObject({clientSecret:'ephemeral',sessionId:'sess_1',model:'gpt-realtime-2.1'});
    const[,init]=fetcher.mock.calls[0]!;
    const body=JSON.parse(String(init?.body)) as {session:{model:string;output_modalities:string[];max_output_tokens:number;instructions:string;audio:{input:{turn_detection:Record<string,unknown>}};tools:Array<Record<string,unknown>>}};
    expect(body.session).toMatchObject({model:'gpt-realtime-2.1',output_modalities:['audio'],max_output_tokens:300});
    expect(body.session.instructions).toContain('natural live conversation');
    expect(body.session.audio.input.turn_detection).toEqual({type:'semantic_vad',eagerness:'high',create_response:true,interrupt_response:true});
    expect(body.session.tools).toHaveLength(1);
  });
  it('attaches the official Linear MCP with the refreshed OAuth token',async()=>{vi.stubEnv('OPENAI_API_KEY','server-key');const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({value:'ephemeral',session:{id:'sess_2'}}),{status:200,headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetcher);await createRealtimeSession('user-1',AbortSignal.timeout(1000),{accessToken:'linear-access',approvalPolicy:'ask'});const body=JSON.parse(String(fetcher.mock.calls[0]![1]?.body)) as {session:{tools:Array<Record<string,unknown>>}};expect(body.session.tools[1]).toEqual(expect.objectContaining({type:'mcp',server_label:'linear',server_url:'https://mcp.linear.app/mcp',authorization:'linear-access',require_approval:'always'}))});
  it('bypasses MCP prompts only when the user selected automatic changes',async()=>{vi.stubEnv('OPENAI_API_KEY','server-key');const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({value:'ephemeral',session:{id:'sess_3'}}),{status:200,headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetcher);await createRealtimeSession('user-1',AbortSignal.timeout(1000),{accessToken:'linear-access',approvalPolicy:'automatic'});const body=JSON.parse(String(fetcher.mock.calls[0]![1]?.body)) as {session:{tools:Array<Record<string,unknown>>}};expect(body.session.tools[1]).toMatchObject({type:'mcp',require_approval:'never'})});
});
