import { afterEach, expect, spyOn, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { EnterpriseConfig } from "../src/config/enterprise"
import { ManagedTransport } from "../src/managed-transport"
import { AbsolutePath } from "../src/schema"

const certificate = readFileSync(new URL("../../../../managed-harness-platform/test/fixtures/smtp-test-cert.pem", import.meta.url))
const key = readFileSync(new URL("../../../../managed-harness-platform/test/fixtures/smtp-test-key.pem", import.meta.url))
const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })

function fixture(trust: boolean, redirect = false) {
  const directory = mkdtempSync(path.join(tmpdir(), "managed-transport-test-"))
  cleanups.push(() => rmSync(directory, { recursive:true, force:true }))
  const source = spyOn(EnterpriseConfig, "directory").mockReturnValue(AbsolutePath.make(directory))
  cleanups.push(() => source.mockRestore())
  const requests: string[] = []
  const server = Bun.serve({ hostname:"127.0.0.1", port:0, tls:{cert:certificate,key}, fetch(request) {
    requests.push(request.url)
    return new Response("fixture", { status:redirect?302:401,
      headers:{Connection:"close",...(redirect?{Location:"/other"}:{})} })
  } })
  cleanups.push(() => server.stop(true))
  const origin = `https://127.0.0.1:${server.port}`
  writeFileSync(path.join(directory,"gateway-ca.pem"), certificate)
  writeFileSync(path.join(directory,"client.json"), JSON.stringify({ serverOrigin:origin,
    ...(trust?{caSha256:createHash("sha256").update(certificate).digest("hex")}:{}) }))
  return { directory, origin, requests }
}

test("an untrusted certificate is rejected without a managed CA bundle", async () => {
  const f = fixture(false)
  await expect(ManagedTransport.fetch(f.origin+"/v1/models")).rejects.toThrow()
  expect(f.requests).toHaveLength(0)
})

test("a verified administrator CA enables direct HTTPS without a localhost HTTP relay", async () => {
  const f = fixture(true)
  const response = await ManagedTransport.fetch(f.origin+"/v1/models")
  expect(response.status).toBe(401) // HTTP authentication is reached only after TLS succeeds.
  await response.body?.cancel()
  expect(f.requests).toEqual([f.origin+"/v1/models"])
})

test("a modified CA bundle fails before the connection", async () => {
  const f = fixture(true)
  writeFileSync(path.join(f.directory,"gateway-ca.pem"), "changed")
  await expect(ManagedTransport.fetch(f.origin+"/v1/models")).rejects.toThrow("CA bundle has changed")
  expect(f.requests).toHaveLength(0)
})

test("caller-supplied TLS options cannot disable certificate validation", async () => {
  const f = fixture(false)
  const options = {method:"GET",tls:{rejectUnauthorized:false,ca:certificate.toString()},proxy:false}
  await expect(ManagedTransport.fetch(f.origin+"/v1/models",options)).rejects.toThrow()
  expect(f.requests).toHaveLength(0)
})

test("inherited TLS-disable and proxy settings do not weaken the managed connection", async () => {
  const names = ["NODE_TLS_REJECT_UNAUTHORIZED","HTTPS_PROXY","HTTP_PROXY","ALL_PROXY"]
  const before = Object.fromEntries(names.map(name => [name,process.env[name]]))
  cleanups.push(() => { for (const name of names) { if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name] } })
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
  for (const name of names.slice(1)) process.env[name] = "http://127.0.0.1:1"
  const untrusted = fixture(false)
  await expect(ManagedTransport.fetch(untrusted.origin+"/v1/models")).rejects.toThrow()
  const trusted = fixture(true)
  const response = await ManagedTransport.fetch(trusted.origin+"/v1/models")
  expect(response.status).toBe(401)
  await response.body?.cancel()
  expect(untrusted.requests).toHaveLength(0)
  expect(trusted.requests).toHaveLength(1)
})

test("HTTPS redirects cannot move requests away from the approved path", async () => {
  const f = fixture(true,true)
  await expect(ManagedTransport.fetch(f.origin+"/v1/models")).rejects.toThrow("redirects are disabled")
  expect(f.requests).toEqual([f.origin+"/v1/models"])
})

test("HTTP and a different HTTPS origin are rejected before networking", async () => {
  const f = fixture(true)
  await expect(ManagedTransport.fetch(f.origin.replace("https:","http:")+"/v1/models")).rejects.toThrow("not an approved HTTPS gateway")
  await expect(ManagedTransport.fetch(f.origin.replace("127.0.0.1","localhost")+"/v1/models")).rejects.toThrow("not an approved HTTPS gateway")
  expect(f.requests).toHaveLength(0)
})
