import { beforeAll,afterAll,afterEach,test,expect } from 'bun:test';
import { SMTPServer } from 'smtp-server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash,randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Store,hash,randomToken } from '../src/server/store.ts';
import { createApp } from '../src/server/app.ts';
import { Policy } from '../src/shared/schema.ts';
import type { Boot } from '../src/shared/schema.ts';

// Deliberately public, test-only TLS identity. It is never packaged or trusted by the product.
const certificate=join(import.meta.dir,'fixtures/smtp-test-cert.pem');
const delivered=new Map<string,string[]>();const waiting=new Map<string,(code:string)=>void>();
let smtpPause:Promise<void>|undefined;
const smtp=new SMTPServer({secure:true,authOptional:true,key:readFileSync(join(import.meta.dir,'fixtures/smtp-test-key.pem')),cert:readFileSync(certificate),disabledCommands:['AUTH'],logger:false,onData(stream,session,done){let text='';stream.on('data',chunk=>{text+=chunk.toString();});stream.on('end',async()=>{if(smtpPause)await smtpPause;const code=/sign-in code is (\d{8})/.exec(text)?.[1];if(!code){done(new Error('Missing code'));return;}for(const recipient of session.envelope.rcptTo){const notify=waiting.get(recipient.address);if(notify){waiting.delete(recipient.address);notify(code);}else delivered.set(recipient.address,[...(delivered.get(recipient.address)??[]),code]);}done();});}});
let port=0;const stores:Store[]=[];
beforeAll(async()=>{await new Promise<void>(resolve=>smtp.listen(0,'127.0.0.1',resolve));port=(smtp.server.address() as AddressInfo).port;});
afterAll(async()=>{await new Promise<void>(resolve=>smtp.close(resolve));});
afterEach(async()=>{for(const s of stores.splice(0)){await s.drain();s.close();}});
function codeFor(email:string){const code=delivered.get(email)?.shift();if(code)return Promise.resolve(code);return new Promise<string>((resolve,reject)=>{const timer=setTimeout(()=>{waiting.delete(email);reject(new Error('TLS SMTP delivery did not finish'));},8000);waiting.set(email,code=>{clearTimeout(timer);resolve(code);});});}
function fixture(){
  const store=new Store(':memory:',randomBytes(32));stores.push(store);
  const policy=Policy.parse({revision:0,gatewayUrl:'https://gateway.example/v1',models:[],tools:{read:'allow',edit:'allow',cmd:'allow',powershell:'allow'},maxCommandSeconds:60,maxSessionSteps:20});store.initialize(policy);
  const boot:Boot={origin:'https://manager.example',port:7443,tlsCert:'unused',tlsKey:'unused',caFile:certificate,initialPolicy:policy,allowedOrigins:['https://gateway.example']};
  store.db.query("INSERT INTO settings VALUES('smtp',?)").run(JSON.stringify({enabled:true,host:'127.0.0.1',port,mode:'tls',serverName:'localhost',username:'',from:'sign-in@managed-harness.invalid'}));
  const email=randomToken().slice(0,12).toLowerCase()+'@managed-harness.invalid';const user=store.createLocalUser(email);const app=createApp(boot,store);
  const call=(path:string,body:unknown,headers:Record<string,string>={})=>app.request(boot.origin+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  const verifier=randomToken();const challenge=createHash('sha256').update(verifier).digest('base64url');
  const start=async()=>{const response=await call('/auth/email/start',{email,kind:'desktop',challenge});expect(response.status).toBe(200);const value=await response.json();return {requestId:value.requestId as string};};
  return {store,app,boot,email,user,verifier,challenge,call,start};
}
test('verified TLS SMTP delivers a one-use code bound to the desktop and approved account',async()=>{
  const f=fixture();const challenge=await f.start();const code=await codeFor(f.email);
  const reply=await f.call('/auth/email/verify',{...challenge,code,verifier:f.verifier});expect(reply.status).toBe(200);const session=await reply.json();expect(f.store.session(session.token)?.user.id).toBe(f.user.id);expect(f.store.session(session.token)?.session.kind).toBe('desktop');
  expect((await f.call('/auth/email/verify',{...challenge,code,verifier:f.verifier})).status).toBe(401);
  expect(JSON.stringify(f.store.db.query('SELECT * FROM audit').all())).not.toContain(code);
  expect(JSON.stringify(f.store.db.query('SELECT * FROM transient').all())).not.toContain(code);
},15_000);
test('five wrong codes lock the request; expiry, wrong device and disabled accounts fail closed',async()=>{
  const f=fixture();const challenge=await f.start();const code=await codeFor(f.email);
  expect((await f.call('/auth/email/verify',{...challenge,code,verifier:randomToken()})).status).toBe(401);
  const wrong=code==='00000000'?'11111111':'00000000';for(let i=0;i<4;i++)expect((await f.call('/auth/email/verify',{...challenge,code:wrong,verifier:f.verifier})).status).toBe(401);
  expect((await f.call('/auth/email/verify',{...challenge,code,verifier:f.verifier})).status).toBe(401);
  const expired=await f.start();const second=await codeFor(f.email);f.store.db.query('UPDATE transient SET expires=0 WHERE id=?').run('email-otp:'+hash(expired.requestId));expect((await f.call('/auth/email/verify',{...expired,code:second,verifier:f.verifier})).status).toBe(401);
  const disabled=await f.start();const third=await codeFor(f.email);f.store.db.query('UPDATE users SET disabled=1 WHERE id=?').run(f.user.id);expect((await f.call('/auth/email/verify',{...disabled,code:third,verifier:f.verifier})).status).toBe(401);
},15_000);
test('browser login requires its initiating cookie and origin; desktop engines cannot provision accounts or SMTP',async()=>{
  const f=fixture();const start=await f.call('/auth/email/start',{email:f.email,kind:'browser'},{Origin:f.boot.origin});const challenge=await start.json();const code=await codeFor(f.email);const cookie=start.headers.get('set-cookie')!.split(';')[0]!;
  expect((await f.call('/auth/email/verify',{requestId:challenge.requestId,code},{Origin:f.boot.origin})).status).toBe(401);
  expect((await f.call('/auth/email/verify',{requestId:challenge.requestId,code},{Origin:'https://evil.example',Cookie:cookie})).status).toBe(403);
  const good=await f.call('/auth/email/verify',{requestId:challenge.requestId,code},{Origin:f.boot.origin,Cookie:cookie});expect(good.status).toBe(200);expect(good.headers.get('set-cookie')).toContain('__Host-moc=');expect(await good.json()).toEqual({ok:true});
  const session=f.store.issue(f.user.id,'engine');for(const path of ['/api/admin/users/local','/api/admin/smtp/test'])expect((await f.call(path,{email:'other@example.com'},{Authorization:'Bearer '+session.token})).status).toBe(403);
},15_000);
test('resend invalidates the old code and account rate limits do not reveal registration',async()=>{
  const f=fixture();const first=await f.start();const old=await codeFor(f.email);const second=await f.start();const current=await codeFor(f.email);
  expect((await f.call('/auth/email/verify',{...first,code:old,verifier:f.verifier})).status).toBe(401);
  expect((await f.call('/auth/email/verify',{...second,code:current,verifier:f.verifier})).status).toBe(200);
  await f.start();await codeFor(f.email);const limited=await f.start();expect((await f.call('/auth/email/verify',{...limited,code:current,verifier:f.verifier})).status).toBe(401);
  const unknown=await f.call('/auth/email/start',{email:'unknown@managed-harness.invalid',kind:'desktop',challenge:f.challenge});expect(unknown.status).toBe(200);expect(Object.keys(await unknown.json()).sort()).toEqual(['expiresIn','message','requestId']);
},15_000);

test('a burst beyond the four SMTP workers delivers every admitted code',async()=>{
  const f=fixture();const emails=Array.from({length:8},()=>randomToken().slice(0,12).toLowerCase()+'@managed-harness.invalid');
  for(const email of emails)f.store.createLocalUser(email);
  const starts=await Promise.all(emails.map(email=>f.call('/auth/email/start',{email,kind:'desktop',challenge:f.challenge})));
  for(const response of starts)expect(response.status).toBe(200);
  const codes=await Promise.all(emails.map(codeFor));await f.store.drain();
  for(let index=0;index<emails.length;index++){const request=await starts[index]!.json();const result=await f.call('/auth/email/verify',{requestId:request.requestId,code:codes[index],verifier:f.verifier});expect(result.status).toBe(200);}
  expect(f.store.db.query<{n:number},[]>("SELECT count(*) AS n FROM audit WHERE event='user.otp.sent'").get()!.n).toBe(8);
},15_000);

test('a full delivery queue rejects known and unknown accounts without consuming their resend allowance',async()=>{
  const f=fixture();let resume!:()=>void;smtpPause=new Promise<void>(resolve=>{resume=resolve;});
  try{
    const emails=Array.from({length:24},()=>randomToken().slice(0,12).toLowerCase()+'@managed-harness.invalid');for(const email of emails)f.store.createLocalUser(email);
    const admitted=await Promise.all(emails.map(email=>f.call('/auth/email/start',{email,kind:'desktop',challenge:f.challenge})));for(const reply of admitted)expect(reply.status).toBe(200);
    for(const email of [f.email,'not-registered@managed-harness.invalid']){expect((await f.call('/auth/email/start',{email,kind:'desktop',challenge:f.challenge})).status).toBe(503);expect(f.store.transient('email-rate:'+hash(email))).toBeNull();}
  }finally{smtpPause=undefined;resume();await f.store.drain();}
  expect(f.store.db.query<{n:number},[]>("SELECT count(*) AS n FROM audit WHERE event='user.otp.sent'").get()!.n).toBe(24);
},15_000);
