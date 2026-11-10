# Build from source

Extract the source archive with `managed-harness-platform` and `managed-opencode-fork` beside one another. The fork is based on upstream commit `dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06`; the archive contains the managed changes in place. There is no dependency on the private lab directories.

Use x64 Windows, PowerShell 5.1 or later, .NET Framework 4.7.2 or later, Bun **1.4.4**, .NET SDK **10.0.403**, and WiX **5.0.2**. This is the recorded toolchain, not a claim that rebuilding produces byte-identical files: MSI identifiers, timestamps and upstream build inputs can differ. Deployment hosts do not need Bun, Node, the .NET SDK or WiX installed.

Install Bun 1.4.4 from its official release and put `bun.exe` on PATH. Install/extract the official x64 .NET SDK into `managed-harness-platform\tools\dotnet`. The tested SDK archive is `https://builds.dotnet.microsoft.com/dotnet/Sdk/10.0.403/dotnet-sdk-10.0.403-win-x64.zip`, SHA512 `7a114c318fa7f1d9822991b534b2814d0e78386ceda816b371f5141acefe741d87ccb606ede06cadac8f9ac5070e32b708a67bbd1619ff5e5a7858a27874ef48`.

From the platform directory:

```powershell
$env:DOTNET_ROOT = Join-Path $PWD 'tools\dotnet'
$env:DOTNET_ROLL_FORWARD = 'Major'
& .\tools\dotnet\dotnet.exe tool install wix --version 5.0.2 --tool-path .\tools\wix5
bun install --frozen-lockfile
bun test test
bun run check
```

From the adjacent fork directory:

```powershell
bun install --frozen-lockfile
$env:OPENCODE_VERSION = '2.2.6-managed.3'
$env:OPENCODE_TARGET = 'windows-x64-baseline'
bun run packages/cli/script/build.ts --skip-install --skip-web-ui
```

Return to the platform directory:

```powershell
.\script\build-client.ps1
.\script\build-server.ps1 -BunPath bun
.\script\build-installer.ps1
```

Outputs are in `dist\Setup`. The native client and service use the Windows .NET Framework compiler. The server and engine embed the Bun runtime. The upstream web UI is omitted; this distribution uses the native managed GUI. Build network access is needed for dependency and native-runtime downloads. Follow the fork's AGENTS.md for its typechecking and tests.

The source archive also supplies the pinned WiX source used by the MSI custom-action runtime and Bun source. Bun's own `LICENSE.md` explains how to fetch its pinned WebKit source and rebuild/relink its JavaScriptCore dependencies. Keep all dependency notices with redistributed binaries. Rebuilding and signing is the organization's responsibility when it adopts this project.

`script/assemble-release.py` is the release maintainer's packaging script. It expects compiled outputs and the upstream Bun/WiX source archives in `release-input`; it does not download or include any private lab configuration. Its license inventory is deliberately broader than the runtime dependency set and is not a certified SBOM.

After building, run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File test\InstallerAcl.Tests.ps1` for the installer permission regression. It examines the compiled native validator and extracts the actual PowerShell validation expressions; it changes no filesystem permissions.
