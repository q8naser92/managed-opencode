# Managed OpenCode

A Windows management server and managed endpoint clients for centrally approved
models, AI capabilities and connectors. Code and commands execute on the user's
endpoint; identity, policy and encrypted personal gateway keys are managed by the
server.

**Development status:** Windows 0.1.4 is an unsigned pilot candidate. Mac engine
validation passed on the recorded macOS 15, 26 and 27 hosts. The Mac GUI and PKG
are unfinished, macOS 14 remains untested, and a final installer release is not
yet available.

Requested deployment targets: Windows Server 2019/2022, Windows 11 25H2 clients,
and macOS 14/15/26/27 clients on the architectures in [SUPPORT.md](SUPPORT.md).
The server remains on Windows.

## Installation and administration

- [Product overview](managed-harness-platform/README.md)
- [Installation and deployment](managed-harness-platform/docs/INSTALLATION.md)
- [Administration and user setup](managed-harness-platform/docs/ADMINISTRATION.md)
- [Operations and recovery](managed-harness-platform/docs/OPERATIONS.md)
- [Security boundaries](managed-harness-platform/docs/SECURITY.md)
- [Build instructions](managed-harness-platform/docs/BUILDING.md)
- [Deployment templates](managed-harness-platform/deployment)

## Validation and delivery

- [Final release requirements](managed-harness-platform/cloud/RELEASING.md)
- [Windows pilot verification ledger](managed-harness-platform/VERIFICATION.md)
- [Hosted Mac engine results](RESULTS.md)
- [Hosted validation workflow](managed-harness-platform/cloud/README.md)

Final delivery will be a versioned GitHub Release containing tested installers,
matching source, documentation, checksums and independent review evidence. The
exact final installers must pass the agreed acceptance matrix before publication.
Source commits and CI engine artifacts do not establish full GUI/installer acceptance.

## Source layout and licensing

`managed-harness-platform` contains the service, native client/setup, packaging,
tests and guides. `managed-opencode-fork` contains the managed engine and upstream
source. `SOURCE-MANIFEST.json` records source snapshot hashes, and
`UPSTREAM-REVISION.txt` identifies the upstream base.

The management platform is MIT licensed; the fork and dependencies retain their
own licenses. See [third-party notices](managed-harness-platform/THIRD-PARTY-NOTICES.md).
Private lab configuration, credentials, databases and generated binaries are
excluded. The repository remains private.
