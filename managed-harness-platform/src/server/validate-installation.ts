import { readFileSync } from 'node:fs';
import { X509Certificate,createPrivateKey } from 'node:crypto';
import { isIP } from 'node:net';
import { rootCertificates,createSecureContext } from 'node:tls';
import type { Boot } from '../shared/schema.ts';
import { samlRoutes } from './saml.ts';
import type { Store } from './store.ts';

function identity(certFile:string,keyFile:string){
  const cert=readFileSync(certFile,'utf8'),key=readFileSync(keyFile,'utf8');
  const leaf=new X509Certificate(cert);
  if(!leaf.checkPrivateKey(createPrivateKey(key)))throw new Error('Certificate and key do not match');
  if(Date.now()<Date.parse(leaf.validFrom)||Date.now()>Date.parse(leaf.validTo))throw new Error('Certificate is outside its validity period');
  createSecureContext({cert,key});return leaf;
}
export function validateInstallation(boot:Boot,store:Store){
  const leaf=identity(boot.tlsCert,boot.tlsKey);const host=new URL(boot.origin).hostname.replace(/^\[|\]$/g,'');
  if(!(isIP(host)?leaf.checkIP(host):leaf.checkHost(host,{subject:'never'})))throw new Error('TLS certificate does not match the public server address');
  if(boot.caFile){const pem=readFileSync(boot.caFile,'utf8');const blocks=pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);if(!blocks?.length||pem.includes('PRIVATE KEY'))throw new Error('Invalid additional CA bundle');for(const block of blocks)new X509Certificate(block);}
  if(boot.saml){identity(boot.saml.signingCert,boot.saml.signingKey);new X509Certificate(boot.saml.idpCert.includes('-----BEGIN CERTIFICATE-----')?boot.saml.idpCert:Buffer.from(boot.saml.idpCert,'base64'));samlRoutes(boot,store);}
}
export async function verifyListener(boot:Boot,attempts=20){
  const serverName=new URL(boot.origin).hostname.replace(/^\[|\]$/g,'');
  const ca=[...rootCertificates,...(boot.caFile?[readFileSync(boot.caFile,'utf8')]:[])];
  for(let n=0;n<attempts;n++){
    try{const response=await fetch('https://127.0.0.1:'+boot.port+'/health',{proxy:false,redirect:'manual',tls:{ca,serverName,rejectUnauthorized:true},signal:AbortSignal.timeout(1500)});if(response.ok&&(await response.json()as{service?:string}).service==='Managed OpenCode')return;}catch{}
    await Bun.sleep(500);
  }
  throw new Error('The local verified HTTPS management listener did not become ready');
}
