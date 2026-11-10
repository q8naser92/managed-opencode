import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Connector } from '../shared/schema.ts';
import type { Store } from './store.ts';
import type { transport } from './transport.ts';

export function connectorAudience(connector:Connector){return JSON.stringify([connector.url,connector.auth,connector.header.toLowerCase(),connector.prefix,connector.oauth??null]);}
export const ConnectorCredential=z.string().min(1).max(16_384).regex(/^[^\r\n]+$/);
const Token=z.object({accessToken:ConnectorCredential,refreshToken:ConnectorCredential.optional(),expires:z.number()}).strict();
type Token=z.infer<typeof Token>;
type Credential={value:string;record:string|null;owner:string;audience:string};
const refreshes=new Map<string,Promise<Credential>>();
export async function exchangeToken(store:Store,connector:Connector,upstream:ReturnType<typeof transport>,fields:URLSearchParams,signal:AbortSignal){
  const oauth=connector.oauth!;const headers:Record<string,string>={'Content-Type':'application/x-www-form-urlencoded'};
  fields.set('client_id',oauth.clientId);if(oauth.resource)fields.set('resource',oauth.resource);
  if(oauth.clientAuth!=='none'){const secret=store.secret('service','connector-oauth-client:'+connector.id,connectorAudience(connector));if(!secret)throw new HTTPException(409,{message:'The administrator must configure the connector OAuth client secret'});if(oauth.clientAuth==='body')fields.set('client_secret',secret);else headers.Authorization='Basic '+Buffer.from(encodeURIComponent(oauth.clientId)+':'+encodeURIComponent(secret)).toString('base64');}
  const response=await upstream(oauth.tokenUrl,{method:'POST',headers,body:fields,signal});if(!response.ok){await response.body?.cancel();throw new HTTPException(409,{message:'Connector sign-in was not accepted; reconnect your account'});}
  const value=z.object({access_token:ConnectorCredential,token_type:z.string().refine(v=>v.toLowerCase()==='bearer'),expires_in:z.number().positive().max(31_536_000).default(3600),refresh_token:ConnectorCredential.optional()}).parse(await response.json());
  return {accessToken:value.access_token,refreshToken:value.refresh_token,expires:Date.now()+value.expires_in*1000};
}
export async function connectorCredential(store:Store,connector:Connector,user:string,upstream:ReturnType<typeof transport>,signal:AbortSignal){
  const owner=connector.auth==='service'?'service':user;const purpose='connector:'+connector.id;const audience=connectorAudience(connector);const raw=store.secret(owner,purpose,audience);
  if(connector.auth==='none')return {value:'',record:null,owner,audience};
  if(!raw)throw new HTTPException(409,{message:connector.auth==='service'?'The administrator must configure the connector credential':'Connect your account before using this connector'});
  if(!connector.oauth)return {value:raw,record:raw,owner,audience};
  const token=Token.parse(JSON.parse(raw));if(token.expires>Date.now()+30_000)return {value:token.accessToken,record:raw,owner,audience};
  if(!token.refreshToken)throw new HTTPException(409,{message:'Connector sign-in expired; reconnect your account'});
  const key=JSON.stringify([owner,purpose,audience]);const existing=refreshes.get(key);if(existing)return existing;
  const work=(async()=>{const value=await exchangeToken(store,connector,upstream,new URLSearchParams({grant_type:'refresh_token',refresh_token:token.refreshToken!}),signal);if(connectorAudience(store.connector(connector.id)!)!==audience||store.secret(owner,purpose,audience)!==raw)throw new HTTPException(409,{message:'Connector credentials changed; retry'});const record=JSON.stringify({...value,refreshToken:value.refreshToken??token.refreshToken});store.putSecret(owner,purpose,audience,record);return {value:value.accessToken,record,owner,audience};})();refreshes.set(key,work);try{return await work;}finally{refreshes.delete(key);}
}
