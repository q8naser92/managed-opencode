import { afterEach,test,expect } from 'bun:test';
import { randomBytes,generateKeyPairSync } from 'node:crypto';
import { mkdtempSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/server/store.ts';
import { Boot,Policy,Smtp } from '../src/shared/schema.ts';
import { initializeAdministrator,assertAdministratorAccess } from '../src/server/bootstrap.ts';
import { smtpAudience,smtpSettings } from '../src/server/email-login.ts';
import { validateInstallation,verifyListener } from '../src/server/validate-installation.ts';

const stores:Store[]=[];const directories:string[]=[];
afterEach(()=>{for(const s of stores.splice(0))s.close();for(const d of directories.splice(0))rmSync(d,{recursive:true,force:true});});
const certificate=join(import.meta.dir,'fixtures/smtp-test-cert.pem');
const key=join(import.meta.dir,'fixtures/smtp-test-key.pem');
const policy=Policy.parse({revision:0,gatewayUrl:'https://gateway.example/v1',models:[],tools:{read:'ask',edit:'ask',cmd:'deny',powershell:'deny'},maxCommandSeconds:60,maxSessionSteps:30});
const smtp=Smtp.parse({enabled:true,host:'mail.example',port:8465,mode:'tls',serverName:'mail.example',username:'service',from:'signin@example.com'});
function fixture(){const store=new Store(':memory:',randomBytes(32));store.initialize(policy);stores.push(store);return store;}
function boot(port=7443){return Boot.parse({origin:`https://127.0.0.1:${port}`,port,tlsCert:certificate,tlsKey:key,caFile:certificate,initialPolicy:policy,allowedOrigins:['https://gateway.example']});}
function file(name:string,value:string){const directory=mkdtempSync(join(tmpdir(),'managed-install-test-'));directories.push(directory);const path=join(directory,name);writeFileSync(path,value);return path;}

test('bootstrap creates an email administrator and keeps SMTP credentials out of audit and plaintext storage',()=>{
  const store=fixture();const id=initializeAdministrator(store,{adminEmail:'admin@example.com',smtp,smtpPassword:'smtp-secret-canary'});
  expect(store.user(id)?.admin).toBe(1);expect(store.localUser('admin@example.com')?.id).toBe(id);
  expect(smtpSettings(store)).toEqual(smtp);expect(store.secret('service','smtp',smtpAudience(smtp))).toBe('smtp-secret-canary');
  expect(JSON.stringify(store.db.query('SELECT * FROM audit').all())).not.toContain('smtp-secret-canary');
  expect(JSON.stringify(store.db.query('SELECT * FROM secrets').all())).not.toContain('smtp-secret-canary');
});
test('bootstrap cannot replace an existing administrator or revive a disabled one',()=>{
  const store=fixture();initializeAdministrator(store,{adminEmail:'admin@example.com',smtp,smtpPassword:'secret'});
  expect(()=>initializeAdministrator(store,{adminEmail:'attacker@example.com',smtp,smtpPassword:'different'})).toThrow();
  expect(store.localUser('attacker@example.com')).toBeNull();
  store.db.query('UPDATE users SET disabled=1').run();
  expect(()=>initializeAdministrator(store,{adminEmail:'admin@example.com',smtp,smtpPassword:'different'})).toThrow();
  expect(store.secret('service','smtp',smtpAudience(smtp))).toBe('secret');
});
test('bootstrap promotes an existing local user only when no administrator exists',()=>{
  const store=fixture();const user=store.createLocalUser('first@example.com');
  expect(initializeAdministrator(store,{adminEmail:'first@example.com',smtp,smtpPassword:'secret'})).toBe(user.id);
  expect(store.user(user.id)?.admin).toBe(1);
});
test('SMTP identity changes require a matching credential and failed bootstrap is atomic',()=>{
  const store=fixture();expect(()=>initializeAdministrator(store,{adminEmail:'admin@example.com',smtp})).toThrow();
  expect(store.localUser('admin@example.com')).toBeNull();expect(smtpSettings(store)).toBeNull();
  initializeAdministrator(store,{adminEmail:'admin@example.com',smtp,smtpPassword:'original'});
  expect(()=>initializeAdministrator(store,{adminEmail:'admin@example.com',smtp:{...smtp,host:'another.example'}})).toThrow();
  expect(smtpSettings(store)).toEqual(smtp);
  initializeAdministrator(store,{adminEmail:'admin@example.com',smtp});
  expect(store.secret('service','smtp',smtpAudience(smtp))).toBe('original');
  expect(()=>initializeAdministrator(store,{adminEmail:'admin@example.com',smtp:{...smtp,enabled:false}})).toThrow();
});
test('setup requires a usable email administrator or a configured SAML administrator',()=>{
  const store=fixture();expect(()=>assertAdministratorAccess(boot(),store)).toThrow('Configure a SAML administrator');
  initializeAdministrator(store,{adminEmail:'admin@example.com',smtp,smtpPassword:'secret'});
  expect(()=>assertAdministratorAccess(boot(),store)).not.toThrow();
  store.deleteSecret('service','smtp');expect(()=>assertAdministratorAccess(boot(),store)).toThrow();
  store.putSecret('service','smtp',smtpAudience(smtp),'secret');store.db.query('UPDATE users SET disabled=1').run();
  expect(()=>assertAdministratorAccess(boot(),store)).toThrow();
  const saml={entryPoint:'https://idp.example/login',idpIssuer:'idp',idpCert:readFileSync(certificate,'utf8'),entityId:'managed',signingKey:key,signingCert:certificate,adminSubjects:['admin-subject']};
  expect(()=>assertAdministratorAccess({...boot(),saml},store)).not.toThrow();
  const samlAdmin=store.upsertUser(JSON.stringify([saml.idpIssuer,'admin-subject']),'Admin',true);
  store.db.query('UPDATE users SET disabled=1 WHERE id=?').run(samlAdmin.id);
  expect(()=>assertAdministratorAccess({...boot(),saml},store)).toThrow();
  expect(()=>assertAdministratorAccess({...boot(),saml:{...saml,adminSubjects:['new-admin']}},store)).not.toThrow();
  expect(()=>assertAdministratorAccess({...boot(),saml:{...saml,adminSubjects:[]}},store)).toThrow();
});
test('installation rejects malformed certificates, mismatched keys, wrong public names and invalid CA bundles',()=>{
  const store=fixture();expect(()=>validateInstallation(boot(),store)).not.toThrow();
  const other=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({format:'pem',type:'pkcs8'}).toString();
  expect(()=>validateInstallation({...boot(),tlsKey:file('other.pem',other)},store)).toThrow('Certificate and key do not match');
  expect(()=>validateInstallation({...boot(),origin:'https://wrong.example:7443'},store)).toThrow('TLS certificate does not match');
  expect(()=>validateInstallation({...boot(),tlsCert:file('broken.pem','not a certificate')},store)).toThrow();
  expect(()=>validateInstallation({...boot(),caFile:file('ca.pem','not a certificate')},store)).toThrow('Invalid additional CA bundle');
  expect(()=>validateInstallation({...boot(),caFile:key},store)).toThrow('Invalid additional CA bundle');
  const saml={entryPoint:'https://idp.example/login',idpIssuer:'idp',idpCert:readFileSync(certificate,'utf8'),entityId:'managed',signingKey:key,signingCert:certificate,adminSubjects:['admin']};
  expect(()=>validateInstallation({...boot(),saml},store)).not.toThrow();
  expect(()=>validateInstallation({...boot(),saml:{...saml,idpCert:saml.idpCert.replace(/-----[^\n]+-----|\s/g,'')}},store)).not.toThrow();
});
test('post-install HTTPS readiness verifies server trust and hostname, not just a running process',async()=>{
  const server=Bun.serve({hostname:'127.0.0.1',port:0,tls:{cert:readFileSync(certificate),key:readFileSync(key)},fetch:()=>Response.json({service:'Managed OpenCode'})});
  try{
    const value=boot(server.port!);await expect(verifyListener(value,1)).resolves.toBeUndefined();
    await expect(verifyListener({...value,origin:`https://wrong.example:${server.port}`},1)).rejects.toThrow('did not become ready');
    await expect(verifyListener({...value,caFile:undefined},1)).rejects.toThrow('did not become ready');
  }finally{server.stop(true);}
});
