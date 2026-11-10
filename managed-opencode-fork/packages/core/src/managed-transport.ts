export * as ManagedTransport from "./managed-transport.js"

import path from "node:path"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { rootCertificates } from "node:tls"
import { Schema } from "effect"
import { EnterpriseConfig } from "./config/enterprise.js"

const Settings = Schema.Struct({
  serverOrigin: Schema.String,
  caSha256: Schema.optional(Schema.String),
})
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Settings))

export function settings() {
  return parseSettings(readFileSync(path.join(EnterpriseConfig.directory(), "client.json"), "utf8"))
}

export function parseSettings(content: string) {
  const value = decode(content)
  const url = new URL(value.serverOrigin)
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password)
    throw new Error("The management server must be a protected HTTPS origin")
  return { ...value, serverOrigin: url.origin }
}

/** Shared by inference, model discovery and remote MCP. No inherited proxy or CA overrides. */
export const fetch: typeof globalThis.fetch = Object.assign(
  async (input: string | URL | Request, init?: RequestInit) => {
    const directory = EnterpriseConfig.directory()
    const policy = settings()
    const request = input instanceof Request ? new Request(input, init) : new Request(input.toString(), init)
    const url = new URL(request.url)
    if (url.protocol !== "https:" || url.username || url.password || url.origin !== policy.serverOrigin)
      throw new Error("The destination is not an approved HTTPS gateway")
    const ca = (() => {
      if (!policy.caSha256) return [...rootCertificates]
      const bundle = readFileSync(path.join(directory, "gateway-ca.pem"))
      if (createHash("sha256").update(bundle).digest("hex") !== policy.caSha256.toLowerCase())
        throw new Error("The managed CA bundle has changed; contact the administrator")
      return [...rootCertificates, bundle.toString("utf8")]
    })()
    // Construct a standard Request first: caller-specific Bun options (unix,
    // proxy, tls, serverName) cannot override this administrator-owned boundary.
    const response = await globalThis.fetch(request, {
      proxy: false,
      redirect: "manual",
      tls: { ca, rejectUnauthorized: true },
    })
    if (response.status >= 300 && response.status < 400 && response.headers.has("location")) {
      await response.body?.cancel()
      throw new Error("Gateway redirects are disabled; configure the final HTTPS URL")
    }
    return response
  },
  { preconnect: globalThis.fetch.preconnect },
)
