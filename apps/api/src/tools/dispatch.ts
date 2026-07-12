import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { ToolCallRequest, ToolResponse } from '@tooled-voice/shared';
import { ApiError, normalizeError } from '../errors/api-error.js';
import { conversations,toolExecutions, userProfiles } from '../database/schema.js';
import type { ToolExecutionContext } from './define-tool.js';
import { toolRegistry } from './registry.js';

export async function dispatchTool(request: ToolCallRequest, context: ToolExecutionContext): Promise<ToolResponse> {
  const logContext:Record<string,unknown>={requestId:context.requestId,userId:context.user.id,callId:request.callId,toolName:request.tool,...(request.conversationId?{conversationId:request.conversationId}:{})};
  const argumentKeys=request.arguments&&typeof request.arguments==='object'&&!Array.isArray(request.arguments)?Object.keys(request.arguments).sort():[];
  context.logger.info({...logContext,argumentKeys},'Tool call received');
  const existing=await context.database.select().from(toolExecutions).where(and(eq(toolExecutions.userId,context.user.id),eq(toolExecutions.callId,request.callId))).limit(1);
  const previous=existing[0];
  if (previous?.status==='succeeded') { context.logger.info({...logContext,status:'cached'},'Tool call replayed'); return {ok:true,callId:request.callId,result:previous.result}; }
  if (previous?.status==='running') { context.logger.info({...logContext,status:'in_progress'},'Tool call rejected'); return failure(request.callId,new ApiError('TOOL_IN_PROGRESS','This tool call is already being processed',409,true)); }
  if (previous) { context.logger.info({...logContext,status:'previously_failed',errorCode:previous.errorCode},'Tool call replayed'); return {ok:false,callId:request.callId,error:{code:previous.errorCode ?? 'TOOL_EXECUTION_FAILED',message:'This tool call previously failed',retryable:previous.retryable ?? false}}; }
  const tool=toolRegistry.get(request.tool);
  if (!tool) { context.logger.info({...logContext,status:'rejected',errorCode:'UNKNOWN_TOOL'},'Tool call rejected'); return failure(request.callId,new ApiError('UNKNOWN_TOOL','The requested tool does not exist',404)); }
  for (const permission of tool.permissions) if (!context.user.permissions.has(permission)) { context.logger.info({...logContext,status:'rejected',errorCode:'PERMISSION_DENIED'},'Tool call rejected'); return failure(request.callId,new ApiError('PERMISSION_DENIED','You do not have permission to use this tool',403)); }
  const parsed=tool.input.safeParse(request.arguments);
  if (!parsed.success) { context.logger.info({...logContext,status:'rejected',errorCode:'INVALID_TOOL_ARGUMENTS'},'Tool call rejected'); return failure(request.callId,new ApiError('INVALID_TOOL_ARGUMENTS','The tool arguments were invalid',400)); }
  if(request.conversationId){const [owned]=await context.database.select({id:conversations.id,realtimeSessionId:conversations.realtimeSessionId}).from(conversations).where(and(eq(conversations.id,request.conversationId),eq(conversations.userId,context.user.id))).limit(1);if(!owned){context.logger.info({...logContext,status:'rejected',errorCode:'INVALID_REQUEST'},'Tool call rejected');return failure(request.callId,new ApiError('INVALID_REQUEST','The conversation was not found',400,false))}if(owned.realtimeSessionId)logContext.realtimeSessionId=owned.realtimeSessionId}
  await context.database.insert(userProfiles).values({id:context.user.id}).onConflictDoNothing();
  const [audit]=await context.database.insert(toolExecutions).values({userId:context.user.id,conversationId:request.conversationId,requestId:context.requestId,callId:request.callId,toolName:request.tool,arguments:parsed.data}).onConflictDoNothing().returning({id:toolExecutions.id});
  if (!audit) { context.logger.info({...logContext,status:'in_progress'},'Tool call rejected'); return failure(request.callId,new ApiError('TOOL_IN_PROGRESS','This tool call is already being processed',409,true)); }
  const started=Date.now(); const timeout=AbortSignal.timeout(15_000); const signal=AbortSignal.any([context.signal,timeout]);
  try {
    const result=await tool.execute(parsed.data,{...context,signal});
    const validated=tool.output ? tool.output.parse(result) : result;
    await context.database.update(toolExecutions).set({status:'succeeded',result:validated,durationMs:Date.now()-started,updatedAt:new Date()}).where(eq(toolExecutions.id,audit.id));
    context.logger.info({...logContext,durationMs:Date.now()-started,status:'succeeded'},'Tool executed');
    return {ok:true,callId:request.callId,result:validated};
  } catch (unknown) {
    const error=timeout.aborted ? new ApiError('TOOL_TIMEOUT','The tool execution timed out',504,tool.retry.enabled) : unknown instanceof z.ZodError ? new ApiError('TOOL_EXECUTION_FAILED','The tool returned an invalid result',500,false) : normalizeError(unknown);
    await context.database.update(toolExecutions).set({status:error.code==='TOOL_TIMEOUT'?'timed_out':'failed',errorCode:error.code,retryable:error.retryable,durationMs:Date.now()-started,updatedAt:new Date()}).where(eq(toolExecutions.id,audit.id));
    context.logger.error({...logContext,durationMs:Date.now()-started,status:'failed',errorCode:error.code},'Tool failed');
    return failure(request.callId,error);
  }
}
const failure=(callId:string,error:ApiError):ToolResponse=>({ok:false,callId,error:{code:error.code,message:error.message,retryable:error.retryable}});
