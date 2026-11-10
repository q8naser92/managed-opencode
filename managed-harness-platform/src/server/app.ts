import { Hono } from 'hono';
import { VERSION } from '../shared/version.ts';
import { HTTPException } from 'hono/http-exception';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { Action, Capability, Connector, HttpsUrl, Policy, Smtp, EmailAddress, approvedModels } from '../shared/schema.ts';
import type { Boot } from '../shared/schema.ts';
import { Store } from './store.ts';
import { Actions } from './actions.ts';
import { authenticate, requireAdmin, requireEngine, requireInteractive } from './authorization.ts';
import type { AppEnv } from './authorization.ts';
import { transport } from './transport.ts';
import { engineConfig } from './engine-config.ts';
import { emailRoutes,mailTransport,smtpAudience,smtpSettings } from './email-login.ts';
import { connectorRoutes } from './connectors.ts';
import { validateTools } from './connector-schema.ts';
import { connectorAudience } from './connector-credentials.ts';

export function createApp(boot:Boot,store:Store) {
  const app = new Hono<AppEnv>(); const actions=new Actions(store);
  const listeners=new Set<(event:string)=>void>();
  const notify=(event:string)=>{for(const fn of listeners) fn(event);};
  const origins=()=>{
    const row=store.db.query<{value:string},[]>('SELECT value FROM settings WHERE id=\'origins\'').get();
    return row ? z.array(HttpsUrl).parse(JSON.parse(row.value)) : boot.allowedOrigins;
  };
  const upstream=transport(boot,origins);
  app.use('*',bodyLimit({maxSize:2*1024*1024}));
  app.use('*',async (c,next)=>{
    c.header('Cache-Control','no-store');c.header('X-Content-Type-Options','nosniff');
    c.header('Referrer-Policy','no-referrer');c.header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    await next();
  });
  app.onError((error,c)=>{
    if (error instanceof HTTPException) return error.getResponse();
    if (error instanceof z.ZodError) return c.json({error:'Invalid request',fields:error.issues.map(i=>i.path.join('.'))},400);
    // Upstream bodies, SAML assertions and submitted credentials must not enter application logs.
    store.audit('service','request.failed',new URL(c.req.url).pathname,'error',{type:error.name});
    return c.json({error:'Request failed; check the configuration or retry'},500);
  });
  app.get('/health',c=>c.json({service:'Managed OpenCode',version:VERSION}));
  app.get('/auth/methods',c=>c.json({saml:!!boot.saml,emailOtp:!!smtpSettings(store)?.enabled}));
  app.route('/auth',emailRoutes(boot,store));
  app.use('/api/*',async(c,next)=>{c.set('principal',authenticate(c,store,boot.origin));await next();});
  app.use('/api/admin/*',async(c,next)=>{requireAdmin(c.get('principal'),store,new URL(c.req.url).pathname);await next();});
  app.get('/api/me',c=>{
    const p=c.get('principal');
    return c.json({id:p.user.id,display:p.user.display,admin:!!p.user.admin,kind:p.session.kind,csrf:p.session.kind==='browser'?p.session.csrf:undefined,hasGatewayKey:!!store.secret(p.user.id,'gateway',store.policy.gatewayUrl)});
  });
  app.post('/api/logout',c=>{const p=c.get('principal');requireInteractive(p);store.revoke(p.session.token);notify('session');store.audit(p.user.id,'user.logout',p.session.kind,'success');return c.json({ok:true});});
  app.post('/api/engine',c=>{const p=c.get('principal');requireInteractive(p);return c.json(store.issue(p.user.id,'engine',p.session.token));});
  app.get('/api/engine/config',c=>{requireEngine(c.get('principal'));return c.json(engineConfig(boot.origin,store.policy,store.connectors()));});
  app.get('/api/catalog',c=>{
    const policy=store.policy;
    return c.json({revision:policy.revision,models:approvedModels(policy),tools:policy.tools,maxCommandSeconds:policy.maxCommandSeconds,maxSessionSteps:policy.maxSessionSteps,
      connectors:store.connectors().filter(conn=>conn.enabled).map(conn=>({id:conn.id,name:conn.name,auth:conn.auth,oauth:!!conn.oauth,connected:conn.auth==='none'||!!store.secret(conn.auth==='service'?'service':c.get('principal').user.id,'connector:'+conn.id,connectorAudience(conn)),version:conn.version,tools:conn.tools.filter(t=>t.enabled&&t.mode!=='deny').map(t=>({name:t.name,description:t.description,inputSchema:t.inputSchema,mode:t.mode}))}))});
  });
  app.get('/api/events',c=>streamSSE(c,async stream=>{
    let changed=true; const listener=()=>{changed=true;}; listeners.add(listener);
    try {
      while (!stream.aborted) {
        if (!store.sessionHash(c.get('principal').session.token)) {await stream.writeSSE({event:'revoked',data:'{}'});break;}
        await stream.writeSSE({event:changed?'policy':'heartbeat',data:JSON.stringify({revision:store.policy.revision,at:Date.now()})});
        changed=false;await stream.sleep(1000);
      }
    } finally {listeners.delete(listener);}
  }));
  app.put('/api/key',async c=>{
    const p=c.get('principal');requireInteractive(p);
    const {key}=z.object({key:z.string().min(1).max(4096).regex(/^[^\r\n]+$/)}).strict().parse(await c.req.json());
    const url=store.policy.gatewayUrl;
    const response=await upstream(url.replace(/\/$/,'')+'/models',{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(15_000)});
    await response.body?.cancel();
    if (!response.ok) throw new HTTPException(400,{message:'Gateway did not accept the key'});
    if (store.policy.gatewayUrl !== url) throw new HTTPException(409,{message:'Gateway changed during enrollment; retry'});
    store.putSecret(p.user.id,'gateway',url,key);store.audit(p.user.id,'credential.enrolled','gateway','success');return c.json({ok:true});
  });
  app.delete('/api/key',c=>{const p=c.get('principal');requireInteractive(p);store.deleteSecret(p.user.id,'gateway');store.audit(p.user.id,'credential.removed','gateway','success');return c.json({ok:true});});
  app.post('/api/actions',async c=>c.json(actions.request(c.get('principal'),Action.parse(await c.req.json()))));
  app.post('/api/actions/consume',async c=>c.json(actions.consume(c.get('principal'),Action.parse(await c.req.json()))));
  app.post('/api/actions/:id/decision',async c=>{
    const {approve}=z.object({approve:z.boolean()}).strict().parse(await c.req.json());
    const result=actions.decide(c.get('principal'),c.req.param('id'),approve);notify('action');return c.json(result);
  });
  app.get('/api/actions/pending',c=>{
    const p=c.get('principal');requireInteractive(p);
    return c.json(store.db.query<{id:string;digest:string;capability:string;session:string},[string,number,number]>("SELECT id,digest,capability,session FROM actions WHERE owner=? AND revision=? AND status='pending' AND expires>?").all(p.user.id,store.policy.revision,Date.now()).map(row=>({...row,preview:actions.previews.get(row.id)?.text??'Preview unavailable; deny and retry.'})));
  });
  app.post('/api/security-event',async c=>{
    const p=c.get('principal');requireEngine(p);
    const value=z.object({event:z.enum(['tool.started','tool.completed','tool.failed','tool.cancelled','client.disconnected']),id:z.string().regex(/^[a-f0-9-]{20,64}$/),capability:Capability,revision:z.number().int().nonnegative()}).strict().parse(await c.req.json());
    const row=actions.get(value.id);
    if (!row || row.engine!==p.session.token) throw new HTTPException(403,{message:'Action ownership required'});
    store.audit(p.user.id,value.event,value.capability,'client-reported',{id:value.id,revision:value.revision});return c.json({ok:true});
  });
  app.get('/api/admin/policy',c=>c.json(store.policy));
  app.put('/api/admin/policy',async c=>{
    const value=Policy.parse(await c.req.json());
    if (!origins().some(u=>new URL(u).origin===new URL(value.gatewayUrl).origin)) throw new HTTPException(400,{message:'Approve the gateway origin first'});
    if (value.revision!==store.policy.revision) throw new HTTPException(409,{message:'Policy changed; reload'});
    const next=store.setPolicy(value,c.get('principal').user.id);notify('policy');return c.json(next);
  });
  app.get('/api/admin/origins',c=>c.json(origins()));
  app.post('/api/admin/origins/approve',async c=>{
    const added=z.array(HttpsUrl.refine(v=>new URL(v).origin===v,'Use an origin without a path')).min(1).max(3).parse(await c.req.json());
    const values=store.db.transaction(()=>{const values=[...new Set([...origins(),...added])];if(values.length>100)throw new HTTPException(400,{message:'At most 100 destinations can be approved'});store.db.query("INSERT INTO settings VALUES('origins',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").run(JSON.stringify(values));store.audit(c.get('principal').user.id,'destinations.approved','upstream','success',{origins:added});return values;})();notify('destinations');return c.json(values);
  });
  app.put('/api/admin/origins',async c=>{
    const values=z.array(HttpsUrl.refine(v=>new URL(v).origin===v,'Use an origin without a path')).min(1).max(100).parse(await c.req.json());
    store.db.query("INSERT INTO settings VALUES('origins',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").run(JSON.stringify(values));
    store.audit(c.get('principal').user.id,'destinations.changed','upstream','success',{origins:values});notify('destinations');return c.json(values);
  });
  app.get('/api/admin/connectors',c=>c.json(store.connectors()));
  app.put('/api/admin/connectors/:id',async c=>{
    const value=Connector.parse(await c.req.json());
    validateTools(value);
    if (value.id!==c.req.param('id')) throw new HTTPException(400,{message:'Connector ID mismatch'});
    if (!origins().some(u=>new URL(u).origin===new URL(value.url).origin)) throw new HTTPException(400,{message:'Approve the connector origin first'});
    if(value.oauth&&[value.oauth.authorizationUrl,value.oauth.tokenUrl].some(url=>!origins().some(u=>new URL(u).origin===new URL(url).origin)))throw new HTTPException(400,{message:'Approve the OAuth authorization and token origins first'});
    const old=store.connector(value.id);
    if (old && old.version!==value.version) throw new HTTPException(409,{message:'Connector changed; reload'});
    const next=store.putConnector(value,c.get('principal').user.id);notify('connector');return c.json(next);
  });
  app.get('/api/admin/users',c=>c.json(store.db.query('SELECT id,display,admin,disabled,created FROM users ORDER BY created DESC').all()));
  app.post('/api/admin/users/local',async c=>{
    const {email}=z.object({email:EmailAddress}).strict().parse(await c.req.json());
    if(store.localUser(email))throw new HTTPException(409,{message:'Email account already exists'});
    const user=store.createLocalUser(email);store.audit(c.get('principal').user.id,'user.local.created',user.id,'success');return c.json({id:user.id,display:user.display});
  });
  app.get('/api/admin/smtp',c=>{const value=smtpSettings(store);return c.json({settings:value,hasCredential:value?!!store.secret('service','smtp',smtpAudience(value)):false});});
  app.put('/api/admin/smtp',async c=>{
    const {settings,password}=z.object({settings:Smtp,password:z.string().min(1).max(4096).optional()}).strict().parse(await c.req.json());
    const prior=smtpSettings(store);
    if(prior&&smtpAudience(prior)!==smtpAudience(settings))store.deleteSecret('service','smtp');
    if(password)store.putSecret('service','smtp',smtpAudience(settings),password);
    store.db.query("INSERT INTO settings VALUES('smtp',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").run(JSON.stringify(settings));
    store.audit(c.get('principal').user.id,'smtp.changed','email','success',{host:settings.host,port:settings.port,mode:settings.mode,enabled:settings.enabled});return c.json({ok:true});
  });
  app.post('/api/admin/smtp/test',async c=>{const settings=smtpSettings(store);if(!settings)throw new HTTPException(400,{message:'Configure SMTP first'});const transport=mailTransport(boot,store,settings);try{await transport.verify();}finally{transport.close();}store.audit(c.get('principal').user.id,'smtp.tested','email','success');return c.json({ok:true});});
  app.put('/api/admin/users/:id',async c=>{
    const {disabled}=z.object({disabled:z.boolean()}).strict().parse(await c.req.json());
    const id=c.req.param('id');if (!store.user(id)) throw new HTTPException(404,{message:'User not found'});
    if (id===c.get('principal').user.id) throw new HTTPException(400,{message:'Cannot disable your own administration session'});
    store.db.query('UPDATE users SET disabled=? WHERE id=?').run(disabled?1:0,id);
    if (disabled) store.db.query('DELETE FROM sessions WHERE user_id=?').run(id);
    store.audit(c.get('principal').user.id,'user.status.changed',id,'success',{disabled});notify('session');return c.json({ok:true});
  });
  app.get('/api/admin/audit',c=>c.json(store.db.query('SELECT * FROM audit ORDER BY seq DESC LIMIT 250').all()));
  app.get('/api/gateway/v1/models',c=>c.json({object:'list',data:approvedModels(store.policy).map(m=>({id:m.id,object:'model',owned_by:'managed'}))}));
  const completion=z.object({model:z.string().min(1).max(120),messages:z.array(z.unknown()).min(1),stream:z.boolean().optional(),stream_options:z.object({include_usage:z.boolean()}).optional(),tools:z.array(z.unknown()).optional(),tool_choice:z.unknown().optional(),parallel_tool_calls:z.boolean().optional(),temperature:z.number().optional(),top_p:z.number().optional(),max_tokens:z.number().int().positive().optional(),max_completion_tokens:z.number().int().positive().optional(),stop:z.union([z.string(),z.array(z.string())]).optional(),response_format:z.unknown().optional(),reasoning_effort:z.enum(['none','minimal','low','medium','high','xhigh']).optional(),seed:z.number().int().optional(),presence_penalty:z.number().optional(),frequency_penalty:z.number().optional()}).strict();
  app.post('/api/gateway/v1/chat/completions',async c=>{
    const p=c.get('principal');const input=completion.parse(await c.req.json());const policy=store.policy;
    if (!approvedModels(policy).some(m=>m.id===input.model)) {store.audit(p.user.id,'model.denied',input.model,'denied');throw new HTTPException(403,{message:'Model is not approved'});}
    const key=store.secret(p.user.id,'gateway',policy.gatewayUrl);
    if (!key) throw new HTTPException(409,{message:'Enter a personal gateway key for the current gateway'});
    const controller=new AbortController();const onChange=()=>{if (!store.sessionHash(p.session.token)||!approvedModels(store.policy).some(m=>m.id===input.model)||store.policy.gatewayUrl!==policy.gatewayUrl) controller.abort();};listeners.add(onChange);
    const expiryWatch=setInterval(onChange,1000);
    const cleanup=()=>{clearInterval(expiryWatch);listeners.delete(onChange);};
    let response:Response;
    try {response=await upstream(policy.gatewayUrl.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.any([controller.signal,c.req.raw.signal,AbortSignal.timeout(600_000)])});}
    catch (error) {cleanup();throw error;}
    if (!response.ok) {cleanup();await response.body?.cancel();throw new HTTPException(502,{message:'Gateway request failed'});}
    const reader=response.body?.getReader();
    const body=new ReadableStream<Uint8Array>({async pull(out){try {const next=await reader?.read();if(controller.signal.aborted)throw new Error('Session or policy revoked');if(!next||next.done){cleanup();out.close();return;}out.enqueue(next.value);}catch(error){cleanup();out.error(error);}},async cancel(){cleanup();controller.abort();await reader?.cancel();}});
    return new Response(body,{headers:{'Content-Type':response.headers.get('Content-Type')??'application/json','Cache-Control':'no-store'}});
  });
  connectorRoutes(app,boot,store,actions,upstream,listeners,notify,origins);
  return app;
}
