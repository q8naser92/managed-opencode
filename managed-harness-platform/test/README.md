# Test fixtures and scope

`bun test test` runs the management platform's automated tests. It is not the
installed Windows GUI acceptance suite. Synthetic certificates and keys under
`fixtures/` exist only for isolated transport tests and must never be deployed.

`NativeClientGuiTests.cs` drives an already-installed Windows client under the
standard lab user in an interactive desktop session. It expects a private
`C:\HarnessLab\clients\A\central-fixture.json` containing `email`, `key`,
`mailOrigin` and `mailToken` for the configured test user and test mailbox.
`mailOrigin` is the lab mailbox's verified HTTPS origin, including its port;
the helper reads fresh codes from its `/?email=...` endpoint with the bearer
`mailToken`. Provision that test service and trust separately. Do not substitute
a real user's mailbox credentials or commit this private fixture.

The helper also expects the corresponding installed client, synthetic gateway
scenario and lab directories. Its workspace selection is injected by the test,
so a passing result does not establish folder-picker interaction. See the
[verification ledger](../VERIFICATION.md) for the precise tested scope and limits.

The public-source cleanup replaced historical lab addresses in origin-parser
tests with the documentation address `203.0.113.10`, and made the GUI mailbox
origin a fixture input. No product behavior changed. Existing full GUI results
refer to their historical candidate; compiling this helper does not constitute
another installed-GUI test run.
