export * as ManagedCentral from "./managed-central.js"

import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { dlopen } from "bun:ffi"
import { Effect, Schema } from "effect"
import { ManagedTransport } from "./managed-transport.js"
import { ManagedMacOS } from "./managed-macos.js"

export class Unavailable extends Schema.TaggedError<Unavailable>()("ManagedCentral.Unavailable", {
  reason: Schema.String,
}) {}

const Decision = Schema.Struct({ id: Schema.String, status: Schema.String, revision: Schema.Number })
const Grant = Schema.Struct({ id: Schema.String, revision: Schema.Number, maxCommandSeconds: Schema.Number })
const Catalog = Schema.Struct({ revision: Schema.Number })
export type Capability = "read" | "edit" | "cmd" | "powershell" | "shell"

export const request = Effect.fn("ManagedCentral.request")(function* (route: string, body?: unknown) {
  return yield* Effect.tryPromise({
    try: async (signal) => {
      const token = process.env.MANAGED_OPENCODE_SESSION
      if (!token) throw new Error("Sign in through the managed client")
      const response = await ManagedTransport.fetch(ManagedTransport.settings().serverOrigin + route, {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`Management server refused the request (${response.status})`)
      }
      return await response.json() as unknown
    },
    catch: () => new Unavailable({ reason: "A current connection and server authorization are required" }),
  })
})

/** The server grants a particular operation once. No offline or last-known-policy fallback. */
export const authorize = Effect.fn("ManagedCentral.authorize")(function* (
  capability: Capability,
  session: string,
  operation: unknown,
  preview: string,
) {
  const action = {
    id: randomUUID(), capability, session,
    digest: createHash("sha256").update(JSON.stringify(operation)).digest("hex"),
    preview: preview.slice(0, 4000),
  }
  while (true) {
    const decision = yield* request("/api/actions", action).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Decision)))
    if (decision.status === "approved") break
    if (decision.status !== "pending") return yield* new Unavailable({ reason: `The administrator's policy ${decision.status} this action` })
    yield* Effect.sleep("500 millis")
  }
  return yield* request("/api/actions/consume", action).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Grant)))
})

export const currentRevision = request("/api/catalog").pipe(Effect.flatMap(Schema.decodeUnknownEffect(Catalog)))

/** Resolve the OS location independently of the user's WINDIR, COMSPEC and PATH. */
export function systemDirectory() {
  const library = dlopen("kernel32.dll", { GetSystemDirectoryW: { args: ["ptr", "u32"], returns: "u32" } })
  const buffer = new Uint16Array(32768)
  try {
    const length = library.symbols.GetSystemDirectoryW(buffer, buffer.length)
    if (length === 0 || length >= buffer.length) throw new Error("Cannot resolve the Windows system directory")
    return new TextDecoder("utf-16le").decode(buffer.subarray(0, length))
  } finally { library.close() }
}

export function defaultShell() {
  if (process.platform === "darwin") return ManagedMacOS.shell
  if (process.platform !== "win32") throw new Error("Unsupported managed client platform")
  return path.join(systemDirectory(), "WindowsPowerShell", "v1.0", "powershell.exe")
}

export function shellCapability(shell: string): Capability {
  if (process.platform === "darwin") {
    ManagedMacOS.args(shell, "")
    return "shell"
  }
  if (process.platform !== "win32") throw new Error("Unsupported managed client platform")
  const normalized = path.win32.resolve(shell).toLowerCase()
  if (normalized === defaultShell().toLowerCase()) return "powershell"
  if (normalized === path.join(systemDirectory(), "cmd.exe").toLowerCase()) return "cmd"
  throw new Error("Only installed Windows command shells are supported by this managed client")
}

export function childEnvironment(env: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !/^(MANAGED_OPENCODE_|OPENCODE_SERVER_|OPENCODE_PASSWORD$|BUN_BE_BUN$|BUN_OPTIONS$|NODE_OPTIONS$|BASH_ENV$|ENV$|ZDOTDIR$|SHELLOPTS$|BASHOPTS$|FPATH$|DYLD_|LD_PRELOAD$|BASH_FUNC_)/i.test(key)))
}
