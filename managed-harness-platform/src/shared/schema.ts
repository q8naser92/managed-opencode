import { z } from "zod";
import { isIP } from "node:net";

export const Mode = z.enum(["deny", "ask", "allow"]);
export const Capability = z.enum(["read", "edit", "cmd", "powershell", "shell"]);
export const HttpsUrl = z.url().refine((v) => {
  const u = new URL(v);
  return u.protocol === "https:" && !u.username && !u.password && !u.hash;
}, "An HTTPS URL without embedded credentials is required");
export const HttpsOrigin = HttpsUrl.refine(value=>{const url=new URL(value);return url.pathname==='/'&&!url.search&&!url.hash;},'Use an HTTPS server address without a path or query').transform(value=>new URL(value).origin);
export const Model = z.object({ id: z.string().min(1).max(120), name: z.string().min(1).max(160), cloud: z.boolean(), enabled: z.boolean() }).strict();
export const Policy = z.object({
  revision: z.number().int().nonnegative(),
  gatewayUrl: HttpsUrl,
  cloudModels: z.boolean().default(false),
  models: z.array(Model).max(100),
  // Older Windows policies must never implicitly grant access to macOS shells.
  tools: z.object({ read: Mode, edit: Mode, cmd: Mode, powershell: Mode, shell: Mode.default("deny") }).strict(),
  maxCommandSeconds: z.number().int().min(1).max(600),
  maxSessionSteps: z.number().int().min(1).max(200),
  localAudit: z.boolean().default(true),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.models.map((m) => m.id)).size !== v.models.length) ctx.addIssue({ code: "custom", message: "Model IDs must be unique" });
});
export type Policy = z.infer<typeof Policy>;
export const ToolSpec = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_.-]{1,100}$/), description: z.string().max(4000).default(""),
  inputSchema: z.record(z.string(), z.unknown()), enabled: z.boolean().default(false), mode: Mode.default("deny"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(), path: z.string().max(500).optional(),
  queryParams: z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/)).max(80).default([]), bodyArgument:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).optional(),
  resourceRules: z.preprocess((value,ctx)=>{if(value&&typeof value==='object'&&Object.hasOwn(value,'__proto__')){ctx.addIssue({code:'custom',message:'The reserved __proto__ resource name is not supported'});return z.NEVER;}return value;},z.record(z.string(), z.array(z.string().max(500)).max(100)).default({})),
}).strict();
export const ConnectorOAuth=z.object({authorizationUrl:HttpsUrl,tokenUrl:HttpsUrl,clientId:z.string().min(1).max(300),scope:z.string().max(2000),resource:HttpsUrl.optional(),clientAuth:z.enum(['none','basic','body']).default('none')}).strict();
export const Connector = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/), name: z.string().min(1).max(100),
  type: z.enum(["mcp", "api"]), url: HttpsUrl, enabled: z.boolean().default(false),
  auth: z.enum(["none", "service", "personal"]), header: z.string().regex(/^(Authorization|X-[A-Za-z0-9-]{1,61})$/i).default("Authorization"),
  prefix: z.enum(["Bearer ", ""]).default("Bearer "), tools: z.array(ToolSpec).max(150).default([]),
  oauth:ConnectorOAuth.optional(),
  version: z.number().int().nonnegative().default(0),
}).strict().superRefine((value,ctx)=>{if(new Set(value.tools.map(t=>t.name)).size!==value.tools.length)ctx.addIssue({code:'custom',message:'Tool names must be unique'});if(value.oauth&&(value.auth!=='personal'||value.header.toLowerCase()!=='authorization'||value.prefix!=='Bearer '))ctx.addIssue({code:'custom',message:'OAuth requires personal authentication with an Authorization Bearer header'});if(value.type==='api'&&value.tools.some(t=>!t.method||!t.path))ctx.addIssue({code:'custom',message:'API actions require a method and path'});});
export type Connector = z.infer<typeof Connector>;
export const Boot = z.object({
  origin: HttpsOrigin, port: z.number().int().min(1).max(65535).default(7443),
  tlsCert: z.string(), tlsKey: z.string(), caFile: z.string().optional(),
  saml: z.object({ entryPoint: HttpsUrl, idpIssuer: z.string().min(1), idpCert: z.string().min(50),
    entityId: z.string().min(1), signingKey: z.string(), signingCert: z.string(),
    adminSubjects: z.array(z.string().min(1)).min(1),
  }).strict().optional(),
  allowedOrigins: z.array(HttpsOrigin).min(1), initialPolicy: Policy,
}).strict();
export type Boot = z.infer<typeof Boot>;
export const Action = z.object({
  id: z.string().regex(/^[a-f0-9-]{20,64}$/), capability: Capability,
  digest: z.string().regex(/^[a-f0-9]{64}$/), session: z.string().min(1).max(100),
  preview: z.string().max(4000).optional(),
}).strict();
export type Action = z.infer<typeof Action>;

export function approvedModels(p: Policy) { return p.models.filter((m) => m.enabled && (!m.cloud || p.cloudModels)); }

export const EmailAddress=z.email().max(254).transform(v=>v.trim().toLowerCase());
export const Smtp=z.object({enabled:z.boolean(),host:z.string().regex(/^[a-zA-Z0-9.-]{1,253}$/),port:z.number().int().min(1).max(65535),mode:z.enum(['starttls','tls']),serverName:z.string().regex(/^[a-zA-Z0-9.-]{1,253}$/).refine(value=>isIP(value)===0,'Use the DNS name on the SMTP certificate, even when connecting to an IP address'),username:z.string().max(256),from:EmailAddress}).strict();
export type Smtp=z.infer<typeof Smtp>;
