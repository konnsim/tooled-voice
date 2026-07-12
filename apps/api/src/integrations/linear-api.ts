import { z } from 'zod';
import { ApiError } from '../errors/api-error.js';
import type { CreateLinearIssueInput,CreatedLinearIssue } from './types.js';

const tokenResponseSchema=z.object({access_token:z.string().min(1),refresh_token:z.string().min(1).optional(),token_type:z.string().default('Bearer'),expires_in:z.number().int().positive().optional(),scope:z.string().default('')});
export type LinearTokenResponse=z.infer<typeof tokenResponseSchema>;
const graphQlErrorSchema=z.object({message:z.string(),extensions:z.record(z.string(),z.unknown()).optional()});
const teamsSchema=z.object({teams:z.object({nodes:z.array(z.object({id:z.string(),key:z.string(),name:z.string()}))})});
const issueCreateSchema=z.object({issueCreate:z.object({success:z.boolean(),issue:z.object({id:z.string(),identifier:z.string(),title:z.string(),url:z.string(),team:z.object({name:z.string()})}).nullable()})});

export interface LinearOAuthConfig { clientId:string; clientSecret:string }

export class LinearApi {
  constructor(private readonly fetcher:typeof fetch=fetch){}
  exchangeCode(config:LinearOAuthConfig,input:{code:string;codeVerifier:string;redirectUri:string},signal:AbortSignal){return this.token(config,{grant_type:'authorization_code',code:input.code,code_verifier:input.codeVerifier,redirect_uri:input.redirectUri},signal)}
  refreshToken(config:LinearOAuthConfig,refreshToken:string,signal:AbortSignal){return this.token(config,{grant_type:'refresh_token',refresh_token:refreshToken},signal)}
  async revoke(token:string,signal:AbortSignal):Promise<void>{
    const response=await this.request('https://api.linear.app/oauth/revoke',{method:'POST',signal,headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token})});
    if(!response.ok&&response.status!==401)throw providerHttpError(response.status,'Unable to revoke the Linear credential');
  }
  async createIssue(accessToken:string,input:CreateLinearIssueInput,signal:AbortSignal):Promise<CreatedLinearIssue>{
    const teams=teamsSchema.parse(await this.graphql(accessToken,'query VoiceAssistantTeams { teams { nodes { id key name } } }',{},signal)).teams.nodes;
    const normalized=input.team?.trim().toLocaleLowerCase();
    const matches=normalized?teams.filter(team=>[team.id,team.key,team.name].some(value=>value.toLocaleLowerCase()===normalized)):teams;
    if(matches.length!==1)throw new ApiError('INVALID_TOOL_ARGUMENTS',normalized?'The specified Linear team was not found or was ambiguous':'A Linear team is required when the account has access to multiple teams',400,false);
    const team=matches[0]!;
    const data=issueCreateSchema.parse(await this.graphql(accessToken,'mutation VoiceAssistantIssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier title url team { name } } } }',{input:{title:input.title,teamId:team.id,...(input.description?{description:input.description}:{})}},signal));
    if(!data.issueCreate.success||!data.issueCreate.issue)throw new ApiError('PROVIDER_UNAVAILABLE','Linear did not create the issue',502,false);
    return {...data.issueCreate.issue,team:data.issueCreate.issue.team.name};
  }
  private async token(config:LinearOAuthConfig,parameters:Record<string,string>,signal:AbortSignal):Promise<LinearTokenResponse>{
    const response=await this.request('https://api.linear.app/oauth/token',{method:'POST',signal,headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...parameters,client_id:config.clientId,client_secret:config.clientSecret})});
    if(!response.ok)throw new ApiError('OAUTH_EXCHANGE_FAILED','Linear rejected the OAuth token request',502,response.status>=500);
    return tokenResponseSchema.parse(await response.json());
  }
  private async graphql(accessToken:string,query:string,variables:Record<string,unknown>,signal:AbortSignal):Promise<unknown>{
    const response=await this.request('https://api.linear.app/graphql',{method:'POST',signal,headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({query,variables})});
    if(!response.ok)throw providerHttpError(response.status,'The Linear API request failed');
    const body=z.object({data:z.unknown().optional(),errors:z.array(graphQlErrorSchema).optional()}).parse(await response.json());
    if(body.errors?.length){
      const codes=body.errors.map(error=>error.extensions?.code).filter((code):code is string=>typeof code==='string');
      if(codes.some(code=>/AUTH|UNAUTHENTICATED/i.test(code)))throw new ApiError('INTEGRATION_AUTH_EXPIRED','The Linear connection has expired',401,false);
      if(codes.some(code=>/RATE/i.test(code)))throw new ApiError('PROVIDER_RATE_LIMITED','Linear rate limited the request',429,true);
      throw new ApiError('PROVIDER_UNAVAILABLE','Linear could not complete the request',502,false);
    }
    return body.data;
  }
  private async request(input:string,init:RequestInit):Promise<Response>{try{return await this.fetcher(input,init)}catch(error){if(init.signal?.aborted)throw error;throw new ApiError('PROVIDER_UNAVAILABLE','The Linear API could not be reached',502,true,{cause:error})}}
}

function providerHttpError(status:number,message:string):ApiError{
  if(status===401||status===403)return new ApiError('INTEGRATION_AUTH_EXPIRED','The Linear connection has expired',401,false);
  if(status===429)return new ApiError('PROVIDER_RATE_LIMITED','Linear rate limited the request',429,true);
  return new ApiError('PROVIDER_UNAVAILABLE',message,502,status>=500);
}
