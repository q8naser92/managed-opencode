# Managed OpenCode 0.1.4

Release date: 10 November 2026. Status: **unsigned organizational pilot candidate**. This is the deliverable build from the lab, not a claim of full production readiness or overall-product acceptance.

## Included

- One graphical Server/Client setup EXE and separate per-machine MSIs.
- Windows management service, browser administration console and native Windows client.
- Centrally approved models, cloud-model switch, LiteLLM destination and per-user encrypted keys.
- Shared AI Read/Edit/CMD/PowerShell policy, approvals, session limits and online-only access.
- Centrally configured HTTPS MCP and API connectors, per-action policy, service/personal credentials and personal OAuth.
- SAML and administrator-created local email OTP accounts, TLS SMTP configuration and metadata audit.
- Configurable management port, direct verified HTTPS, protected machine configuration and administrator-only installation changes.

## Validation of this build

Version 0.1.4 passed a clean Windows Server 2019 installation (13 checks), real browser/SMTP/gateway operation from AKSB (10), and later sign-in/key reuse after a recorded service-process restart (9). The final Windows 11 client passed upgrade, descendant ACL rejection and retained-source repair (30). Windows Server 2022 passed the equivalent upgrade/repair checks (34). The native desktop workflow passed 17 checks plus three cleanup assertions, and authentication races passed 14. A separate read-only reviewer accepted these scopes. See VERIFICATION.md for the exact boundaries. Platform tests passed 45 tests / 326 assertions. The independent reviewer separately judges each recorded scope; no overall-product PASS is claimed.

Version 0.1.4 rejects pre-existing installer directories and files with an untrusted owner or writable permissions, including generic access rights. New protected directories are created with their final permissions atomically. The validator recognizes the exact Windows TrustedInstaller identity and inherit-only CREATOR OWNER entries required by normal Program Files permissions, while continuing to reject ordinary-user writers. This prevents setup from adopting a user-controlled staging/cache tree; it does not claim to defeat a local administrator.

Version 0.1.2 serializes sign-in attempts, discards late responses after sign-out and stops the previous account's engine before adopting another identity. It also retains a protected MSI source cache for repair and packages the server and engine using the baseline x64 Bun target.

## Before broad deployment

Complete the native SAML browser/loopback flow with the organization's identity provider, installer GUI/folder-picker acceptance, remaining desktop offline/timeout cases, backup/restore drill, application-control acceptance, capacity/load tests, and the organization's real LiteLLM network/certificate test. The lab uses synthetic model, SMTP and connector services. No claim is made that every commercial connector or model API shape works.

The binaries are unsigned. Public certificate trust and optional private-CA handling are implemented, but this lab could not reach `https://gateway.example.org/v1`. Use the supplied hashes for a controlled pilot and follow your signing/application-control process before a broader rollout. Proxy negotiation, high availability, immutable audit export, automatic updates and cross-machine vault migration are not implemented.

The source and available dependency notices are included. An independent clean source rebuild and complete license/software-composition audit remain outstanding. Do not treat the dependency inventory as a certified runtime SBOM.

Use README.md to choose the installer, docs/INSTALLATION.md for deployment, docs/ADMINISTRATION.md for the console, and docs/OPERATIONS.md for maintenance and recovery limits.
