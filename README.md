# Hosted macOS validation preparation

This source snapshot prepares the managed OpenCode engine for macOS. It is not a
Mac desktop release or an organization-ready Mac installer. The management server
remains a Windows product. The previously delivered Windows 0.1.4 installers are
unchanged.

The source includes a separate central `shell` permission for macOS zsh/bash,
defaulting to Deny when reading older Windows policies. CMD and Windows PowerShell
remain independent. The engine selects `/bin/zsh`, accepts only `/bin/zsh` or
`/bin/bash`, avoids user shell startup files, and reads enrollment only from
`/Library/Application Support/ManagedOpenCodeCentral/Client`. Administrative
ownership and permissions for this directory must be enforced by the future Mac
installer and tested on real macOS before delivery.

## Running the prepared workflow

1. Review this source snapshot and choose a private GitHub repository.
2. Upload the extracted source tree after approval. Do not upload lab directories,
   deployed configuration, databases, API keys, SSH keys or release evidence.
3. In GitHub Actions, manually start **Managed macOS engine validation (not a client release)**.
4. The first job tests server code on Windows Server 2022. Then two separate jobs
   build and execute engine tests on real macOS 15, Apple Silicon and Intel.
5. Download both `macos-engine-validation-*` artifacts and have an independent
   read-only reviewer judge the logs, tests and artifact hashes. A green workflow
   only validates the engine scope below.

The workflow does not run automatically on pushes or pull requests. It has
read-only repository permission, pinned action revisions, no repository secrets,
15-minute Windows and 30-minute Mac job timeouts, and seven-day artifact retention.
Private-repository runs consume the account's included Actions allowance and may
incur charges under its billing settings. No workflow has been dispatched by
preparing this bundle.

## What these tests establish

Server policy schema compatibility, default denial, explicit approval, grant
ownership, one-use consumption, central revocation and security event acceptance;
engine configuration-source restrictions, strict HTTPS origin parsing, shell
selection, child environment filtering, actual zsh/bash startup-file behavior;
real synthetic HTTPS tests for custom-CA trust, invalid certificates, modified CA
bundles, caller TLS overrides, inherited proxy/TLS environment and redirects;
successful native architecture build and basic executable startup.

The source snapshot includes upstream test fixtures and synthetic test certificates.
These are development fixtures, not organization credentials. Dependency downloads
come from the package registries described by the lockfiles and the upstream build.

## What remains before a Mac release

- Native Mac desktop application: sign-in, email OTP, SAML/PKCE, API-key enrollment,
  workspace selection, chat, approvals, connector account links and logout.
- Administrator-owned PKG installation and server-address enrollment; tests with
  non-admin users, multiple users, hostile existing paths and upgrade/repair.
- Safe engine process supervision, including crash, logout, disconnect and policy
  changes; explicit treatment of child processes that detach from their parent.
- Verified HTTPS and custom-CA behavior in both the GUI and compiled engine.
- End-to-end tests against the Windows server over a private test connection.
  A hosted runner cannot reach an on-premises 192.168.x.x address automatically.
- Interactive installer/GUI tests, including login and approvals; automation alone
  does not establish that native dialogs and OS permission prompts work.
- Developer ID signing and notarization for normal organizational distribution,
  using the publisher's Apple Developer account; final independent review.

Do not expose the management server publicly just to run these tests. A rented
remote Mac with a private test connection is an option for the interactive and
Windows-server integration tests. Preparing the bundle does not rent a Mac,
publish source, dispatch an Actions run or enroll an Apple account. Actual runs
require a separate authorized execution step; see RESULTS.md when present.

References: [GitHub hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
[Apple Developer ID](https://developer.apple.com/developer-id/),
[MacStadium remote Macs](https://macstadium.com/pricing).
