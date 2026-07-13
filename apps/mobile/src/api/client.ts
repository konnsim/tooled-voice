import { toolResponseSchema, type ToolCallRequest } from '@tooled-voice/shared';
import { config } from '../config';
import { supabase } from '../auth/supabase';
export class ApiClientError extends Error { constructor(public readonly code:string,message:string,public readonly retryable=false){super(message)} }
async function token(){const {data,error}=await supabase.auth.getSession();if(error||!data.session)throw new Error('AUTH_REQUIRED');return data.session.access_token}
export async function apiFetch(path:string,init:RequestInit={}){const accessToken=await token();const response=await fetch(`${config.apiUrl}${path}`,{...init,headers:{...init.headers,Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'}});const data=response.status===204?undefined:await response.json();if(!response.ok){const error=data?.error;throw new ApiClientError(typeof error?.code==='string'?error.code:`HTTP_${response.status}`,typeof error?.message==='string'?error.message:'The request failed',error?.retryable===true)}return data}
export const createRealtimeCredential=(conversationId?:string)=>apiFetch('/api/realtime/session',{method:'POST',body:JSON.stringify(conversationId?{conversationId}:{})}) as Promise<{clientSecret:string;expiresAt?:number;sessionId?:string;model:string;conversationId:string}>;
export async function executeTool(request:ToolCallRequest){return toolResponseSchema.parse(await apiFetch('/api/tools',{method:'POST',body:JSON.stringify(request)}))}
export async function persistConversationItem(conversationId:string,item:{role:'user'|'assistant'|'tool';kind:'transcript'|'tool_call'|'tool_result';transcript?:string;callId?:string;payload?:unknown;completed?:boolean}){await apiFetch(`/api/conversations/${conversationId}/items`,{method:'POST',body:JSON.stringify(item)})}
export async function getLatestConversation(){const data=await apiFetch('/api/conversations') as {conversations:Array<{id:string;status:'active'|'completed'|'failed';updatedAt:string}>};const latest=data.conversations[0];if(!latest)return null;const history=await apiFetch(`/api/conversations/${latest.id}/items`) as {items:Array<{id:string;role:'user'|'assistant'|'tool';kind:string;transcript:string|null}>};return {id:latest.id,status:latest.status,items:history.items}}
export const finishConversation=(conversationId:string,status:'completed'|'failed')=>apiFetch(`/api/conversations/${conversationId}/status`,{method:'POST',body:JSON.stringify({status})}) as Promise<{ok:true}>;
export type LinearStatus={connected:boolean;expiresAt?:string;scopes:string[];approvalPolicy:'ask'|'automatic'};
export const getLinearStatus=()=>apiFetch('/api/integrations/linear/status') as Promise<LinearStatus>;
export const setLinearApprovalPolicy=(approvalPolicy:'ask'|'automatic')=>apiFetch('/api/integrations/linear/approval-policy',{method:'PUT',body:JSON.stringify({approvalPolicy})}) as Promise<LinearStatus>;
export const beginLinearConnection=()=>apiFetch('/api/integrations/linear/connect',{method:'POST'}) as Promise<{authorizationUrl:string}>;
export const disconnectLinear=()=>apiFetch('/api/integrations/linear',{method:'DELETE'}) as Promise<void>;
export type ToolApprovalPolicy='ask'|'automatic';
export type ToolConnection={slug:'linear'|'github'|'gmail'|'slack'|'notion';name:string;connected:boolean;logo?:string};
export const getToolConnections=()=>apiFetch('/api/integrations') as Promise<{configured:boolean;approvalPolicy:ToolApprovalPolicy;connections:ToolConnection[]}>;
export const beginToolConnection=(toolkit:ToolConnection['slug'])=>apiFetch(`/api/integrations/${toolkit}/connect`,{method:'POST'}) as Promise<{authorizationUrl:string}>;
export const disconnectTool=(toolkit:ToolConnection['slug'])=>apiFetch(`/api/integrations/${toolkit}`,{method:'DELETE'}) as Promise<void>;
export const setToolApprovalPolicy=(approvalPolicy:ToolApprovalPolicy)=>apiFetch('/api/integrations/approval-policy',{method:'PUT',body:JSON.stringify({approvalPolicy})}) as Promise<{approvalPolicy:ToolApprovalPolicy}>;
