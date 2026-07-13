import { createHash } from 'node:crypto';
import { ApiError } from '../errors/api-error.js';
import { realtimeTools } from '../tools/registry.js';
export async function createRealtimeSession(userId:string, signal:AbortSignal,linearConnection?:{accessToken:string;approvalPolicy:'ask'|'automatic'}) {
  const key=process.env.OPENAI_API_KEY; if (!key) throw new Error('OPENAI_API_KEY is required');
  const safety=createHash('sha256').update(`tooled-voice:${userId}`).digest('hex');
  const model=process.env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime-2.1';
  const configuredEagerness=process.env.OPENAI_REALTIME_VAD_EAGERNESS;
  const eagerness=configuredEagerness==='low'||configuredEagerness==='auto'||configuredEagerness==='high'?configuredEagerness:'high';
  const instructions='You are the warm, quick personal assistant inside Tooled Voice. Make this feel like a natural live conversation: respond promptly, use contractions, and usually speak in one or two short sentences. Do not repeat the user or narrate your process. Brief natural acknowledgements are welcome when useful, but avoid filler. If interrupted, stop the prior thought and address the new request immediately. Act on requests with the available tools instead of explaining how a developer could implement them. Use the connected Linear tools whenever the user asks to find, inspect, create, update, organize, comment on, or otherwise work with Linear data. Ask only for information genuinely required by the selected tool. Report tool success or failure clearly and briefly.';
  const tools=[...realtimeTools,...(linearConnection?[{type:'mcp' as const,server_label:'linear',server_url:'https://mcp.linear.app/mcp',authorization:linearConnection.accessToken,require_approval:linearConnection.approvalPolicy==='automatic'?'never' as const:'always' as const,server_description:'The user-connected Linear workspace. Use it for issues, projects, comments, cycles, initiatives, milestones, updates, labels, documents, and other Linear work.'}]:[])];
  let response:Response;try{response=await fetch('https://api.openai.com/v1/realtime/client_secrets',{method:'POST',signal,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','OpenAI-Safety-Identifier':safety},body:JSON.stringify({session:{type:'realtime',model,output_modalities:['audio'],max_output_tokens:300,instructions,audio:{input:{turn_detection:{type:'semantic_vad',eagerness,create_response:true,interrupt_response:true},transcription:{model:'gpt-4o-mini-transcribe'}},output:{voice:process.env.OPENAI_REALTIME_VOICE ?? 'marin'}},tools,tool_choice:'auto'}})})}catch(error){throw new ApiError('REALTIME_SESSION_FAILED','Unable to reach OpenAI Realtime',502,true,{cause:error})}
  if (!response.ok) throw new ApiError('REALTIME_SESSION_FAILED','Unable to create a Realtime session',502,response.status>=500);
  const data=await response.json() as { value?:string; expires_at?:number; session?:{id?:string} };
  if (!data.value) throw new ApiError('REALTIME_SESSION_FAILED','OpenAI returned an invalid Realtime credential',502,false);
  return { clientSecret:data.value, expiresAt:data.expires_at, sessionId:data.session?.id, model };
}
