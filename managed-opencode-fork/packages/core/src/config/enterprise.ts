export * as EnterpriseConfig from "./enterprise.js"

import path from "node:path"
import { dlopen } from "bun:ffi"
import { AbsolutePath } from "../schema.js"
import { ManagedMacOS } from "../managed-macos.js"

// This fork is always managed. There is deliberately no environment or CLI opt-out.
export const enabled = true

export function directory() {
  if (process.platform === "darwin") return AbsolutePath.make(ManagedMacOS.directory)
  if (process.platform !== "win32") throw new Error("This managed build requires Windows or macOS")
  const library = dlopen("shell32.dll", {
    SHGetFolderPathW: { args: ["ptr", "i32", "ptr", "u32", "ptr"], returns: "i32" },
  })
  const buffer = new Uint16Array(260)
  try {
    // CSIDL_COMMON_APPDATA is resolved by Windows, never by the caller's ProgramData.
    const result = library.symbols.SHGetFolderPathW(null, 0x23, null, 0, buffer)
    if (result !== 0) throw new Error(`Cannot resolve managed configuration directory (${result})`)
    const length = buffer.indexOf(0)
    if (length <= 0) throw new Error("Windows returned an invalid managed configuration directory")
    return AbsolutePath.make(path.join(new TextDecoder("utf-16le").decode(buffer.subarray(0, length)), "ManagedOpenCodeCentral", "Client"))
  } finally {
    library.close()
  }
}
