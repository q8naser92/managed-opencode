import { afterEach, describe, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { Store, hash } from '../src/server/store.ts';
import { createApp } from '../src/server/app.ts';
import { Policy } from '../src/shared/schema.ts';
import type { Boot } from '../src/shared/schema.ts';

const stores:Store[]=[];
afterEach(()=>{for(const store of stores.splice(0)) store.close();});
function fixture() {
  const store=new Store(':memory:',randomBytes(32)); stores.push(store);
  const policy=Policy.parse({revision:0,gatewayUrl:'https://gateway.example/v1',cloudModels:false,models:[{id:'local',name:'Local',enabled:true,cloud:false},{id:'cloud',name:'Cloud',enabled:true,cloud:true}],tools:{read:'allow',edit:'allow',cmd:'allow',powershell:'allow'},maxCommandSeconds:60,maxSessionSteps:20,localAudit:true});
  store.initialize(policy);
  const boot:Boot={origin:'https://manager.example',port:7443,tlsCert:'unused',tlsKey:'unused',saml:{entryPoint:'https://idp.example/sso',idpIssuer:'test',idpCert:'unused',entityId:'test',signingKey:'unused',signingCert:'unused',adminSubjects:['admin']},allowedOrigins:['https://gateway.example','https://connector.example'],initialPolicy:policy};
  const admin=store.upsertUser('admin','Admin',true);const alice=store.upsertUser('alice','Alice',false);const bob=store.upsertUser('bob','Bob',false);
  const adminBrowser=store.issue(admin.id,'browser');const aliceDesktop=store.issue(alice.id,'desktop');
  const engine=store.issue(alice.id,'engine',hash(aliceDesktop.token));const adminEngine=store.issue(admin.id,'engine',hash(adminBrowser.token));const bobDesktop=store.issue(bob.id,'desktop');
  const app=createApp(boot,store);
  const call=(path:string,token=engine.token,method='GET',body?:unknown)=>app.request(boot.origin+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const adminCall=(path:string,method='GET',body?:unknown,csrf=adminBrowser.csrf)=>app.request(boot.origin+path,{method,headers:{Cookie:'__Host-moc='+adminBrowser.token,Origin:boot.origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const action=()=>({id:randomUUID(),session:'test-session',capability:'cmd',digest:hash('echo safe')});
  return {store,policy,app,boot,admin,alice,bob,adminBrowser,aliceDesktop,engine,adminEngine,bobDesktop,call,adminCall,action};
}

describe('central authority cannot be changed by user or AI sessions',()=>{
  test('an existing Windows policy denies macOS shells without changing Windows permissions',async()=>{
    const f=fixture();
    // Simulate a database written by 0.1.4, before the macOS field existed.
    const legacy={...f.policy,tools:{read:'allow',edit:'allow',cmd:'allow',powershell:'allow'}};
    f.store.db.query("UPDATE settings SET value=? WHERE id='policy'").run(JSON.stringify(legacy));
    expect(f.store.policy.tools).toEqual({read:'allow',edit:'allow',cmd:'allow',powershell:'allow',shell:'deny'});
    const catalog=await (await f.call('/api/catalog')).json();
    expect(catalog.tools.shell).toBe('deny');
    const action={...f.action(),capability:'shell'};
    expect((await (await f.call('/api/actions',undefined,'POST',action)).json()).status).toBe('denied');
    expect((await f.call('/api/actions/consume',undefined,'POST',action)).status).toBe(403);
    expect((await (await f.call('/api/actions',undefined,'POST',f.action())).json()).status).toBe('approved');
  });
  test('macOS shell approval is owned, consumed once, audited and revoked centrally',async()=>{
    const f=fixture();
    expect((await f.adminCall('/api/admin/policy','PUT',{...f.policy,tools:{...f.policy.tools,cmd:'deny',powershell:'deny',shell:'ask'}})).status).toBe(200);
    const action={...f.action(),capability:'shell',preview:'printf approved'};
    expect((await (await f.call('/api/actions',undefined,'POST',action)).json()).status).toBe('pending');
    expect((await f.call('/api/actions/'+action.id+'/decision',f.engine.token,'POST',{approve:true})).status).toBe(403);
    expect((await f.call('/api/actions/'+action.id+'/decision',f.bobDesktop.token,'POST',{approve:true})).status).toBe(404);
    expect((await f.call('/api/actions/'+action.id+'/decision',f.aliceDesktop.token,'POST',{approve:true})).status).toBe(200);
    expect((await f.call('/api/actions/consume',undefined,'POST',action)).status).toBe(200);
    expect((await f.call('/api/actions/consume',undefined,'POST',action)).status).toBe(403);
    expect((await f.call('/api/security-event',undefined,'POST',{event:'tool.started',id:action.id,capability:'shell',revision:1})).status).toBe(200);
    expect(f.store.db.query("SELECT target FROM audit WHERE event='tool.started'").get()).toEqual({target:'shell'});
    const policy=f.store.policy;
    expect((await f.adminCall('/api/admin/policy','PUT',{...policy,tools:{...policy.tools,shell:'allow'}})).status).toBe(200);
    const pending={...f.action(),capability:'shell'};
    expect((await (await f.call('/api/actions',undefined,'POST',pending)).json()).status).toBe('approved');
    expect((await (await f.call('/api/actions',undefined,'POST',f.action())).json()).status).toBe('denied');
    const current=f.store.policy;
    expect((await f.adminCall('/api/admin/policy','PUT',{...current,tools:{...current.tools,shell:'deny'}})).status).toBe(200);
    expect((await f.call('/api/actions/consume',undefined,'POST',pending)).status).toBe(403);
    expect((await (await f.call('/api/actions',undefined,'POST',{...f.action(),capability:'shell'})).json()).status).toBe('denied');
  });
  test('ordinary user and engine cannot add a connector or modify policy',async()=>{
    const f=fixture();
    for(const token of [f.engine.token,f.aliceDesktop.token,f.adminEngine.token]) {
      expect((await f.call('/api/admin/policy',token,'PUT',f.policy)).status).toBe(403);
      expect((await f.call('/api/admin/connectors/rogue',token,'PUT',{url:'https://connector.example'})).status).toBe(403);
      expect((await f.call('/api/admin/origins',token,'PUT',['https://attacker.example'])).status).toBe(403);
    }
    expect(f.store.policy.revision).toBe(0);expect(f.store.connectors()).toHaveLength(0);
    expect(f.store.db.query("SELECT COUNT(*) AS n FROM audit WHERE event='admin.denied'").get()).toEqual({n:9});
  });
  test('administrator cookie session requires valid CSRF and rejects external origins',async()=>{
    const f=fixture();expect((await f.adminCall('/api/admin/policy','PUT',f.policy,'wrong')).status).toBe(403);
    const r=await f.app.request(f.boot.origin+'/api/admin/policy',{method:'PUT',headers:{Cookie:'__Host-moc='+f.adminBrowser.token,Origin:'https://other.example','X-CSRF-Token':f.adminBrowser.csrf,'Content-Type':'application/json'},body:JSON.stringify(f.policy)});
    expect(r.status).toBe(403);expect((await f.adminCall('/api/admin/policy','PUT',f.policy)).status).toBe(200);
    expect(f.store.policy.revision).toBe(1);expect((await f.adminCall('/api/admin/policy','PUT',f.policy)).status).toBe(409);
  });
  test('engine cannot enroll a key, mint another engine or approve its own work',async()=>{
    const f=fixture();expect((await f.call('/api/key',undefined,'PUT',{key:'test'})).status).toBe(403);
    expect((await f.call('/api/engine',undefined,'POST',{})).status).toBe(403);
    const a=f.action();f.store.setPolicy({...f.policy,tools:{...f.policy.tools,cmd:'ask'}},f.admin.id);
    expect((await (await f.call('/api/actions',undefined,'POST',a)).json()).status).toBe('pending');
    expect((await f.call('/api/actions/'+a.id+'/decision',undefined,'POST',{approve:true})).status).toBe(403);
    expect((await f.call('/api/actions/'+a.id+'/decision',f.bobDesktop.token,'POST',{approve:true})).status).toBe(404);
    expect((await f.call('/api/actions/'+a.id+'/decision',f.aliceDesktop.token,'POST',{approve:true})).status).toBe(200);
    expect((await f.call('/api/actions/consume',undefined,'POST',a)).status).toBe(200);
  });
  test('unrestricted shell uses normal authorization; current deny overrides old grants',async()=>{
    const f=fixture();const a=f.action();
    expect((await (await f.call('/api/actions',undefined,'POST',a)).json()).status).toBe('approved');
    expect((await f.call('/api/actions/consume',undefined,'POST',{...a,digest:hash('changed command')})).status).toBe(403);
    f.store.setPolicy({...f.policy,tools:{...f.policy.tools,cmd:'deny'}},f.admin.id);
    expect((await f.call('/api/actions/consume',undefined,'POST',a)).status).toBe(403);
    expect((await (await f.call('/api/actions',undefined,'POST',f.action())).json()).status).toBe('denied');
  });
  test('one-use grant cannot be replayed or used by a different engine',async()=>{
    const f=fixture();const a=f.action();await f.call('/api/actions',undefined,'POST',a);
    expect((await f.call('/api/actions/consume',f.adminEngine.token,'POST',a)).status).toBe(403);
    expect((await f.call('/api/actions/consume',undefined,'POST',a)).status).toBe(200);
    expect((await f.call('/api/actions/consume',undefined,'POST',a)).status).toBe(403);
  });
  test('expired grants fail closed',async()=>{
    const f=fixture();const a=f.action();await f.call('/api/actions',undefined,'POST',a);
    f.store.db.query('UPDATE actions SET expires=0 WHERE id=?').run(a.id);
    expect((await f.call('/api/actions/consume',undefined,'POST',a)).status).toBe(403);
  });
  test('disabling user and revoking parent stops existing engine access',async()=>{
    const f=fixture();expect((await f.call('/api/catalog')).status).toBe(200);
    f.store.revoke(hash(f.aliceDesktop.token));expect((await f.call('/api/catalog')).status).toBe(401);
    expect((await f.adminCall('/api/admin/users/'+f.bob.id,'PUT',{disabled:true})).status).toBe(200);
    expect((await f.call('/api/catalog',f.bobDesktop.token)).status).toBe(401);
  });
  test('cloud flag and explicit approval both required; arbitrary upstream options rejected',async()=>{
    const f=fixture();const catalog=await (await f.call('/api/catalog')).json();
    expect(catalog.models.map((m:{id:string})=>m.id)).toEqual(['local']);
    expect((await f.call('/api/gateway/v1/chat/completions',undefined,'POST',{model:'cloud',messages:[{role:'user',content:'test'}]})).status).toBe(403);
    expect((await f.call('/api/gateway/v1/chat/completions',undefined,'POST',{model:'local',messages:[{role:'user',content:'test'}],api_base:'https://other.example'})).status).toBe(400);
  });
  test('unknown capabilities cannot authorize connector installation or arbitrary execution APIs',async()=>{
    const f=fixture();expect((await f.call('/api/actions',undefined,'POST',{...f.action(),capability:'install_connector'})).status).toBe(400);
    expect((await f.call('/api/install',undefined,'POST',{command:'install connector'})).status).toBe(404);
  });
});

test('vault binds encrypted secrets to owner, purpose and approved destination',()=>{
  const f=fixture();f.store.putSecret(f.alice.id,'gateway',f.policy.gatewayUrl,'secret-canary');
  expect(f.store.secret(f.alice.id,'gateway',f.policy.gatewayUrl)).toBe('secret-canary');
  expect(f.store.secret(f.bob.id,'gateway',f.policy.gatewayUrl)).toBeNull();
  expect(f.store.secret(f.alice.id,'gateway','https://other.example/v1')).toBeNull();
  const row=f.store.db.query<{ciphertext:string},[]>('SELECT ciphertext FROM secrets').get()!;
  expect(row.ciphertext).not.toContain('secret-canary');
  f.store.db.query('UPDATE secrets SET owner=?').run(f.bob.id);
  expect(()=>f.store.secret(f.bob.id,'gateway',f.policy.gatewayUrl)).toThrow();
});

test('SAML replay store consumes once and atomically rejects duplicate assertion IDs',()=>{
  const f=fixture();f.store.putTransient('request','one');expect(f.store.consume('request')).toBe('one');expect(f.store.consume('request')).toBeNull();
  expect(f.store.saveOnce('assertion','value',Date.now()+60_000)).toBe(true);
  expect(f.store.saveOnce('assertion','value',Date.now()+60_000)).toBe(false);
});
