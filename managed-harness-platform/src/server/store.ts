import { Database } from "bun:sqlite";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Policy, Connector } from "../shared/schema.ts";

export function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function randomToken() { return randomBytes(32).toString("base64url"); }
export type User = { id: string; subject: string; display: string; admin: number; disabled: number; created: number; };
export type Session = { token: string; user_id: string; kind: "browser" | "desktop" | "engine"; parent: string | null; csrf: string; expires: number; };
export class Store {
  readonly db: Database;
  readonly pending=new Set<Promise<void>>();
  background(task:Promise<void>){this.pending.add(task);void task.finally(()=>this.pending.delete(task));}
  async drain(){await Promise.allSettled([...this.pending]);}
  constructor(file: string, readonly key: Buffer) {
    if (key.length !== 32) throw new Error("Invalid vault key");
    this.db = new Database(file, { create: true });
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, subject TEXT UNIQUE NOT NULL, display TEXT NOT NULL, admin INTEGER NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, parent TEXT, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS secrets (owner TEXT NOT NULL, purpose TEXT NOT NULL, audience TEXT NOT NULL, ciphertext TEXT NOT NULL, PRIMARY KEY(owner,purpose));
      CREATE TABLE IF NOT EXISTS secret_generations (owner TEXT NOT NULL, purpose TEXT NOT NULL, generation INTEGER NOT NULL, PRIMARY KEY(owner,purpose));
      CREATE TABLE IF NOT EXISTS connectors (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS local_emails (email TEXT PRIMARY KEY, user_id TEXT UNIQUE NOT NULL REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS transient (id TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY, owner TEXT NOT NULL, engine TEXT NOT NULL, session TEXT NOT NULL, capability TEXT NOT NULL, digest TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, actor TEXT NOT NULL, event TEXT NOT NULL, target TEXT NOT NULL, result TEXT NOT NULL, details TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS audit_time ON audit(ts);
      CREATE INDEX IF NOT EXISTS actions_engine ON actions(engine,status);`);
  }
  close() { this.db.close(); }
  get policy(): Policy {
    const row = this.db.query<{ value: string }, []>("SELECT value FROM settings WHERE id='policy'").get();
    if (!row) throw new Error("Policy is not initialized");
    return Policy.parse(JSON.parse(row.value));
  }
  initialize(policy: Policy) { this.db.query("INSERT OR IGNORE INTO settings VALUES ('policy',?)").run(JSON.stringify(Policy.parse(policy))); }
  setPolicy(value: Policy, actor: string) {
    return this.db.transaction(() => {
      const before = this.policy;
      if (value.revision !== before.revision) throw new Error("Policy changed; reload before saving");
      const next = Policy.parse({ ...value, revision: before.revision + 1 });
      this.db.query("UPDATE settings SET value=? WHERE id='policy'").run(JSON.stringify(next));
      this.db.query("UPDATE actions SET status='revoked' WHERE status IN ('pending','approved')").run();
      this.audit(actor, "policy.changed", "shared", "success", { beforeRevision: before.revision, revision: next.revision, changed: Object.keys(next).filter((k) => JSON.stringify(next[k as keyof Policy]) !== JSON.stringify(before[k as keyof Policy])) });
      return next;
    })();
  }
  upsertUser(subject: string, display: string, admin: boolean) {
    const id = hash(subject);
    const created = !this.user(id);
    this.db.query("INSERT INTO users(id,subject,display,admin,created) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET display=excluded.display,admin=excluded.admin").run(id, subject, display.slice(0,160), admin ? 1 : 0, Date.now());
    if (created) this.audit(id, "user.created", id, "success");
    return this.user(id)!;
  }
  user(id: string) { return this.db.query<User, [string]>("SELECT * FROM users WHERE id=?").get(id); }
  localUser(email:string) {const row=this.db.query<{user_id:string},[string]>('SELECT user_id FROM local_emails WHERE email=?').get(email);return row?this.user(row.user_id):null;}
  createLocalUser(email:string,admin=false) {
    if(this.localUser(email)) throw new Error('Email account already exists');
    return this.db.transaction(()=>{const user=this.upsertUser(JSON.stringify(['local-email',email]),email,admin);this.db.query('INSERT INTO local_emails VALUES(?,?)').run(email,user.id);return user;})();
  }
  issue(user: string, kind: Session["kind"], parent: string | null = null) {
    const token = randomToken(); const csrf = randomToken();
    const expires = Date.now() + (kind === "engine" ? 60 * 60_000 : 8 * 60 * 60_000);
    this.db.query("INSERT INTO sessions VALUES(?,?,?,?,?,?)").run(hash(token), user, kind, parent, csrf, expires);
    return { token, csrf, expires };
  }
  session(token: string) {
    return this.sessionHash(hash(token));
  }
  sessionHash(tokenHash: string) {
    const s = this.db.query<Session, [string]>("SELECT * FROM sessions WHERE token=?").get(tokenHash);
    if (!s || s.expires <= Date.now()) return null;
    if (s.parent) {
      const p = this.db.query<Session, [string]>("SELECT * FROM sessions WHERE token=?").get(s.parent);
      if (!p || p.expires <= Date.now()) return null;
    }
    const user = this.user(s.user_id);
    return user && !user.disabled ? { session: s, user } : null;
  }
  revoke(tokenHash: string) { this.db.query("DELETE FROM sessions WHERE token=? OR parent=?").run(tokenHash, tokenHash); }
  putSecret(owner: string, purpose: string, audience: string, value: string) {
    const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(JSON.stringify([owner, purpose, audience])));
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const ciphertext = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
    this.db.transaction(()=>{this.db.query("INSERT INTO secrets VALUES(?,?,?,?) ON CONFLICT(owner,purpose) DO UPDATE SET audience=excluded.audience,ciphertext=excluded.ciphertext").run(owner, purpose, audience, ciphertext);this.advanceSecret(owner,purpose);})();
  }
  secret(owner: string, purpose: string, audience: string) {
    const row = this.db.query<{ ciphertext: string; audience: string }, [string, string]>("SELECT ciphertext,audience FROM secrets WHERE owner=? AND purpose=?").get(owner, purpose);
    if (!row || row.audience !== audience) return null;
    const data = Buffer.from(row.ciphertext, "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, data.subarray(0,12));
    decipher.setAAD(Buffer.from(JSON.stringify([owner, purpose, audience])));
    decipher.setAuthTag(data.subarray(12,28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
  }
  secretGeneration(owner:string,purpose:string) {return this.db.query<{generation:number},[string,string]>('SELECT generation FROM secret_generations WHERE owner=? AND purpose=?').get(owner,purpose)?.generation??0;}
  private advanceSecret(owner:string,purpose:string){this.db.query('INSERT INTO secret_generations VALUES(?,?,1) ON CONFLICT(owner,purpose) DO UPDATE SET generation=generation+1').run(owner,purpose);}
  deleteSecret(owner: string, purpose: string) { this.db.transaction(()=>{this.db.query("DELETE FROM secrets WHERE owner=? AND purpose=?").run(owner,purpose);this.advanceSecret(owner,purpose);})(); }
  connectors() { return this.db.query<{ value: string }, []>("SELECT value FROM connectors ORDER BY id").all().map((r) => Connector.parse(JSON.parse(r.value))); }
  connector(id: string) { return this.connectors().find((c) => c.id === id); }
  putConnector(value: Connector, actor: string) {
    return this.db.transaction(()=>{
    const old = this.connector(value.id);
    if (old && old.version !== value.version) throw new Error("Connector changed; reload before saving");
    if (old && old.url !== value.url) this.db.query("DELETE FROM secrets WHERE purpose=?").run(`connector:${value.id}`);
    const next = Connector.parse({ ...value, version: (old?.version ?? 0) + 1 });
    this.db.query("INSERT INTO connectors VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").run(next.id, JSON.stringify(next));
    // A connector update invalidates grants and active work just like another shared policy change.
    this.setPolicy(this.policy,actor);
    this.audit(actor, old ? "connector.changed" : "connector.created", next.id, "success", { version: next.version, enabled: next.enabled, tools: next.tools.filter((t) => t.enabled).map((t) => t.name) });
    return next;
    })();
  }
  putTransient(id: string, value: string, expires = Date.now()+300_000) { this.db.query("INSERT OR REPLACE INTO transient VALUES(?,?,?)").run(id,value,expires); }
  transient(id: string) {
    const row = this.db.query<{value:string;expires:number}, [string]>("SELECT value,expires FROM transient WHERE id=?").get(id);
    return row && row.expires > Date.now() ? row.value : null;
  }
  consume(id: string) { return this.db.transaction(() => { const v=this.transient(id); this.db.query("DELETE FROM transient WHERE id=?").run(id); return v; })(); }
  saveOnce(id: string, value: string, expires: number) {
    return this.db.transaction(() => {
      if (this.transient(id) !== null) return false;
      this.putTransient(id,value,expires);
      return true;
    })();
  }
  audit(actor: string, event: string, target: string, result: string, details: Record<string,unknown> = {}) {
    // Callers pass bounded metadata, never request bodies, raw commands, prompts or credentials.
    this.db.query("INSERT INTO audit(ts,actor,event,target,result,details) VALUES(?,?,?,?,?,?)").run(Date.now(),actor,event,target,result,JSON.stringify(details));
  }
}
