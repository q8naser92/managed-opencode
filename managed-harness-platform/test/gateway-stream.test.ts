import { test,expect } from 'bun:test';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Store,hash } from '../src/server/store.ts';
import { createApp } from '../src/server/app.ts';
import { Policy } from '../src/shared/schema.ts';

test('session expiry terminates an already-open verified HTTPS gateway stream',async()=>{
  const certificate=join(import.meta.dir,'fixtures/smtp-test-cert.pem');
  const fixture=Bun.serve({port:0,hostname:'127.0.0.1',tls:{key:Bun.file(join(import.meta.dir,'fixtures/smtp-test-key.pem')),cert:Bun.file(certificate)},fetch(){return new Response(new ReadableStream({start(out){out.enqueue(new TextEncoder().encode('data: initial\n\n'));}}),{headers:{'Content-Type':'text/event-stream'}});}});
  const store=new Store(':memory:',randomBytes(32));
  try{
    const gatewayUrl=`https://127.0.0.1:${fixture.port}/v1`;const policy=Policy.parse({revision:0,gatewayUrl,models:[{id:'fixture',name:'Fixture',enabled:true,cloud:false}],tools:{read:'allow',edit:'allow',cmd:'allow',powershell:'allow'},maxCommandSeconds:60,maxSessionSteps:20});store.initialize(policy);
    const app=createApp({origin:'https://manager.example',port:7443,tlsKey:'unused',tlsCert:'unused',caFile:certificate,initialPolicy:policy,allowedOrigins:[new URL(gatewayUrl).origin]},store);
    const user=store.upsertUser('stream-test','stream-test',false);const parent=store.issue(user.id,'desktop');const session=store.issue(user.id,'engine',hash(parent.token));store.putSecret(user.id,'gateway',gatewayUrl,'synthetic-key');
    const response=await app.request('https://manager.example/api/gateway/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/json'},body:JSON.stringify({model:'fixture',stream:true,messages:[{role:'user',content:'synthetic stream test'}]})});expect(response.status).toBe(200);const reader=response.body!.getReader();expect(new TextDecoder().decode((await reader.read()).value)).toContain('initial');
    store.db.query('UPDATE sessions SET expires=0 WHERE token=?').run(hash(session.token));
    await expect(reader.read()).rejects.toThrow();
    expect((await app.request('https://manager.example/api/catalog',{headers:{Authorization:'Bearer '+session.token}})).status).toBe(401);
  }finally{fixture.stop(true);store.close();}
},10_000);
