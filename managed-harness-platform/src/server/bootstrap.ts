import { z } from 'zod';
import { EmailAddress,Smtp } from '../shared/schema.ts';
import { Store,hash } from './store.ts';
import { smtpAudience,smtpSettings } from './email-login.ts';
import type { Boot } from '../shared/schema.ts';

export function assertAdministratorAccess(boot:Boot,store:Store){
  if(boot.saml?.adminSubjects.some(subject=>!store.user(hash(JSON.stringify([boot.saml!.idpIssuer,subject])))?.disabled))return;
  const smtp=smtpSettings(store);
  const admin=store.db.query('SELECT u.id FROM users u JOIN local_emails e ON e.user_id=u.id WHERE u.admin=1 AND u.disabled=0 LIMIT 1').get();
  if(admin&&smtp?.enabled&&(!smtp.username||store.secret('service','smtp',smtpAudience(smtp))))return;
  throw new Error('Configure a SAML administrator or an enabled email administrator with SMTP before completing setup');
}

export const Bootstrap=z.object({adminEmail:EmailAddress,smtp:Smtp,smtpPassword:z.string().max(4096).optional()}).strict();
export function initializeAdministrator(store:Store,input:unknown){
  const value=Bootstrap.parse(input);
  if(!value.smtp.enabled)throw new Error('Initial email sign-in must be enabled');
  return store.db.transaction(()=>{
    const existing=store.localUser(value.adminEmail);
    const admins=store.db.query<{count:number},[]>('SELECT COUNT(*) as count FROM users WHERE admin=1').get()!.count;
    if(admins&&(!existing||!existing.admin||existing.disabled))throw new Error('Use the existing administrator email when reconfiguring this server');
    if(existing?.disabled)throw new Error('A disabled account cannot be the bootstrap administrator');
    if(value.smtp.username&&!value.smtpPassword&&!store.secret('service','smtp',smtpAudience(value.smtp)))throw new Error('A password is required for this SMTP identity');
    const admin=existing??store.createLocalUser(value.adminEmail,true);
    if(!admin.admin)store.db.query('UPDATE users SET admin=1 WHERE id=?').run(admin.id);
    store.db.query("INSERT INTO settings VALUES('smtp',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").run(JSON.stringify(value.smtp));
    if(value.smtpPassword)store.putSecret('service','smtp',smtpAudience(value.smtp),value.smtpPassword);
    store.audit('installer','server.configured',admin.id,'success',{smtpHost:value.smtp.host,smtpPort:value.smtp.port});return admin.id;
  })();
}
