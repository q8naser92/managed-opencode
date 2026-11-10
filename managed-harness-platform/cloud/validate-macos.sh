#!/bin/bash
set -euo pipefail

# Run only from the reviewed source-bundle root on a real hosted Mac.
root="$(pwd)"
test "$(uname -s)" = Darwin
test -d "$root/managed-opencode-fork/packages/core"
mkdir -p "$root/macos-evidence"
exec > >(tee "$root/macos-evidence/validation.log") 2>&1
sw_vers
uname -m
bun --version
bun -e 'if (process.platform !== "darwin" || process.arch !== process.env.EXPECTED_MAC_ARCH) throw new Error("Wrong host architecture")'

cd "$root/managed-opencode-fork"
bun install --frozen-lockfile
cd packages/core
bun run typecheck
bun run script/test.ts test/managed-macos.test.ts test/managed-origin.test.ts test/managed-transport.test.ts test/managed-local-permission.test.ts test/config/enterprise.test.ts
cd ../server
bun test test/managed-routes.test.ts
cd ../cli

case "$EXPECTED_MAC_ARCH" in
  arm64) export OPENCODE_TARGET=darwin-arm64 ;;
  x64) export OPENCODE_TARGET=darwin-x64-baseline ;;
  *) echo "Unsupported architecture"; exit 1 ;;
esac
export OPENCODE_VERSION=2.2.6-managed.macos-preview
export OPENCODE_CHANNEL=macos-preview
bun run script/build.ts --skip-install --skip-web-ui --outdir=dist-macos-validation
engine="dist-macos-validation/cli-$OPENCODE_TARGET/bin/opencode"
test -f "$engine"
file "$engine"
"$engine" --version
cp "$engine" "$root/macos-evidence/opencode-engine"
shasum -a 256 "$root/macos-evidence/opencode-engine" > "$root/macos-evidence/SHA256SUMS.txt"
printf '%s\n' 'Engine-only validation. No desktop app, installer, Gatekeeper, signing, GUI login, Windows-server integration or process-tree lifecycle approval.' > "$root/macos-evidence/SCOPE.txt"
