# Hosted Mac engine validation — 10 November 2026

The private repository is `q8naser92/managed-opencode-macos-validation`.
The user authorized its creation, the source upload and the test workflow.
The management server remains a Windows product. No Mac server is being shipped.

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
