import { test,expect,afterEach } from 'bun:test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { randomBytes,createHash } from 'node:crypto';
import { Store,hash } from '../src/server/store.ts';
import { Policy,Connector } from '../src/shared/schema.ts';
import { createApp } from '../src/server/app.ts';
import { connectorAudience } from '../src/server/connector-credentials.ts';
import { importOpenApi,apiUrl,validator } from '../src/server/connector-schema.ts';
const certificate=join(import.meta.dir,'fixtures/smtp-test-cert.pem');
const close:Array<()=>void>=[];afterEach(()=>{for(const action of close.splice(0))action();});
function fixture(){
  const observed:{tool:string;owner:string;arguments:unknown}[]=[];let drift=false;let calls=0;let tokens=0;let listWait:Promise<void>|undefined;let resumeList:(()=>void)|undefined;let listing=false;let tokenWait:Promise<void>|undefined;let resumeToken:(()=>void)|undefined;const codes=new Map<string,{challenge:string;redirect:string;resource:string}>();
  const remoteTool=()=>({name:'read_issue',description:'Read one lab issue',inputSchema:{type:'object',properties:{issue_key:{type:drift?'number':'string'}},required:['issue_key'],additionalProperties:false}});
  const target=Bun.serve({hostname:'127.0.0.1',port:0,tls:{cert:Bun.file(certificate),key:Bun.file(join(import.meta.dir,'fixtures/smtp-test-key.pem'))},async fetch(req){
    const url=new URL(req.url);const owner=({'Bearer service-test-key':'service','Bearer alice-test-key':'alice','Bearer bob-test-key':'bob','Bearer oauth-alice':'oauth-alice'}as Record<string,string>)[req.headers.get('Authorization')??'']??'unknown';
    if(url.pathname==='/authorize'){const code='code-'+randomBytes(8).toString('hex');codes.set(code,{challenge:url.searchParams.get('code_challenge')!,redirect:url.searchParams.get('redirect_uri')!,resource:url.searchParams.get('resource')!});const callback=new URL(url.searchParams.get('redirect_uri')!);callback.searchParams.set('code',code);callback.searchParams.set('state',url.searchParams.get('state')!);return Response.redirect(callback.href,302);}
    if(url.pathname==='/token'){tokens++;if(tokenWait)await tokenWait;const body=new URLSearchParams(await req.text());if(body.get('grant_type')==='refresh_token'){if(body.get('refresh_token')!=='refresh-alice')return new Response('',{status:400});return Response.json({access_token:'oauth-alice',refresh_token:'refresh-alice',token_type:'Bearer',expires_in:3600});}const code=body.get('code')!;const pending=codes.get(code);codes.delete(code);if(!pending||pending.challenge!==createHash('sha256').update(body.get('code_verifier')!).digest('base64url')||pending.redirect!==body.get('redirect_uri')||pending.resource!==body.get('resource'))return new Response('',{status:400});return Response.json({access_token:'oauth-alice',refresh_token:'refresh-alice',token_type:'Bearer',expires_in:3600});}
    if(owner==='unknown')return new Response('Unauthorized',{status:401});
    if(url.pathname.startsWith('/api/')){calls++;if(url.pathname.endsWith('/slow'))await Bun.sleep(2500);if(url.pathname.endsWith('/redirect'))return Response.redirect(url.origin+'/unapproved',302);observed.push({tool:url.pathname,owner,arguments:url.search});return Response.json({owner,path:url.pathname,query:Object.fromEntries(url.searchParams)});}
    if(req.method!=='POST')return new Response(null,{status:405});const body=await req.json();const reply=(result:unknown)=>Response.json({jsonrpc:'2.0',id:body.id,result});
    if(body.method==='initialize')return reply({protocolVersion:body.params.protocolVersion,serverInfo:{name:'TLS test connector',version:'1'},capabilities:{tools:{}}});
    if(body.method==='notifications/initialized')return new Response(null,{status:202});
    if(body.method==='tools/list'){listing=true;if(listWait)await listWait;return reply({tools:[remoteTool(),{name:'unapproved_write',description:'Not approved',inputSchema:{type:'object'}}]});}
    if(body.method==='tools/call'){calls++;observed.push({tool:body.params.name,owner,arguments:body.params.arguments});return reply({content:[{type:'text',text:JSON.stringify({owner,issue:body.params.arguments.issue_key})}]});}
    return new Response(null,{status:400});
  }});close.push(()=>target.stop(true));
  const origin=`https://127.0.0.1:${target.port}`;const store=new Store(':memory:',randomBytes(32));close.push(()=>store.close());const policy=Policy.parse({revision:0,gatewayUrl:origin+'/v1',models:[],tools:{read:'allow',edit:'ask',cmd:'deny',powershell:'deny'},maxCommandSeconds:30,maxSessionSteps:10});store.initialize(policy);
  const app=createApp({origin:'https://manager.example',port:7443,tlsCert:'unused',tlsKey:'unused',caFile:certificate,allowedOrigins:[origin],initialPolicy:policy},store);
  const admin=store.upsertUser('admin','Admin',true);const alice=store.upsertUser('alice','Alice',false);const bob=store.upsertUser('bob','Bob',false);const adminSession=store.issue(admin.id,'browser');const aliceBrowser=store.issue(alice.id,'browser');const aliceDesktop=store.issue(alice.id,'desktop');const bobDesktop=store.issue(bob.id,'desktop');const engine=store.issue(alice.id,'engine',hash(aliceDesktop.token));const bobEngine=store.issue(bob.id,'engine',hash(bobDesktop.token));
  const api=(path:string,method='GET',body?:unknown,token=engine.token)=>app.request('https://manager.example'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const browser=(path:string,method='GET',body?:unknown,session=adminSession)=>app.request('https://manager.example'+path,{method,headers:{Cookie:'__Host-moc='+session.token,Origin:'https://manager.example','X-CSRF-Token':session.csrf,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const connector=Connector.parse({id:'jira',name:'Lab Jira',url:origin+'/mcp',type:'mcp',auth:'service',enabled:true,tools:[{...remoteTool(),enabled:true,mode:'allow',resourceRules:{issue_key:['LAB-1']}}]});store.putConnector(connector,admin.id);store.putSecret('service','connector:jira',connectorAudience(connector),'service-test-key');
  const call=(args:unknown={issue_key:'LAB-1'},name='read_issue',token=engine.token)=>api('/api/connectors/jira/mcp','POST',{jsonrpc:'2.0',id:randomBytes(8).toString('hex'),method:'tools/call',params:{name,arguments:args}},token);
  return{store,app,origin,api,browser,connector,admin,alice,bob,aliceDesktop,aliceBrowser,adminSession,bobDesktop,engine,bobEngine,call,observed,calls:()=>calls,tokens:()=>tokens,drift:()=>{drift=true;},pauseDiscovery:()=>{listWait=new Promise<void>(r=>resumeList=r);},listing:()=>listing,resumeDiscovery:()=>resumeList?.(),pauseToken:()=>{tokenWait=new Promise<void>(r=>resumeToken=r);},resumeToken:()=>resumeToken?.()};
}

test('MCP discovers without executing, exposes approved tools only and enforces schemas and resource scope',async()=>{
  const f=fixture();expect((await f.api('/api/admin/connectors/jira/discover','POST',{})).status).toBe(403);
  const discovery=await f.browser('/api/admin/connectors/jira/discover','POST',{});expect(discovery.status).toBe(200);const tools=(await discovery.json()).tools;expect(tools).toHaveLength(2);expect(tools.every((t:{enabled:boolean;mode:string})=>!t.enabled&&t.mode==='deny')).toBe(true);expect(f.calls()).toBe(0);
  const listing=await f.api('/api/connectors/jira/mcp','POST',{jsonrpc:'2.0',id:1,method:'tools/list'});expect((await listing.json()).result.tools.map((t:{name:string})=>t.name)).toEqual(['read_issue']);
  expect((await f.call({},'unapproved_write')).status).toBe(403);expect((await f.call({issue_key:'OTHER-1'})).status).toBe(403);expect((await f.call({issue_key:1})).status).toBe(400);expect((await f.call({issue_key:'LAB-1',url:'https://other.example'})).status).toBe(400);expect(f.calls()).toBe(0);
  const allowed=await f.call();expect(allowed.status).toBe(200);expect(JSON.stringify(await allowed.json())).toContain('service');expect(f.calls()).toBe(1);
  const audit=JSON.stringify(f.store.db.query('SELECT * FROM audit').all());expect(audit).not.toContain('service-test-key');expect(audit).not.toContain('LAB-1');
});
test('personal keys are isolated, engine cannot enroll, credentials never follow an auth or URL change',async()=>{
  const f=fixture();const connector=f.store.putConnector({...f.store.connector('jira')!,auth:'personal'},f.admin.id);
  expect((await f.api('/api/connectors/jira/credential','PUT',{credential:'alice-test-key'})).status).toBe(403);expect((await f.call()).status).toBe(409);
  for(const [token,credential]of [[f.aliceDesktop.token,'alice-test-key'],[f.bobDesktop.token,'bob-test-key']])expect((await f.api('/api/connectors/jira/credential','PUT',{credential},token)).status).toBe(200);
  expect((await f.call()).status).toBe(200);expect((await f.call({issue_key:'LAB-1'},'read_issue',f.bobEngine.token)).status).toBe(200);expect(f.observed.map(x=>x.owner)).toEqual(['alice','bob']);
  f.store.putConnector({...connector,header:'X-API-Key',prefix:''},f.admin.id);expect((await f.call()).status).toBe(409);expect(f.calls()).toBe(2);
});
test('connector ask waits for the owning user; engine and another user cannot approve it',async()=>{
  const f=fixture();f.store.putConnector({...f.store.connector('jira')!,tools:f.connector.tools.map(t=>({...t,mode:'ask'}))},f.admin.id);const request=f.call();
  let pending:{id:string}[]=[];for(let n=0;n<40;n++){pending=await(await f.api('/api/actions/pending','GET',undefined,f.aliceDesktop.token)).json();if(pending.length)break;await Bun.sleep(25);}expect(pending).toHaveLength(1);expect(f.calls()).toBe(0);
  expect((await f.api('/api/actions/'+pending[0]!.id+'/decision','POST',{approve:true})).status).toBe(403);expect((await f.api('/api/actions/'+pending[0]!.id+'/decision','POST',{approve:true},f.bobDesktop.token)).status).toBe(404);expect((await f.api('/api/actions/'+pending[0]!.id+'/decision','POST',{approve:true},f.aliceDesktop.token)).status).toBe(200);expect((await request).status).toBe(200);expect(f.calls()).toBe(1);
},10_000);
test('changed upstream schema requires rediscovery; disabling a connector rejects direct engine calls',async()=>{
  const f=fixture();f.drift();expect((await f.call()).status).toBe(409);expect(f.calls()).toBe(0);expect((await f.browser('/api/admin/connectors/jira','PUT',{...f.store.connector('jira')!,enabled:false})).status).toBe(200);expect((await f.call()).status).toBe(404);
});
test('custom API paths, query parameters, argument constraints and redirects are enforced',async()=>{
  const f=fixture();const tool={name:'issue',description:'Read',inputSchema:{type:'object',properties:{id:{type:'string'},search:{type:'string'}},required:['id'],additionalProperties:false},enabled:true,mode:'allow' as const,method:'GET' as const,path:'/issues/{id}',queryParams:[],resourceRules:{id:['LAB-1']}};
  f.store.putConnector(Connector.parse({...f.store.connector('jira')!,type:'api',url:f.origin+'/api',tools:[tool]}),f.admin.id);f.store.putSecret('service','connector:jira',connectorAudience(f.store.connector('jira')!),'service-test-key');
  expect((await f.call({id:'LAB-1',search:'x&unexpected=1'},'issue')).status).toBe(200);expect(f.observed[0]?.arguments).toBe('?search=x%26unexpected%3D1');expect((await f.call({id:'../secret'},'issue')).status).toBe(403);
  for(const path of ['//host/path','/../secret','/%2e%2e/secret','/path?query=1','/path\\file','/.\t./outside','/safe/\n../\n../outside','/..\r/outside'])expect(()=>apiUrl(f.store.connector('jira')!,{...tool,path},{id:'LAB-1'})).toThrow();
  f.store.putConnector({...f.store.connector('jira')!,tools:[{...tool,path:'/redirect'}]},f.admin.id);expect((await f.call({id:'LAB-1'},'issue')).status).toBe(502);
});
test('live connector disable cancels a waiting upstream response; no result is returned after revocation',async()=>{
  const f=fixture();f.store.putConnector(Connector.parse({...f.store.connector('jira')!,type:'api',url:f.origin+'/api',tools:[{name:'slow',inputSchema:{type:'object',additionalProperties:false},enabled:true,mode:'allow',method:'GET',path:'/slow'}]}),f.admin.id);f.store.putSecret('service','connector:jira',connectorAudience(f.store.connector('jira')!),'service-test-key');
  const request=f.call({},'slow');for(let n=0;n<40&&f.calls()===0;n++)await Bun.sleep(25);expect(f.calls()).toBe(1);expect((await f.browser('/api/admin/connectors/jira','PUT',{...f.store.connector('jira')!,enabled:false})).status).toBe(200);expect((await request).status).toBe(502);expect(f.store.db.query("SELECT result FROM audit WHERE event='connector.call' ORDER BY seq DESC LIMIT 1").get()).toEqual({result:'cancelled'});
},10_000);
test('OAuth uses browser binding, PKCE and owner-bound encrypted tokens; callback replay is rejected',async()=>{
  const f=fixture();const connector=f.store.putConnector({...f.store.connector('jira')!,auth:'personal',oauth:{authorizationUrl:f.origin+'/authorize',tokenUrl:f.origin+'/token',clientId:'fixture-client',scope:'issues.read',resource:f.origin+'/mcp',clientAuth:'none'}},f.admin.id);
  expect((await f.api('/api/connectors/jira/oauth/start','POST',{},f.aliceDesktop.token)).status).toBe(403);
  const theft=await(await f.browser('/api/connectors/jira/oauth/start','POST',{},f.aliceBrowser)).json();expect((await f.app.request(theft.url,{headers:{Cookie:'__Host-moc='+f.adminSession.token}})).status).toBe(403);
  const start=await(await f.browser('/api/connectors/jira/oauth/start','POST',{},f.aliceBrowser)).json();const redirect=await f.app.request(start.url,{headers:{Cookie:'__Host-moc='+f.aliceBrowser.token}});expect(redirect.status).toBe(302);const nonce=redirect.headers.get('set-cookie')!.split(';')[0]!;
  const authorization=new URL(redirect.headers.get('location')!);expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');expect(authorization.searchParams.get('resource')).toBe(f.origin+'/mcp');
  const identity=await fetch(authorization,{proxy:false,redirect:'manual',tls:{ca:readFileSync(certificate,'utf8'),rejectUnauthorized:true}});const callback=identity.headers.get('location')!;
  expect((await f.app.request(callback)).status).toBe(403);expect(f.tokens()).toBe(0);expect((await f.app.request(callback,{headers:{Cookie:nonce}})).status).toBe(200);expect(f.tokens()).toBe(1);expect((await f.app.request(callback,{headers:{Cookie:nonce}})).status).toBe(400);
  expect((await f.call()).status).toBe(200);expect(f.observed[0]?.owner).toBe('oauth-alice');expect((await f.call({issue_key:'LAB-1'},'read_issue',f.bobEngine.token)).status).toBe(409);
  const value=JSON.parse(f.store.secret(f.alice.id,'connector:jira',connectorAudience(connector))!);value.expires=0;f.store.putSecret(f.alice.id,'connector:jira',connectorAudience(connector),JSON.stringify(value));expect((await f.call()).status).toBe(200);expect(f.tokens()).toBe(2);
  const rows=JSON.stringify(f.store.db.query('SELECT ciphertext FROM secrets').all());expect(rows).not.toContain('oauth-alice');expect(rows).not.toContain('refresh-alice');
});
test('OpenAPI import resolves local schemas, leaves every operation unapproved and rejects remote references',()=>{
  const tools=importOpenApi({openapi:'3.0.3',components:{schemas:{Identifier:{type:'string'}}},paths:{'/issues/{id}':{get:{operationId:'get_issue',parameters:[{name:'id',in:'path',required:true,schema:{$ref:'#/components/schemas/Identifier'}}]}}}});expect(tools).toHaveLength(1);expect(tools[0]!.enabled).toBe(false);expect(tools[0]!.mode).toBe('deny');expect(validator(tools[0]!.inputSchema)({id:'LAB-1'})).toBe(true);expect(validator(tools[0]!.inputSchema)({id:1})).toBe(false);
  expect(()=>importOpenApi({openapi:'3.0.3',paths:{'/x':{$ref:'https://unapproved.example/schema'}}})).toThrow();expect(()=>validator({type:'object',properties:{x:{$ref:'https://unapproved.example/schema'}}})).toThrow();
});
test('disconnecting or replacing a personal credential during discovery prevents business-tool dispatch',async()=>{
  for(const replace of [false,true]){const f=fixture();const connector=f.store.putConnector({...f.store.connector('jira')!,auth:'personal'},f.admin.id);f.store.putSecret(f.alice.id,'connector:jira',connectorAudience(connector),'alice-test-key');f.pauseDiscovery();const pending=f.call();for(let n=0;n<80&&!f.listing();n++)await Bun.sleep(10);expect(f.listing()).toBe(true);expect((await f.api('/api/connectors/jira/credential',replace?'PUT':'DELETE',replace?{credential:'bob-test-key'}:undefined,f.aliceDesktop.token)).status).toBe(200);f.resumeDiscovery();expect([403,502]).toContain((await pending).status);expect(f.calls()).toBe(0);}
},10_000);
test('removing an approved origin cancels active connector work before its result is returned',async()=>{
  const f=fixture();f.store.putConnector(Connector.parse({...f.store.connector('jira')!,type:'api',url:f.origin+'/api',tools:[{name:'slow',inputSchema:{type:'object',additionalProperties:false},enabled:true,mode:'allow',method:'GET',path:'/slow'}]}),f.admin.id);f.store.putSecret('service','connector:jira',connectorAudience(f.store.connector('jira')!),'service-test-key');const pending=f.call({},'slow');for(let n=0;n<80&&f.calls()===0;n++)await Bun.sleep(10);expect(f.calls()).toBe(1);expect((await f.browser('/api/admin/origins','PUT',['https://remaining.example'])).status).toBe(200);expect((await pending).status).toBe(502);
},10_000);

test('disconnect invalidates pending OAuth even with no prior credential and during the token exchange',async()=>{
  for(const existing of [false,true])for(const delayed of [false,true]){
    const f=fixture();const connector=f.store.putConnector({...f.store.connector('jira')!,auth:'personal',oauth:{authorizationUrl:f.origin+'/authorize',tokenUrl:f.origin+'/token',clientId:'fixture-client',scope:'issues.read',clientAuth:'none'}},f.admin.id);
    if(existing)f.store.putSecret(f.alice.id,'connector:jira',connectorAudience(connector),'old-credential');
    const start=await(await f.browser('/api/connectors/jira/oauth/start','POST',{},f.aliceBrowser)).json();
    const redirect=await f.app.request(start.url,{headers:{Cookie:'__Host-moc='+f.aliceBrowser.token}});const nonce=redirect.headers.get('set-cookie')!.split(';')[0]!;
    const identity=await fetch(redirect.headers.get('location')!,{proxy:false,redirect:'manual',tls:{ca:readFileSync(certificate,'utf8'),rejectUnauthorized:true}});
    if(delayed)f.pauseToken();
    const callback=()=>f.app.request(identity.headers.get('location')!,{headers:{Cookie:nonce}});
    const pending=delayed?callback():undefined;
    if(delayed){for(let n=0;n<80&&f.tokens()===0;n++)await Bun.sleep(10);expect(f.tokens()).toBe(1);}
    expect((await f.api('/api/connectors/jira/credential','DELETE',undefined,f.aliceDesktop.token)).status).toBe(200);
    if(delayed)f.resumeToken();
    expect((await(pending??callback())).status).toBe(409);expect(f.store.secret(f.alice.id,'connector:jira',connectorAudience(connector))).toBeNull();
    if(!delayed)expect(f.tokens()).toBe(0);
  }
},10_000);

test('reserved prototype scope cannot silently disappear, including permissive schemas',async()=>{
  const f=fixture();const raw=JSON.parse('{"name":"reserved","description":"reserved","inputSchema":{"type":"object","properties":{"__proto__":{"type":"string"}},"additionalProperties":true},"resourceRules":{"__proto__":["APPROVED"]},"enabled":true,"mode":"allow"}');
  expect(()=>Connector.parse({...f.store.connector('jira')!,tools:[raw]})).toThrow();
  expect((await f.browser('/api/admin/connectors/jira','PUT',{...f.store.connector('jira')!,tools:[raw]})).status).toBe(400);
  expect(()=>validator(raw.inputSchema)).toThrow();expect(f.calls()).toBe(0);
  const regular=importOpenApi({openapi:'3.0.3',paths:{'/read':{get:{operationId:'read_constructor',parameters:[{name:'constructor',in:'query',schema:{type:'string'}},{name:'toString',in:'query',schema:{type:'string'}}]}}}})[0]!;
  expect(Object.hasOwn(regular.inputSchema.properties as object,'constructor')).toBe(true);expect(validator(regular.inputSchema)({constructor:'APPROVED',toString:'OK'})).toBe(true);
});

test('connector destination approval does not restore an unrelated concurrently revoked origin',async()=>{
  const f=fixture();expect((await f.browser('/api/admin/origins','PUT',[f.origin,'https://retained.example'])).status).toBe(200);
  const stale=await(await f.browser('/api/admin/origins')).json();expect(stale).toContain(f.origin);
  expect((await f.browser('/api/admin/origins','PUT',['https://retained.example'])).status).toBe(200);
  const response=await f.browser('/api/admin/origins/approve','POST',['https://new-connector.example']);expect(response.status).toBe(200);expect(await response.json()).toEqual(['https://retained.example','https://new-connector.example']);
  expect((await f.api('/api/admin/origins/approve','POST',[f.origin])).status).toBe(403);
});
