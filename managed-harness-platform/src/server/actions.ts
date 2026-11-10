import { HTTPException } from 'hono/http-exception';
import type { Action } from '../shared/schema.ts';
import type { Principal } from './authorization.ts';
import { requireEngine, requireInteractive } from './authorization.ts';
import type { Store } from './store.ts';

type ManagedAction=Omit<Action,'capability'>&{capability:Action['capability']|`connector:${string}:${string}`};
type Row = ManagedAction & { owner:string; engine:string; revision:number; status:string; expires:number };
export class Actions {
  readonly previews=new Map<string,{text:string;expires:number}>();
  constructor(readonly store:Store) {}
  get(id:string) { return this.store.db.query<Row,[string]>('SELECT * FROM actions WHERE id=?').get(id); }
  request(p:Principal, action:ManagedAction) {
    requireEngine(p);
    const existing = this.get(action.id);
    if (existing) {
      if (existing.engine !== p.session.token || existing.digest !== action.digest || existing.capability !== action.capability || existing.session !== action.session) {
        throw new HTTPException(409,{message:'Action identifier already used'});
      }
      return {id:existing.id,status:this.current(existing),revision:existing.revision};
    }
    const policy = this.store.policy;
    const mode = action.capability.startsWith('connector:') ? this.connectorMode(action.capability) : policy.tools[action.capability as Action['capability']];
    const status = mode === 'allow' ? 'approved' : mode === 'ask' ? 'pending' : 'denied';
    for (const [id,item] of this.previews) if(item.expires<=Date.now()) this.previews.delete(id);
    if (status==='pending') this.previews.set(action.id,{text:action.preview??'No preview supplied; deny this request.',expires:Date.now()+60_000});
    this.store.db.query('INSERT INTO actions VALUES(?,?,?,?,?,?,?,?,?)').run(action.id,p.user.id,p.session.token,action.session,action.capability,action.digest,policy.revision,status,Date.now()+60_000);
    this.store.audit(p.user.id,'tool.authorization',action.capability,status,{id:action.id,revision:policy.revision});
    return {id:action.id,status,revision:policy.revision};
  }
  decide(p:Principal,id:string,approve:boolean) {
    requireInteractive(p);
    const row=this.get(id);
    if (!row || row.owner !== p.user.id) throw new HTTPException(404,{message:'Action not found'});
    if (this.current(row) !== 'pending') throw new HTTPException(409,{message:'Action is no longer pending'});
    if (approve && !this.previews.has(id)) throw new HTTPException(409,{message:'Approval preview expired; request the action again'});
    const status=approve ? 'approved' : 'denied';
    this.store.db.query("UPDATE actions SET status=? WHERE id=? AND status='pending'").run(status,id);
    this.store.audit(p.user.id,'tool.approval',row.capability,status,{id});
    return {id,status};
  }
  consume(p:Principal,action:ManagedAction) {
    requireEngine(p);
    return this.store.db.transaction(() => {
      const row=this.get(action.id);
      if (!row || row.engine !== p.session.token || row.owner !== p.user.id || row.digest !== action.digest || row.capability !== action.capability || row.session !== action.session || this.current(row) !== 'approved') {
        throw new HTTPException(403,{message:'Current one-use authorization is required'});
      }
      this.store.db.query("UPDATE actions SET status='consumed' WHERE id=? AND status='approved'").run(row.id);
      this.previews.delete(row.id);
      return {id:row.id,revision:row.revision,maxCommandSeconds:this.store.policy.maxCommandSeconds};
    })();
  }
  current(row:Row) {
    if (row.expires <= Date.now()) return 'expired';
    if (row.revision !== this.store.policy.revision) return 'revoked';
    return row.status;
  }
  private connectorMode(capability:string){const [,id,name]=capability.split(':');const connector=this.store.connector(id!);const tool=connector?.tools.find(t=>t.name===name);return connector?.enabled&&tool?.enabled?tool.mode:'deny';}
}
