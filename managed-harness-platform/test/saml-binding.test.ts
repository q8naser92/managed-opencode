import { expect,test } from 'bun:test';
import type { Profile } from '@node-saml/node-saml';
import { validateBrowserBinding,requestId } from '../src/server/saml-binding.ts';
import { deflateRawSync } from 'node:zlib';

const callback='https://manager.example/auth/saml/callback';
const request='_expected-request';
const now=Date.UTC(2026,10,9);
function fixture(recipient=callback,inResponseTo=request,until=new Date(now+60_000).toISOString()) {
 const assertion=`<Assertion xmlns="urn:oasis:names:tc:SAML:2.0:assertion"><Subject><SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><SubjectConfirmationData Recipient="${recipient}" InResponseTo="${inResponseTo}" NotOnOrAfter="${until}"/></SubjectConfirmation></Subject></Assertion>`;
 const profile:Profile={issuer:'expected-idp',nameID:'persistent-subject',nameIDFormat:'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',inResponseTo:request,getAssertionXml:()=>assertion};
 const response=`<Response xmlns="urn:oasis:names:tc:SAML:2.0:protocol" Destination="${callback}" InResponseTo="${request}"/>`;
 return {profile,response};
}
test('matches the exact SAML request created for the browser flow',()=>{
 const xml=`<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="${request}"/>`;
 const url='https://idp.example/sso?SAMLRequest='+encodeURIComponent(deflateRawSync(xml).toString('base64'));
 expect(requestId(url)).toBe(request);
 const f=fixture();expect(()=>validateBrowserBinding(f.profile,request,callback,f.response,now)).not.toThrow();
 expect(()=>validateBrowserBinding(f.profile,'_different-browser',callback,f.response,now)).toThrow();
});
test('rejects wrong response destination even after identity validation',()=>{
 const f=fixture();expect(()=>validateBrowserBinding(f.profile,request,callback,f.response.replace(callback,'https://other.example/callback'),now)).toThrow();
});
test('rejects wrong bearer recipient, request and expired confirmation',()=>{
 for(const f of [fixture('https://other.example/callback'),fixture(callback,'_different-request'),fixture(callback,request,new Date(now-60_000).toISOString())]) {
  expect(()=>validateBrowserBinding(f.profile,request,callback,f.response,now)).toThrow();
 }
});
test('rejects XML entity declarations',()=>{
 const f=fixture();expect(()=>validateBrowserBinding(f.profile,request,callback,'<!DOCTYPE Response [<!ENTITY x "value">]>'+f.response,now)).toThrow();
});
