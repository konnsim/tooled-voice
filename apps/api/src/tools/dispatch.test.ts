import { describe,expect,it,vi } from 'vitest';
import { toolExecutions,userProfiles } from '../database/schema.js';
import { dispatchTool } from './dispatch.js';
import type { ToolExecutionContext } from './define-tool.js';

function context(options:{permissions?:string[];existing?:Array<{status:string;result?:unknown}>}={}):ToolExecutionContext{
  const database={
    select:()=>({from:()=>({where:()=>({limit:async()=>options.existing??[]})})}),
    insert:(table:unknown)=>({values:()=>table===userProfiles?{onConflictDoNothing:async()=>undefined}:{onConflictDoNothing:()=>({returning:async()=>[{id:'audit-1'}]})}}),
    update:(table:unknown)=>{expect(table).toBe(toolExecutions);return{set:()=>({where:async()=>undefined})}},
  };
  return {user:{id:'00000000-0000-4000-8000-000000000001',permissions:new Set(options.permissions??['tools:read'])},requestId:'request-1',database:database as never,logger:{info:vi.fn(),error:vi.fn()},signal:AbortSignal.timeout(1000)};
}

describe('dispatchTool',()=>{
  const request={callId:'call-1',tool:'getCurrentTime',arguments:{timezone:'Australia/Sydney'}} as const;
  it('executes a registered local tool',async()=>{await expect(dispatchTool(request,context())).resolves.toMatchObject({ok:true,result:{timezone:'Australia/Sydney'}})});
  it('validates permissions and arguments',async()=>{await expect(dispatchTool(request,context({permissions:[]}))).resolves.toMatchObject({ok:false,error:{code:'PERMISSION_DENIED'}});await expect(dispatchTool({...request,arguments:{timezone:'invalid'}},context())).resolves.toMatchObject({ok:false,error:{code:'INVALID_TOOL_ARGUMENTS'}})});
  it('rejects unknown tools',async()=>{await expect(dispatchTool({callId:'unknown',tool:'doesNotExist',arguments:{}},context())).resolves.toMatchObject({ok:false,error:{code:'UNKNOWN_TOOL'}})});
  it('returns a persisted result for duplicate delivery',async()=>{await expect(dispatchTool(request,context({existing:[{status:'succeeded',result:{timezone:'Australia/Sydney',iso:'cached'}}]}))).resolves.toEqual({ok:true,callId:'call-1',result:{timezone:'Australia/Sydney',iso:'cached'}})});
});
