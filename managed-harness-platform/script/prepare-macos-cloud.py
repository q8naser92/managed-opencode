"""Prepare a reviewable, source-only GitHub tree without publishing or running CI."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
fork = root.parent / "managed-opencode-fork"
files = {}


def add(base, relative, destination):
    # Platform folders are explicitly selected below. Only filter generated
    # subdirectories there; a tracked upstream path named tools/bin/release is
    # source, not a local output folder, and must be preserved for imports.
    if base == root and ("__pycache__" in relative.parts or
                         (relative.parts[0] == "packaging" and any(part in {"bin", "obj"} for part in relative.parts))):
        return
    source = base / relative
    if not source.is_file():
        return
    if source.is_symlink() or not source.resolve().is_relative_to(base.resolve()):
        raise RuntimeError(f"Unsafe source path: {relative}")
    if source.stat().st_size >= 100 * 1024 * 1024:
        raise RuntimeError(f"File exceeds ordinary GitHub source-file limit: {relative}")
    if destination in files:
        raise RuntimeError(f"Duplicate destination: {destination}")
    files[destination] = source.read_bytes()


for folder in ["src", "native", "packaging", "script", "test", "cloud"]:
    for source in sorted((root / folder).rglob("*")):
        add(root, source.relative_to(root), "managed-harness-platform/" + source.relative_to(root).as_posix())
for name in ["package.json", "bun.lock", "tsconfig.json", "LICENSE", ".gitignore"]:
    add(root, Path(name), "managed-harness-platform/" + name)

# Upstream tracked source plus only reviewed managed additions. Never sweep all untracked files.
tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=fork).decode("utf-8").split("\0")
additions = [
    "packages/core/src/config/enterprise.ts", "packages/core/src/managed-central.ts",
    "packages/core/src/managed-macos.ts", "packages/core/src/managed-transport.ts",
    "packages/core/test/config/enterprise.test.ts", "packages/core/test/managed-local-permission.test.ts",
    "packages/core/test/managed-macos.test.ts", "packages/core/test/managed-origin.test.ts",
    "packages/core/test/managed-transport.test.ts",
    "packages/server/src/managed-routes.ts", "packages/server/test/managed-routes.test.ts",
]
for name in sorted(set(tracked + additions)):
    if not name or name.startswith(".github/workflows/"):
        continue
    add(fork, Path(name), "managed-opencode-fork/" + name)

files[".github/workflows/macos-validation.yml"] = (root / "cloud/macos-validation.yml").read_bytes()
files["README.md"] = (root / "cloud/README.md").read_bytes()
if (root / "cloud/RESULTS.md").exists():
    files["RESULTS.md"] = (root / "cloud/RESULTS.md").read_bytes()
files["UPSTREAM-REVISION.txt"] = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=fork)
files[".gitignore"] = b"macos-evidence/\n**/node_modules/\n**/dist-macos-validation/\n**/test-results/\n"
manifest = {name: hashlib.sha256(data).hexdigest() for name, data in sorted(files.items())}
files["SOURCE-MANIFEST.json"] = (json.dumps(manifest, indent=2) + "\n").encode("utf-8")

out = root / "cloud-output"
out.mkdir(exist_ok=True)
if out.is_symlink() or out.resolve().parent != root.resolve():
    raise RuntimeError("Unsafe cloud output directory")
stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
archive = out / ("managed-macos-source-" + stamp + ".zip")
with zipfile.ZipFile(archive, "x", zipfile.ZIP_DEFLATED, compresslevel=5) as bundle:
    for name, data in sorted(files.items()):
        bundle.writestr(name, data)
with zipfile.ZipFile(archive) as bundle:
    if bundle.testzip() is not None:
        raise RuntimeError("Archive CRC verification failed")
    for name, digest in manifest.items():
        if hashlib.sha256(bundle.read(name)).hexdigest() != digest:
            raise RuntimeError("Archive manifest mismatch: " + name)
report = {"archive":str(archive), "files":len(files), "bytes":archive.stat().st_size,
          "sha256":hashlib.file_digest(archive.open("rb"), "sha256").hexdigest(),
          "published":False, "macosExecuted":False}
archive.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2))
