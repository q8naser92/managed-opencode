# Final release delivery

The user requested a final source push and downloadable, tested installers in
this repository's GitHub Releases. This is the agreed delivery requirement.
The repository remains private unless the user separately requests publication.

**Current status: final release blocked.** Windows 0.1.4 is an unsigned pilot
candidate. The Mac artifacts validate the engine only; the Mac GUI and PKG are
unfinished, and macOS 14 is untested. No final release has been published.

## Required release coverage

| Component | Required installed test environments |
| --- | --- |
| Windows management server | Windows Server 2019 and 2022 |
| Windows endpoint client | Windows 11 25H2 (AKSB lab client) |
| Mac endpoint client | macOS 14, 15 and 26 on Apple Silicon and Intel; macOS 27 on Apple Silicon |

Record the actual OS patch/build and architecture for each result. Missing hosts,
skipped acceptance tests and engine-only passes do not establish full-client
compatibility. See [SUPPORT.md](SUPPORT.md) for the Mac test-host gap and
[the verification ledger](../VERIFICATION.md) for the Windows pilot's limits.

## Open acceptance work

- Implement and test the Mac GUI and administrator-owned PKG installation,
  enrollment, protected configuration and multi-user behavior.
- Test the exact installed clients against the Windows management server:
  complete federated and email OTP login, personal keys, workspace selection,
  model/tool/connector operations, approvals, policy changes, connection loss,
  sign-out and process cleanup. Close the remaining Windows GUI/installer cases.
- Exercise clean install, upgrade, repair where provided, and uninstall using
  the final installers. Test configurable addresses/ports and verified HTTPS.
- Obtain real macOS 14 test hosts and complete the requested matrix.
- Close the applicable operational, dependency and deployment acceptance work
  in the verification ledger. Distinguish actual organization integrations from
  synthetic fixture tests.
- Obtain a separate read-only agent's explicit release-level PASS for the final
  evidence and distributable hashes. Earlier bounded reviews are not that decision.

## Files attached to the final release

- Windows graphical setup EXE, server MSI and client MSI.
- Mac client PKGs for the supported architectures, or a tested universal PKG.
- Source archive matching the release tag, build instructions, dependency notices
  and required dependency source materials.
- Installation, configuration, administration, upgrade and removal guides.
- `SHA256SUMS.txt` and an artifact manifest mapping each installer to its source
  commit, build tools, tested OS matrix, evidence and independent review decision.
- Sanitized validation archive and release notes describing the tested scope,
  signing/notarization status and any remaining limitations.

Exclude private keys, tokens, passwords, user databases, production settings and
private lab files. Upload only reviewed deployment templates and sanitized evidence.

## Publication sequence

1. Finish the code and documentation, choose a new release version and push the
   reviewed source. Do not reuse 0.1.4 for changed source or overwrite its artifacts.
2. Freeze the candidate commit. Build its installers and apply any signing or
   notarization before final validation. Record hashes and build provenance.
3. Test those exact files across the acceptance matrix and preserve results.
   Fixes, rebuilds or post-test signing require validation of the changed files.
4. Obtain the independent read-only reviewer's explicit release decision, with
   evidence references and final hashes. Required unfinished work blocks release.
5. Create a version tag at the candidate commit and a draft GitHub Release in the
   existing private repository. Attach installers, matching source, guides,
   checksums and sanitized evidence. Treat the version tag as immutable.
6. Download the uploaded assets and verify their SHA256 values against the reviewed
   candidates. Check tag/commit identity, asset completeness, notes and repository
   visibility, then publish the completed release.
7. Give the user the release URL and direct Windows and Mac installer links.

The user's instruction authorizes the final source push and release upload once
these requirements pass; another confirmation for those actions is unnecessary.
It does not authorize a new paid Mac rental, public repository conversion or
disclosure of private organization data.
