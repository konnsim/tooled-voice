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
    const body=JSON.parse(String(init?.body)) as {session:{model:string;output_modalities:string[];max_output_tokens:number;instructions:string;audio:{input:{turn_detection:Record<string,unknown>}}}};
    expect(body.session).toMatchObject({model:'gpt-realtime-2.1',output_modalities:['audio'],max_output_tokens:300});
    expect(body.session.instructions).toContain('natural live conversation');
    expect(body.session.audio.input.turn_detection).toEqual({type:'semantic_vad',eagerness:'high',create_response:true,interrupt_response:true});
  });
});
