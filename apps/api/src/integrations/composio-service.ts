import { Composio } from '@composio/core';
import { createHmac } from 'node:crypto';
import { ApiError } from '../errors/api-error.js';

export const composioToolkits=['linear','github','gmail','slack','notion'] as const;
export type ComposioToolkit=string;
export interface ComposioConnection {slug:string;name:string;connected:boolean;logo?:string;description?:string;toolsCount?:number}
export interface ToolSetting {enabled?:boolean;approvalPolicy?:'ask'|'automatic';connectedAccountIds?:string[];disabledTools?:string[]}
export type ToolSettings=Record<string,ToolSetting>;

export class ComposioService {
  private readonly client:Composio|undefined;
  constructor(private readonly apiKey=process.env.COMPOSIO_API_KEY){this.client=apiKey?new Composio({apiKey}):undefined}
  get configured(){return Boolean(this.client)}
  async connections(userId:string,signal:AbortSignal):Promise<ComposioConnection[]>{
    if(!this.client)return composioToolkits.map(slug=>({slug,name:toolkitName(slug),connected:false}));
    signal.throwIfAborted();const session=await this.client.sessions.create(userId,{toolkits:[...composioToolkits]});
    const result=await session.toolkits({toolkits:[...composioToolkits]});
    return composioToolkits.map(slug=>{const item=result.items.find(candidate=>candidate.slug.toLowerCase()===slug);return{slug,name:item?.name??toolkitName(slug),connected:item?.connection?.isActive===true,...(item?.logo?{logo:item.logo}:{})}});
  }
  async catalog(userId:string,search:string|undefined,cursor:string|undefined,signal:AbortSignal){if(!this.client)return{items:await this.connections(userId,signal),cursor:undefined};signal.throwIfAborted();const session=await this.client.sessions.create(userId,{});const result=await session.toolkits({limit:30,...(search?{search}:{}),...(cursor?{cursor}:{})});return{items:result.items.map(item=>({slug:item.slug,name:item.name,connected:item.connection?.isActive===true,...(item.logo?{logo:item.logo}:{})})),cursor:result.cursor}}
  async accounts(userId:string,signal:AbortSignal){if(!this.client)return[];const result=await this.client.connectedAccounts.list({userIds:[userId],limit:100,orderBy:'updated_at'},{signal});return result.items.map(account=>({id:account.id,toolkit:account.toolkit.slug,status:account.status,alias:account.alias??undefined,createdAt:account.createdAt,updatedAt:account.updatedAt,active:account.status==='ACTIVE'&&!account.isDisabled}))}
  async tools(userId:string,toolkit:string,signal:AbortSignal){const client=this.required();signal.throwIfAborted();const items=await client.tools.get(userId,{toolkits:[toolkit],limit:100}) as unknown as Array<{function?:{name?:string;description?:string}}> ;return items.flatMap(item=>item.function?.name?[{slug:item.function.name,description:item.function.description??''}]:[])}
  async connect(userId:string,toolkit:ComposioToolkit,callbackUrl:string,signal:AbortSignal):Promise<{authorizationUrl:string}>{
    signal.throwIfAborted();const client=this.required();const session=await client.sessions.create(userId,{toolkits:[toolkit]});const connection=await session.authorize(toolkit,{callbackUrl,alias:`${toolkit}-${Date.now()}`});if(!connection.redirectUrl)throw new ApiError('INTEGRATION_UNAVAILABLE',`${toolkitName(toolkit)} did not return a connection link`,502,false);return{authorizationUrl:connection.redirectUrl};
  }
  async disconnect(userId:string,toolkit:ComposioToolkit,signal:AbortSignal):Promise<void>{
    signal.throwIfAborted();const client=this.required();const session=await client.sessions.create(userId,{toolkits:[toolkit]});const result=await session.toolkits({toolkits:[toolkit]});const id=result.items[0]?.connection?.connectedAccount?.id;if(!id)return;await client.connectedAccounts.disable(id);
  }
  async setAccountState(userId:string,accountId:string,action:'enable'|'disable'|'refresh',signal:AbortSignal){const client=this.required();const owned=await client.connectedAccounts.list({userIds:[userId],limit:100},{signal});if(!owned.items.some(account=>account.id===accountId))throw new ApiError('PERMISSION_DENIED','That connection does not belong to this user',403,false);if(action==='enable')await client.connectedAccounts.enable(accountId);else if(action==='refresh')await client.connectedAccounts.refresh(accountId);else await client.connectedAccounts.disable(accountId)}
  async mcp(userId:string,signal:AbortSignal,settings:ToolSettings={}):Promise<{url:string;authorization:string}|null>{
    if(!this.client||!this.apiKey)return null;signal.throwIfAborted();const configured=Object.entries(settings).filter(([,value])=>value.enabled!==false);const toolkits=configured.length?configured.map(([slug])=>slug):[...composioToolkits];const tools=Object.fromEntries(configured.filter(([,value])=>value.disabledTools?.length).map(([slug,value])=>[slug,{disable:value.disabledTools!}]));const connectedAccounts=Object.fromEntries(configured.filter(([,value])=>value.connectedAccountIds?.length).map(([slug,value])=>[slug,value.connectedAccountIds!]));const session=await this.client.sessions.create(userId,{toolkits,tools,connectedAccounts,manageConnections:true,mcp:true});const target=session.mcp.url;const signature=signComposioTarget(target,this.apiKey);const base=process.env.PUBLIC_API_URL??'https://tooled-voice-api.vercel.app';const url=new URL('/api/mcp/composio',base);url.searchParams.set('target',target);url.searchParams.set('signature',signature);return{url:url.toString(),authorization:this.apiKey};
  }
  private required(){if(!this.client)throw new ApiError('INTEGRATION_UNAVAILABLE','Composio is not configured',503,false);return this.client}
}
function toolkitName(slug:ComposioToolkit){return slug[0]!.toUpperCase()+slug.slice(1)}
export function parseComposioToolkit(value:string):ComposioToolkit|null{return/^[a-z0-9][a-z0-9_-]{0,79}$/.test(value)?value:null}
export function signComposioTarget(target:string,key:string){return createHmac('sha256',key).update(target).digest('base64url')}
