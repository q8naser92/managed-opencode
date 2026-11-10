import { test,expect } from 'bun:test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { Boot,Policy,Smtp } from '../src/shared/schema.ts';
import { listen,ListenerConflict } from '../src/server/listen.ts';
import { randomBytes } from 'node:crypto';
import { Store } from '../src/server/store.ts';
import { createApp } from '../src/server/app.ts';

const certificate=join(import.meta.dir,'fixtures/smtp-test-cert.pem');
const key=join(import.meta.dir,'fixtures/smtp-test-key.pem');
const policy=Policy.parse({revision:0,gatewayUrl:'https://gateway.example:9443/v1',models:[],tools:{read:'deny',edit:'deny',cmd:'deny',powershell:'deny'},maxCommandSeconds:30,maxSessionSteps:10});
function boot(port:number){return Boot.parse({origin:`https://127.0.0.1:${port}`,port,tlsKey:key,tlsCert:certificate,initialPolicy:policy,allowedOrigins:['https://gateway.example:9443']});}
function availablePort(){const probe=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response()});const port=probe.port!;probe.stop(true);return port;}

test('management and SMTP accept standard and custom ports; invalid values are rejected',()=>{
  for(const port of [1,443,7443,65535])expect(boot(port).port).toBe(port);
  for(const port of [0,-1,65536,443.5,NaN])expect(()=>boot(port)).toThrow();
  const settings={enabled:true,host:'smtp.example',mode:'tls',serverName:'smtp.example',username:'',from:'login@example.com'};
  for(const port of [465,587,8465,65535])expect(Smtp.parse({...settings,port}).port).toBe(port);
  for(const port of [0,65536,465.5])expect(()=>Smtp.parse({...settings,port})).toThrow();
  expect(()=>Smtp.parse({...settings,port:8465,serverName:'127.0.0.1'})).toThrow();
});

test('HTTPS listens on the selected port and an occupied port produces an actionable error',async()=>{
  const firstPort=availablePort();const first=listen(boot(firstPort),()=>Response.json({selected:firstPort}));
  let second:ReturnType<typeof listen>|undefined;
  try{
    const response=await fetch(`https://127.0.0.1:${firstPort}`,{proxy:false,tls:{ca:readFileSync(certificate,'utf8'),rejectUnauthorized:true}});
    expect(await response.json()).toEqual({selected:firstPort});
    expect(()=>listen(boot(firstPort),()=>new Response())).toThrow(ListenerConflict);
    try{listen(boot(firstPort),()=>new Response());}catch(error){expect((error as Error).message).toContain(String(firstPort));}
    const alternate=availablePort();expect(alternate).not.toBe(firstPort);
    second=listen(boot(alternate),()=>Response.json({selected:alternate}));
    expect(await(await fetch(`https://127.0.0.1:${alternate}`,{proxy:false,tls:{ca:readFileSync(certificate,'utf8'),rejectUnauthorized:true}})).json()).toEqual({selected:alternate});
  }finally{first.stop(true);second?.stop(true);}
});

test('explicit standard HTTPS port is normalized for browser administration and email sign-in',async()=>{
  const value=Boot.parse({...boot(443),origin:'https://MANAGER.example:443/'});
  expect(value.origin).toBe('https://manager.example');
  for(const origin of ['https://manager.example/api','https://manager.example?route=other','https://manager.example#section','https://user:password@manager.example','http://manager.example'])expect(()=>Boot.parse({...value,origin})).toThrow();
  const store=new Store(':memory:',randomBytes(32));
  try{
    store.initialize(policy);const admin=store.upsertUser('admin','Admin',true);const session=store.issue(admin.id,'browser');
    const app=createApp(value,store);
    const response=await app.request(value.origin+'/api/admin/policy',{method:'PUT',headers:{Cookie:'__Host-moc='+session.token,Origin:'https://manager.example','X-CSRF-Token':session.csrf,'Content-Type':'application/json'},body:JSON.stringify(policy)});
    expect(response.status).toBe(200);
    store.db.query("INSERT INTO settings VALUES('smtp',?)").run(JSON.stringify({enabled:true,host:'mail.example',port:8465,mode:'tls',serverName:'mail.example',username:'',from:'signin@example.com'}));
    const start=await app.request(value.origin+'/auth/email/start',{method:'POST',headers:{Origin:'https://manager.example','Content-Type':'application/json'},body:JSON.stringify({email:'unknown@example.com',kind:'browser'})});
    expect(start.status).toBe(200);expect(start.headers.get('set-cookie')).toContain('__Host-moc-otp=');
  }finally{await store.drain();store.close();}
});
