import { readFileSync } from "node:fs";
import { rootCertificates } from "node:tls";
import type { Boot } from "../shared/schema.ts";

export function transport(boot: Boot, origins: () => string[] = () => boot.allowedOrigins) {
  const ca = [...rootCertificates, ...(boot.caFile ? [readFileSync(boot.caFile,"utf8")] : [])];
  return async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input,init); const url = new URL(req.url);
    const allowed = new Set(origins().map((v) => new URL(v).origin));
    if (url.protocol !== "https:" || url.username || url.password || !allowed.has(url.origin)) throw new Error("Destination is not in the administrator's approved origin list");
    const response = await fetch(req, { proxy:false, redirect:"manual", tls:{ca,rejectUnauthorized:true} });
    if (response.status >=300 && response.status<400) { await response.body?.cancel(); throw new Error("Upstream redirects are disabled"); }
    return response;
  };
}
