# Managed OpenCode — Windows 0.1.4 pilot source

This tag preserves the Windows source corresponding to the archived 0.1.4 pilot
package. It is a post-build source snapshot created for public release, not the
original build commit or an independent clean-build attestation. The current
development branch contains later Mac engine work and documentation.

**Unsigned Windows pilot prerelease. No Mac GUI/PKG or production acceptance.**

- [Download the Windows pilot](https://github.com/q8naser92/managed-opencode/releases/tag/v0.1.4-pilot.1)
- [Windows overview](managed-harness-platform/README.md)
- [Installation](managed-harness-platform/docs/INSTALLATION.md)
- [Administration](managed-harness-platform/docs/ADMINISTRATION.md)
- [Operations and recovery](managed-harness-platform/docs/OPERATIONS.md)
- [Security boundary](managed-harness-platform/docs/SECURITY.md)
- [Build instructions](managed-harness-platform/docs/BUILDING.md)
- [Recorded test scopes and remaining work](managed-harness-platform/VERIFICATION.md)
- [Publication changes](PUBLICATION-NOTES.md)

The release's complete companion source ZIP includes the pinned Bun and WiX source
archives. This Git tree omits only those two dependency ZIP files and the
archive-specific manifest; download the companion source asset for them. All
Windows product source, scripts, tests, lockfiles and historical guides in this
tree match the sanitized companion source archive. `SOURCE-MANIFEST.json` records
this Git snapshot; `ARCHIVED-SOURCE.json` identifies its attached source archive.

The original installers were not rebuilt or modified for publication. Only a
documentation URL and adjacent wording were generalized in the archived source.
The management platform is [MIT licensed](LICENSE); the fork and dependencies
retain their own [licenses and notices](managed-harness-platform/THIRD-PARTY-NOTICES.md).
