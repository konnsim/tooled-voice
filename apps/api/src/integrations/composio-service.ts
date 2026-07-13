import { Composio } from '@composio/core';
import { createHmac } from 'node:crypto';
import { ApiError } from '../errors/api-error.js';

export const composioToolkits=['linear','github','gmail','slack','notion'] as const;
export type ComposioToolkit=typeof composioToolkits[number];
export interface ComposioConnection {slug:ComposioToolkit;name:string;connected:boolean;logo?:string}

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
  async connect(userId:string,toolkit:ComposioToolkit,callbackUrl:string,signal:AbortSignal):Promise<{authorizationUrl:string}>{
    signal.throwIfAborted();const client=this.required();const session=await client.sessions.create(userId,{toolkits:[toolkit]});const connection=await session.authorize(toolkit,{callbackUrl});if(!connection.redirectUrl)throw new ApiError('INTEGRATION_UNAVAILABLE',`${toolkitName(toolkit)} did not return a connection link`,502,false);return{authorizationUrl:connection.redirectUrl};
  }
  async disconnect(userId:string,toolkit:ComposioToolkit,signal:AbortSignal):Promise<void>{
    signal.throwIfAborted();const client=this.required();const session=await client.sessions.create(userId,{toolkits:[toolkit]});const result=await session.toolkits({toolkits:[toolkit]});const id=result.items[0]?.connection?.connectedAccount?.id;if(!id)return;await client.connectedAccounts.disable(id);
  }
  async mcp(userId:string,signal:AbortSignal):Promise<{url:string;authorization:string}|null>{
    if(!this.client||!this.apiKey)return null;signal.throwIfAborted();const session=await this.client.sessions.create(userId,{toolkits:[...composioToolkits],manageConnections:true,mcp:true});const target=session.mcp.url;const signature=signComposioTarget(target,this.apiKey);const base=process.env.PUBLIC_API_URL??'https://tooled-voice-api.vercel.app';const url=new URL('/api/mcp/composio',base);url.searchParams.set('target',target);url.searchParams.set('signature',signature);return{url:url.toString(),authorization:this.apiKey};
  }
  private required(){if(!this.client)throw new ApiError('INTEGRATION_UNAVAILABLE','Composio is not configured',503,false);return this.client}
}
function toolkitName(slug:ComposioToolkit){return slug[0]!.toUpperCase()+slug.slice(1)}
export function parseComposioToolkit(value:string):ComposioToolkit|null{return(composioToolkits as readonly string[]).includes(value)?value as ComposioToolkit:null}
export function signComposioTarget(target:string,key:string){return createHmac('sha256',key).update(target).digest('base64url')}
