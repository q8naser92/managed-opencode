import { DOMParser } from '@xmldom/xmldom';
import type { Profile } from '@node-saml/node-saml';
import { inflateRawSync } from 'node:zlib';

function document(xml:string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('SAML declarations are not accepted');
  return new DOMParser({errorHandler:()=>{throw new Error('Invalid SAML XML');}}).parseFromString(xml,'text/xml');
}
export function requestId(authorizeUrl:string) {
  const encoded=new URL(authorizeUrl).searchParams.get('SAMLRequest');
  if (!encoded) throw new Error('SAML request missing');
  const root=document(inflateRawSync(Buffer.from(encoded,'base64'),{maxOutputLength:500_000}).toString('utf8')).documentElement;
  const id=root.getAttribute('ID');
  if (!id || root.localName!=='AuthnRequest') throw new Error('SAML request ID missing');
  return id;
}

// Additional rejection checks after Node-SAML's signature, issuer, audience, time and replay checks.
// Node-SAML 5.2 warns about a wrong Destination/Recipient instead of rejecting it itself.
export function validateBrowserBinding(profile:Profile,expectedRequest:string,callback:string,responseXml:string,now=Date.now()) {
  if (profile.inResponseTo!==expectedRequest) throw new Error('SAML response does not match this browser login');
  const response=document(responseXml).documentElement;
  if (response.localName!=='Response'||response.namespaceURI!=='urn:oasis:names:tc:SAML:2.0:protocol'||response.getAttribute('Destination')!==callback||response.getAttribute('InResponseTo')!==expectedRequest) {
    throw new Error('SAML response destination or request does not match');
  }
  const assertion=profile.getAssertionXml?.();
  if (!assertion) throw new Error('Verified assertion is missing');
  const confirmations=document(assertion).getElementsByTagNameNS('urn:oasis:names:tc:SAML:2.0:assertion','SubjectConfirmation');
  if (confirmations.length!==1) throw new Error('Exactly one bearer subject confirmation is required');
  const confirmation=confirmations.item(0)!;
  const data=confirmation.getElementsByTagNameNS('urn:oasis:names:tc:SAML:2.0:assertion','SubjectConfirmationData');
  if (confirmation.getAttribute('Method')!=='urn:oasis:names:tc:SAML:2.0:cm:bearer'||data.length!==1) throw new Error('Bearer confirmation required');
  const value=data.item(0)!;
  const until=Date.parse(value.getAttribute('NotOnOrAfter')??'');
  const before=value.getAttribute('NotBefore');
  if (value.getAttribute('Recipient')!==callback||value.getAttribute('InResponseTo')!==expectedRequest||!Number.isFinite(until)||until<=now-30_000||(before&&(!Number.isFinite(Date.parse(before))||Date.parse(before)>now+30_000))) {
    throw new Error('SAML bearer destination, request or validity does not match');
  }
}
