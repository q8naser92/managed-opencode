export * as ManagedMacOS from "./managed-macos.js"

// This location is installed and owned by the administrator. Never use HOME,
// XDG_CONFIG_HOME, a workspace file, or an environment variable for enrollment.
export const directory = "/Library/Application Support/ManagedOpenCodeCentral/Client"
export const shell = "/bin/zsh"

export function args(file: string, command: string) {
  if (file === "/bin/zsh") return ["-f", "-c", command]
  if (file === "/bin/bash") return ["--noprofile", "--norc", "-c", command]
  throw new Error("Only /bin/zsh and /bin/bash are supported by this managed macOS client")
}
