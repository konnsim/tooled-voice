import { createHash } from 'node:crypto';
import { ApiError } from '../errors/api-error.js';
import { realtimeTools } from '../tools/registry.js';
export async function createRealtimeSession(userId:string, signal:AbortSignal) {
  const key=process.env.OPENAI_API_KEY; if (!key) throw new Error('OPENAI_API_KEY is required');
  const safety=createHash('sha256').update(`tooled-voice:${userId}`).digest('hex');
  let response:Response;try{response=await fetch('https://api.openai.com/v1/realtime/client_secrets',{method:'POST',signal,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','OpenAI-Safety-Identifier':safety},body:JSON.stringify({session:{type:'realtime',model:process.env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime',instructions:'You are the concise personal assistant inside Tooled Voice. Act on requests with the available tools instead of explaining how a developer could implement them. Never claim that a connected integration is unavailable without calling the relevant tool and using its result. For createLinearIssue, ask only for a useful title if one cannot be inferred; omit team so the backend uses the connected account default unless the user explicitly requests a different team. Clearly and briefly report tool success or failure.',audio:{input:{turn_detection:null,transcription:{model:'gpt-4o-mini-transcribe'}},output:{voice:process.env.OPENAI_REALTIME_VOICE ?? 'marin'}},tools:realtimeTools,tool_choice:'auto'}})})}catch(error){throw new ApiError('REALTIME_SESSION_FAILED','Unable to reach OpenAI Realtime',502,true,{cause:error})}
  if (!response.ok) throw new ApiError('REALTIME_SESSION_FAILED','Unable to create a Realtime session',502,response.status>=500);
  const data=await response.json() as { value?:string; expires_at?:number; session?:{id?:string} };
  if (!data.value) throw new ApiError('REALTIME_SESSION_FAILED','OpenAI returned an invalid Realtime credential',502,false);
  return { clientSecret:data.value, expiresAt:data.expires_at, sessionId:data.session?.id, model:process.env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime' };
}
