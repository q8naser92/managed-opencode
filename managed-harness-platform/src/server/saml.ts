import { SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import type { CacheProvider } from '@node-saml/node-saml';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Boot } from '../shared/schema.ts';
import { Store, hash, randomToken } from './store.ts';
import { requestId, validateBrowserBinding } from './saml-binding.ts';

export function samlRoutes(boot:Boot,store:Store) {
  const identity=boot.saml;
  if(!identity) return new Hono();
  const cache:CacheProvider = {
    async saveAsync(k,v) { const createdAt=Date.now(); store.putTransient('saml:'+k,v,createdAt+300_000); return {value:v,createdAt}; },
    async getAsync(k) { return store.transient('saml:'+k); },
    async removeAsync(k) { return k ? store.consume('saml:'+k) : null; },
    async consumeAsync(k) { return store.consume('saml:'+k); },
    async saveIfAbsentAsync(k,v,until) { return store.saveOnce('saml:'+k,v,until); },
  };
  const saml=new SAML({
    entryPoint:identity.entryPoint,issuer:identity.entityId,audience:identity.entityId,
    idpIssuer:identity.idpIssuer,idpCert:identity.idpCert,callbackUrl:boot.origin+'/auth/saml/callback',
    privateKey:readFileSync(identity.signingKey,'utf8'),publicCert:readFileSync(identity.signingCert,'utf8'),
    signatureAlgorithm:'sha256',digestAlgorithm:'sha256',wantAssertionsSigned:true,wantAuthnResponseSigned:true,
    validateInResponseTo:ValidateInResponseTo.always,rejectReplayedAssertions:true,requestIdExpirationPeriodMs:300_000,
    acceptedClockSkewMs:30_000,maxAssertionAgeMs:300_000,disableRequestedAuthnContext:true,
    identifierFormat:'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',cacheProvider:cache,
  });
  const app=new Hono();
  const pending=z.object({challenge:z.string().regex(/^[A-Za-z0-9_-]{43}$/),port:z.number().int().min(1024).max(65535),state:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict();
  app.get('/metadata', c=>c.body(saml.generateServiceProviderMetadata(null,readFileSync(identity.signingCert,'utf8')),200,{'Content-Type':'application/samlmetadata+xml'}));
  app.post('/desktop/start',async c=>{
    const value=pending.parse(await c.req.json()); const id=randomToken();
    store.putTransient('desktop:'+id,JSON.stringify(value));
    return c.json({url:boot.origin+'/auth/login?desktop='+id});
  });
  app.get('/login',async c=>{
    const desktop=c.req.query('desktop');
    if (desktop && !store.transient('desktop:'+desktop)) throw new HTTPException(400,{message:'Login request expired'});
    const nonce=randomToken(); const relay=randomToken();
    const url=await saml.getAuthorizeUrlAsync(relay,undefined);
    store.putTransient('relay:'+relay,JSON.stringify({nonce:hash(nonce),desktop,request:requestId(url)}));
    setCookie(c,'__Host-moc-login',nonce,{secure:true,httpOnly:true,sameSite:'None',path:'/',maxAge:300});
    return c.redirect(url);
  });
  app.post('/saml/callback',async c=>{
    const form=await c.req.parseBody();
    const input=z.object({SAMLResponse:z.string().min(1).max(500_000),RelayState:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).parse(form);
    const relayText=store.consume('relay:'+input.RelayState);
    if (!relayText) throw new HTTPException(400,{message:'Login state expired or already used'});
    const relay=JSON.parse(relayText) as {nonce:string;desktop?:string;request:string};
    const nonce=getCookie(c,'__Host-moc-login');
    if (!nonce || hash(nonce)!==relay.nonce) throw new HTTPException(400,{message:'Login browser does not match'});
    deleteCookie(c,'__Host-moc-login',{secure:true,path:'/'});
    const result=await saml.validatePostResponseAsync({SAMLResponse:input.SAMLResponse});
    if (result.loggedOut || !result.profile?.nameID || result.profile.nameIDFormat !== 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent') {
      throw new HTTPException(403,{message:'A stable persistent identity is required'});
    }
    validateBrowserBinding(result.profile,relay.request,boot.origin+'/auth/saml/callback',Buffer.from(input.SAMLResponse,'base64').toString('utf8'));
    const subject=JSON.stringify([identity.idpIssuer,result.profile.nameID]);
    const user=store.upsertUser(subject,result.profile.nameID,identity.adminSubjects.includes(result.profile.nameID));
    if (user.disabled) throw new HTTPException(403,{message:'Account disabled'});
    store.audit(user.id,'user.login','saml','success');
    if (relay.desktop) {
      const raw=store.consume('desktop:'+relay.desktop);
      if (!raw) throw new HTTPException(400,{message:'Desktop login expired'});
      const request=pending.parse(JSON.parse(raw));const code=randomToken();
      store.putTransient('exchange:'+hash(code),JSON.stringify({user:user.id,challenge:request.challenge}),Date.now()+60_000);
      return c.redirect(`http://127.0.0.1:${request.port}/authorized?code=${encodeURIComponent(code)}&state=${encodeURIComponent(request.state)}`);
    }
    const session=store.issue(user.id,'browser');
    setCookie(c,'__Host-moc',session.token,{secure:true,httpOnly:true,sameSite:'Strict',path:'/',maxAge:8*3600});
    return c.redirect('/');
  });
  app.post('/desktop/exchange',async c=>{
    const input=z.object({code:z.string().regex(/^[A-Za-z0-9_-]{43}$/),verifier:z.string().regex(/^[A-Za-z0-9_-]{43,128}$/)}).strict().parse(await c.req.json());
    const raw=store.transient('exchange:'+hash(input.code));
    if (!raw) throw new HTTPException(400,{message:'Code expired or already used'});
    const record=JSON.parse(raw) as {user:string;challenge:string};
    if (createHash('sha256').update(input.verifier).digest('base64url')!==record.challenge) throw new HTTPException(403,{message:'Code verifier does not match'});
    if (!store.consume('exchange:'+hash(input.code))) throw new HTTPException(400,{message:'Code already used'});
    if (store.user(record.user)?.disabled !== 0) throw new HTTPException(403,{message:'Account disabled'});
    return c.json(store.issue(record.user,'desktop'));
  });
  return app;
}
