# Hosted Mac engine validation — 10 November 2026

The private repository is `q8naser92/managed-opencode-macos-validation`.
The user authorized its creation, the source upload and the test workflow.
The management server remains a Windows product. No Mac server is being shipped.

## Expanded version matrix

The requested client targets are macOS **14, 15, 26 and 27**; see
[SUPPORT.md](SUPPORT.md). The successful
[run 42770628894](https://github.com/q8naser92/managed-opencode-macos-validation/actions/runs/42770628894)
tested commit `405513214e792271ffa104d4e861b0f946930dbd` on the following real hosts:

| Requested major | Actual tested version/build | Architecture | Engine result |
| --- | --- | --- | --- |
| 14 | No test host available | Apple Silicon and Intel | **Not tested; still required** |
| 15 | 15.8.2 / 24H232 | Apple Silicon | Passed |
| 15 | 15.7.9 / 24G830 | Intel | Passed |
| 26 | 26.7.2 / 25G332 | Apple Silicon | Passed |
| 26 | 26.6.1 / 25G76 | Intel | Passed |
| 27 | 27.0.1 / 26A434 | Apple Silicon | Passed |

The Windows Server 2022 job again passed typechecking and 47 tests / 346
assertions. Each of the five Mac jobs passed core typechecking, 17 core tests /
78 assertions, and one route test / 56 assertions. Only the Windows-specific test
was skipped on each Mac. Each job built and started its native engine executable.

The script rejects a host whose actual OS major or runtime architecture differs
from the requested matrix entry. Each artifact includes `host.json` with the
actual OS version/build, architecture, tested commit, Bun and image versions, plus
the log, executable, SHA256 manifest and Mach-O load-command metadata. Each
architecture produced the same engine hash across all tested major versions,
matching the two hashes below. The engine's recorded minimum OS is 13.0; that
metadata does **not** prove macOS 14 execution or compatibility of the future GUI,
installer and native dependencies.

Full logs, run metadata and artifact metadata are retained locally in
`test-results/macos-cloud-run-42770628894*`; downloaded artifacts are in
`cloud-output/validation-42770628894/<major>-<arch>/`.

The independent read-only reviewer judged this expanded run a **scoped PASS for
engine validation across all five tested combinations**. It independently checked
the five remote artifact ZIP digests, OS/build/architecture/commit records, native
headers, executable hashes and logs; all 30 saved evidence files matched their
remote counterparts. This decision excludes macOS 14 and the unfinished full
client/installer acceptance checks listed below.

## Earlier macOS 15 validation

The independently reviewed successful [run 42768960214](https://github.com/q8naser92/managed-opencode-macos-validation/actions/runs/42768960214)
tested commit `0534c2a3f18bc1703744802304a3e63eb627f5a8`.
An earlier successful [run 42768144682](https://github.com/q8naser92/managed-opencode-macos-validation/actions/runs/42768144682)
tested the engine preparation before the extra HTTPS cases were added.

| Environment | Result |
| --- | --- |
| Windows Server 2022 | Typecheck and 47 server tests / 346 assertions passed. |
| macOS 15, Apple Silicon | Core typecheck, 17 core tests / 78 assertions and one route test / 56 assertions passed. |
| macOS 15, Intel | Same passing typecheck and test counts. |

Each Mac skipped only the Windows-specific test. Both actual Darwin tests ran,
including real zsh/bash execution without user startup files or inherited
management credentials. The seven HTTPS tests used the production managed
transport through Bun, synthetic certificates and a test-only enrollment-directory
substitution. They covered trust failure, explicit CA trust, altered CA bundles,
caller TLS overrides, inherited TLS/proxy settings, redirects and unapproved origins.

Both native Mach-O executables built and ran `--version`, reporting
`2.2.6-managed.macos-preview`. Their SHA256 hashes were unchanged between the runs:

| Architecture | Engine SHA256 |
| --- | --- |
| arm64 | `0391ddc2c5cbe07adf6f11707501767b0787d21a37957ef13572690b5ed72424` |
| x64 | `1911a6967107adbe290ad9ed62d270eaf35079f22c202709712a789060628af2` |

The separate read-only reviewer independently checked repository privacy, the
tested commit and run, remote logs, GitHub artifact ZIP digests, engine manifests,
CPU types and compiled startup. Its judgment was a **scoped PASS for hosted macOS
engine validation**, including TLS tests. The initial preparation review also
caught and closed a source-bundle filtering error before upload.

This is **not a Mac client release**. The Mac desktop GUI and PKG installer have
not been implemented. Protected installed enrollment, GUI authentication against
the Windows server, compiled-engine HTTPS integration, process supervision,
signing and notarization have not been validated. No actual bank gateway was
contacted by these synthetic tests. The existing Windows 0.1.4 release archives
remain unchanged.

Workflow artifacts are retained by GitHub for seven days. Local copies of both
runs' engine artifacts, manifests and logs are saved under
`cloud-output/validation-<run-id>/`; full run logs and metadata are under
`test-results/macos-cloud-run-<run-id>.*`. Those output folders are excluded from
source publication. The source repository and these results persist independently
of the artifact retention period.
