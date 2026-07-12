import { describe,expect,it,vi } from 'vitest';
import { ApiError } from '../errors/api-error.js';
import { toolExecutions,userProfiles } from '../database/schema.js';
import { dispatchTool } from './dispatch.js';
import type { ToolExecutionContext } from './define-tool.js';
import type { CreatedLinearIssue } from '../integrations/types.js';

function context(options:{permissions?:string[];existing?:Array<{status:string;result?:unknown;errorCode?:string|null;retryable?:boolean|null}>;ownedConversation?:boolean;createIssue?:()=>Promise<CreatedLinearIssue>}={}):ToolExecutionContext{
  const existing=options.existing??[];
  const database={
    select:()=>({from:(table:unknown)=>({where:()=>({limit:async()=>table===toolExecutions?existing:options.ownedConversation===false?[]:[{id:'conversation-1',realtimeSessionId:'session-1'}]})})}),
    insert:(table:unknown)=>({values:()=>table===userProfiles?{onConflictDoNothing:async()=>undefined}:{onConflictDoNothing:()=>({returning:async()=>[{id:'audit-1'}]})}}),
    update:(table:unknown)=>{expect(table).toBe(toolExecutions);return{set:()=>({where:async()=>undefined})}},
  };
  return {user:{id:'00000000-0000-4000-8000-000000000001',permissions:new Set(options.permissions??['tools:read','tools:write'])},requestId:'request-1',database:database as never,integrations:{linear:{createIssue:options.createIssue??vi.fn().mockResolvedValue({id:'issue-1',identifier:'TOO-7',title:'Voice issue',url:'https://linear.app/issue/TOO-7',team:'Tooled-voice'})}},logger:{info:vi.fn(),error:vi.fn()},signal:AbortSignal.timeout(1000)};
}

describe('dispatchTool',()=>{
  const request={callId:'call-1',tool:'createLinearIssue',arguments:{title:'Voice issue'}} as const;
  it('validates tool permissions and arguments',async()=>{
    await expect(dispatchTool(request,context({permissions:['tools:read']}))).resolves.toMatchObject({ok:false,error:{code:'PERMISSION_DENIED'}});
    await expect(dispatchTool({...request,arguments:{title:''}},context())).resolves.toMatchObject({ok:false,error:{code:'INVALID_TOOL_ARGUMENTS'}});
  });
  it('rejects unknown tools with a stable response',async()=>{await expect(dispatchTool({callId:'call-unknown',tool:'doesNotExist',arguments:{}},context())).resolves.toMatchObject({ok:false,error:{code:'UNKNOWN_TOOL',retryable:false}})});
  it('executes and validates the registered provider tool',async()=>{
    const execute=vi.fn().mockResolvedValue({id:'issue-1',identifier:'TOO-7',title:'Voice issue',url:'https://linear.app/issue/TOO-7',team:'Tooled-voice'});
    await expect(dispatchTool(request,context({createIssue:execute}))).resolves.toMatchObject({ok:true,result:{identifier:'TOO-7'}});
    expect(execute).toHaveBeenCalledOnce();
  });
  it('returns the persisted result for duplicate call delivery',async()=>{
    await expect(dispatchTool(request,context({existing:[{status:'succeeded',result:{identifier:'TOO-7'}}]}))).resolves.toEqual({ok:true,callId:'call-1',result:{identifier:'TOO-7'}});
  });
  it('rejects a conversation that is not owned by the authenticated user',async()=>{
    const execute=vi.fn().mockResolvedValue({id:'issue-1',identifier:'TOO-7',title:'Voice issue',url:'https://linear.app/issue/TOO-7',team:'Tooled-voice'});
    await expect(dispatchTool({...request,conversationId:'00000000-0000-4000-8000-000000000099'},context({ownedConversation:false,createIssue:execute}))).resolves.toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});
    expect(execute).not.toHaveBeenCalled();
  });
  it('normalizes provider failures and records a stable error',async()=>{
    const execute=vi.fn().mockRejectedValue(new ApiError('PROVIDER_UNAVAILABLE','Linear could not complete the request',502,true));
    await expect(dispatchTool(request,context({createIssue:execute}))).resolves.toMatchObject({ok:false,error:{code:'PROVIDER_UNAVAILABLE',retryable:true}});
  });
  it('rejects a provider result that violates the tool output schema',async()=>{const execute=vi.fn().mockResolvedValue({id:'missing-required-fields'} as never);await expect(dispatchTool(request,context({createIssue:execute}))).resolves.toMatchObject({ok:false,error:{code:'TOOL_EXECUTION_FAILED',retryable:false}})});
});
