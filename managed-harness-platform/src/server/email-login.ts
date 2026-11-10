import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { getCookie,setCookie,deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { createHash,createHmac,randomInt,timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import nodemailer from 'nodemailer';
import { EmailAddress,Smtp } from '../shared/schema.ts';
import type { Boot } from '../shared/schema.ts';
import { Store,hash,randomToken } from './store.ts';

type Pending={email:string;user:string|null;kind:'desktop'|'browser';binding:string;digest:string;attempts:number};
export function smtpSettings(store:Store){const row=store.db.query<{value:string},[]>('SELECT value FROM settings WHERE id=\'smtp\'').get();return row?Smtp.parse(JSON.parse(row.value)):null;}
export function smtpAudience(value:Smtp){return JSON.stringify([value.host,value.port,value.mode,value.serverName,value.username]);}
export function mailTransport(boot:Boot,store:Store,value:Smtp){
  const password=value.username?store.secret('service','smtp',smtpAudience(value)):null;
  if(value.username&&!password) throw new Error('SMTP credential has not been configured for this server');
  return nodemailer.createTransport({host:value.host,port:value.port,secure:value.mode==='tls',requireTLS:true,
    tls:{ca:[...rootCertificates,...(boot.caFile?[readFileSync(boot.caFile,'utf8')]:[])],servername:value.serverName,rejectUnauthorized:true,minVersion:'TLSv1.2'},
    ...(value.username?{auth:{user:value.username,pass:password!}}:{}),
    connectionTimeout:10_000,greetingTimeout:10_000,socketTimeout:15_000,dnsTimeout:5000,
    logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true});
}

export function emailRoutes(boot:Boot,store:Store){
  const app=new Hono();let sending=0;
  const queue:Array<()=>Promise<void>>=[];
  function pump(){while(sending<4&&queue.length){sending++;void queue.shift()!().finally(()=>{sending--;pump();});}}
  function enqueue(deliver:()=>Promise<void>){store.background(new Promise<void>(resolve=>{queue.push(async()=>{try{await deliver();}finally{resolve();}});pump();}));}
  const proof=(id:string,code:string)=>createHmac('sha256',store.key).update('email-otp:'+id+':'+code).digest('hex');
  // Attempts are reserved synchronously before any SMTP work; concurrent requests share the same limit.
  function reserve(key:string,max:number,period:number){
    return store.db.transaction(()=>{const raw=store.transient(key);const current=raw?JSON.parse(raw) as {count:number;until:number}:{count:0,until:Date.now()+period};if(current.count>=max)return false;store.putTransient(key,JSON.stringify({...current,count:current.count+1}),current.until);return true;})();
  }
  app.post('/email/start',async c=>{
    const input=z.object({email:EmailAddress,kind:z.enum(['browser','desktop']),challenge:z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional()}).strict().parse(await c.req.json());
    if(c.req.header('Origin')&&c.req.header('Origin')!==boot.origin)throw new HTTPException(403,{message:'Invalid origin'});
    if(input.kind==='browser'&&c.req.header('Origin')!==boot.origin)throw new HTTPException(403,{message:'Browser origin required'});
    if(input.kind==='desktop'&&!input.challenge)throw new HTTPException(400,{message:'Desktop challenge required'});
    const smtp=smtpSettings(store);if(!smtp?.enabled)throw new HTTPException(503,{message:'Email sign-in is not enabled'});
    // Check capacity before account lookup and rate reservation. Unknown accounts receive the same retry response.
    if(queue.length>=20)throw new HTTPException(503,{message:'Email delivery is busy; retry shortly'});
    const id=randomToken();const code=String(randomInt(0,100_000_000)).padStart(8,'0');const nonce=randomToken();
    if(!reserve('email-global-rate',100,60_000))throw new HTTPException(429,{message:'Too many sign-in requests; try again later'});
    const allowed=reserve('email-rate:'+hash(input.email),3,15*60_000);
    const user=store.localUser(input.email);const eligible=allowed&&user&&!user.disabled;
    const pending:Pending={email:input.email,user:eligible?user.id:null,kind:input.kind,binding:input.kind==='desktop'?input.challenge!:hash(nonce),digest:proof(id,code),attempts:0};
    store.putTransient('email-otp:'+hash(id),JSON.stringify(pending));
    if(allowed)store.putTransient('email-latest:'+hash(input.email),id);
    if(input.kind==='browser')setCookie(c,'__Host-moc-otp',nonce,{secure:true,httpOnly:true,sameSite:'Strict',path:'/',maxAge:300});
    if(eligible){
      // Never return the code or SMTP outcome to the requesting device. The response is identical for unknown accounts.
      enqueue(async()=>{try{const transport=mailTransport(boot,store,smtp);try{await transport.sendMail({from:smtp.from,to:input.email,subject:'Your Managed OpenCode sign-in code',text:`Your sign-in code is ${code}.\n\nIt expires in 5 minutes and can be used once. If you did not request it, ignore this email.\n\nManagement server: ${boot.origin}`});store.audit(user.id,'user.otp.sent','email','success');}finally{transport.close();}}catch{store.audit('service','user.otp.delivery','email','failed');}});
    }
    return c.json({requestId:id,message:'If this email is approved, a sign-in code will arrive shortly.',expiresIn:300});
  });
  app.post('/email/verify',async c=>{
    const input=z.object({requestId:z.string().regex(/^[A-Za-z0-9_-]{43}$/),code:z.string().regex(/^\d{8}$/),verifier:z.string().regex(/^[A-Za-z0-9_-]{43,128}$/).optional()}).strict().parse(await c.req.json());
    if(c.req.header('Origin')&&c.req.header('Origin')!==boot.origin)throw new HTTPException(403,{message:'Invalid origin'});
    const key='email-otp:'+hash(input.requestId);const raw=store.transient(key);if(!raw||!smtpSettings(store)?.enabled)throw new HTTPException(401,{message:'Code is invalid or expired'});
    const record=JSON.parse(raw) as Pending;
    record.attempts++;if(record.attempts>=5)store.consume(key);else{const expires=store.db.query<{expires:number},[string]>('SELECT expires FROM transient WHERE id=?').get(key)!.expires;store.putTransient(key,JSON.stringify(record),expires);}
    const binding=record.kind==='desktop'?createHash('sha256').update(input.verifier??'').digest('base64url'):hash(getCookie(c,'__Host-moc-otp')??'');
    const valid=record.user&&binding===record.binding&&(record.kind!=='browser'||c.req.header('Origin')===boot.origin)&&store.transient('email-latest:'+hash(record.email))===input.requestId&&timingSafeEqual(Buffer.from(record.digest,'hex'),Buffer.from(proof(input.requestId,input.code),'hex'))&&store.user(record.user)?.disabled===0;
    if(!valid){store.audit(record.user??'unknown','user.login','email','failed');throw new HTTPException(401,{message:'Code is invalid or expired'});}
    store.consume(key);store.consume('email-latest:'+hash(record.email));const session=store.issue(record.user!,record.kind);store.audit(record.user!,'user.login','email','success');
    if(record.kind==='browser'){deleteCookie(c,'__Host-moc-otp',{secure:true,path:'/'});setCookie(c,'__Host-moc',session.token,{secure:true,httpOnly:true,sameSite:'Strict',path:'/',maxAge:8*3600});return c.json({ok:true});}
    return c.json(session);
  });
  return app;
}
