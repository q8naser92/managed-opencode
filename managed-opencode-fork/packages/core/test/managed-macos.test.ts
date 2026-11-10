import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { EnterpriseConfig } from "../src/config/enterprise"
import { ManagedCentral } from "../src/managed-central"
import { ManagedMacOS } from "../src/managed-macos"

test("managed macOS shells require exact OS paths and disable user startup files", () => {
  expect(ManagedMacOS.args("/bin/zsh", "echo ok")).toEqual(["-f", "-c", "echo ok"])
  expect(ManagedMacOS.args("/bin/bash", "echo ok")).toEqual(["--noprofile", "--norc", "-c", "echo ok"])
  for (const file of ["zsh", "bash", "/tmp/zsh", "/usr/local/bin/bash", "/bin/../bin/zsh", "/bin/zsh -c", "/bin/sh", "/bin/ZSH", "/bin/zsh\0"]) {
    expect(() => ManagedMacOS.args(file, "echo ok")).toThrow()
  }
  expect(ManagedMacOS.directory).toBe("/Library/Application Support/ManagedOpenCodeCentral/Client")
})

test("child commands cannot inherit management credentials or shell startup injection", () => {
  const env = {
    PATH: "/usr/bin:/bin", HOME: "/Users/test", LANG: "en_US.UTF-8", USER_DATA: "retained",
    MANAGED_OPENCODE_SESSION: "secret", OPENCODE_SERVER_PASSWORD: "secret", OPENCODE_PASSWORD: "secret",
    BUN_BE_BUN: "1", BUN_OPTIONS: "--preload attack.js", NODE_OPTIONS: "--import attack.js",
    BASH_ENV: "/tmp/attack", ENV: "/tmp/attack", ZDOTDIR: "/tmp/attack", SHELLOPTS: "xtrace",
    BASHOPTS: "expand_aliases", FPATH: "/tmp/attack", DYLD_INSERT_LIBRARIES: "/tmp/attack.dylib",
    LD_PRELOAD: "/tmp/attack.so", "BASH_FUNC_eval%%": "() { echo injected; }",
  }
  expect(ManagedCentral.childEnvironment(env)).toEqual({PATH:env.PATH,HOME:env.HOME,LANG:env.LANG,USER_DATA:env.USER_DATA})
})

describe.skipIf(process.platform !== "darwin")("real macOS runtime", () => {
  test("native platform selects the fixed enrollment path and centrally controlled macOS shell", () => {
    expect(String(EnterpriseConfig.directory())).toBe(ManagedMacOS.directory)
    expect(ManagedCentral.defaultShell()).toBe("/bin/zsh")
    expect(ManagedCentral.shellCapability("/bin/zsh")).toBe("shell")
    expect(ManagedCentral.shellCapability("/bin/bash")).toBe("shell")
    expect(() => ManagedCentral.shellCapability("/tmp/zsh")).toThrow()
  })

  test("actual zsh and bash ignore user startup files and do not receive session secrets", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "managed-mac-shell-"))
    try {
      for (const file of [".zshenv", ".zprofile", ".zshrc", ".bash_profile", ".bashrc", "inject.sh"]) {
        writeFileSync(path.join(directory, file), "printf INJECTED\\n\n", "utf8")
      }
      const env = ManagedCentral.childEnvironment({ ...process.env, HOME:directory, ZDOTDIR:directory,
        BASH_ENV:path.join(directory,"inject.sh"), ENV:path.join(directory,"inject.sh"),
        MANAGED_OPENCODE_SESSION:"must-not-reach-shell", OPENCODE_SERVER_PASSWORD:"must-not-reach-shell" })
      for (const shell of ["/bin/zsh", "/bin/bash"]) {
        const command = 'test -z "${MANAGED_OPENCODE_SESSION-}" && test -z "${OPENCODE_SERVER_PASSWORD-}" && printf MANAGED_OK'
        const result = Bun.spawnSync([shell, ...ManagedMacOS.args(shell, command)], { env })
        expect(result.exitCode).toBe(0)
        expect(result.stdout.toString()).toBe("MANAGED_OK")
        expect(result.stderr.toString()).toBe("")
      }
    } finally {
      rmSync(directory, { recursive:true, force:true })
    }
  })
})

test.skipIf(process.platform !== "win32")("Windows still resolves native PowerShell and CMD independently", () => {
  const system = ManagedCentral.systemDirectory()
  expect(ManagedCentral.defaultShell()).toBe(path.join(system,"WindowsPowerShell","v1.0","powershell.exe"))
  expect(ManagedCentral.shellCapability(ManagedCentral.defaultShell())).toBe("powershell")
  expect(ManagedCentral.shellCapability(path.join(system,"cmd.exe"))).toBe("cmd")
  expect(() => ManagedCentral.shellCapability("/bin/zsh")).toThrow()
  expect(EnterpriseConfig.directory()).toMatch(/ManagedOpenCodeCentral[\\/]Client$/)
})
