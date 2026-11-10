import { HTTPException } from 'hono/http-exception';
import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { Store, Session, User } from './store.ts';

export type Principal = {session: Session; user: User};
export type AppEnv = {Variables:{principal:Principal}};

export function authenticate(c: Context<AppEnv>, store: Store, origin: string): Principal {
  const bearer = c.req.header('Authorization');
  const token = bearer?.startsWith('Bearer ') ? bearer.slice(7) : getCookie(c,'__Host-moc');
  const principal = token && store.session(token);
  if (!principal) throw new HTTPException(401,{message:'Sign in required'});
  const requestOrigin = c.req.header('Origin');
  if (requestOrigin && requestOrigin !== origin) throw new HTTPException(403,{message:'Origin is not allowed'});
  if (principal.session.kind === 'browser') {
    if (bearer) throw new HTTPException(403,{message:'Browser sessions require a cookie'});
    if (!['GET','HEAD'].includes(c.req.method) && (requestOrigin !== origin || c.req.header('X-CSRF-Token') !== principal.session.csrf)) {
      throw new HTTPException(403,{message:'CSRF validation failed'});
    }
  } else if (!bearer) throw new HTTPException(403,{message:'API sessions require a bearer token'});
  return principal;
}

export function requireAdmin(p: Principal, store: Store, target: string) {
  // An engine never inherits configuration powers, even when its user is an administrator.
  if (p.session.kind !== 'browser' || !p.user.admin) {
    store.audit(p.user.id,'admin.denied',target,'denied',{sessionKind:p.session.kind});
    throw new HTTPException(403,{message:'An administrator console session is required'});
  }
}
export function requireInteractive(p: Principal) {
  if (p.session.kind === 'engine') throw new HTTPException(403,{message:'An interactive user session is required'});
}
export function requireEngine(p: Principal) {
  if (p.session.kind !== 'engine') throw new HTTPException(403,{message:'An engine session is required'});
}

