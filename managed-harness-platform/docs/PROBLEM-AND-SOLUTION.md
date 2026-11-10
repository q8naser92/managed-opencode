# The problem and the approach

## The gap around a coding assistant

The starting requirement was to let employees use OpenCode with an existing LiteLLM gateway while giving administrators control over models, connectors and AI execution. Employees would remain standard operating-system users with normal CMD/PowerShell access. Code editing and command execution would stay on their own computers.

LiteLLM already handled AI routing, personal API keys and prompt/response logging. Duplicating those responsibilities would add complexity without addressing the main gap: an endpoint assistant can read or edit files, launch commands, load plugins and call tools. The AI gateway does not see or authorize every local action.

## Why a launcher and configuration were insufficient

A wrapper can start an application with an intended configuration, but it does not turn every configuration option into an administrator-enforced rule. An ordinary OpenCode installation supports configuration from several sources and alternate entry points. A user or project can influence the environment in which an unrestricted engine runs. Protecting only the wrapper, or hiding a provider/connector button, leaves that authority elsewhere.

That is the configuration bypass concern this project addresses. It is not a claim that every upstream OpenCode installation has a security vulnerability: upstream customization is a product feature. An organization needs a narrower application boundary than a general-purpose personal coding assistant provides.

The solution has two parts:

1. **A managed engine and client.** The fork reads its server enrollment from administrator-owned machine configuration. User/project settings, arbitrary plugins and alternate providers cannot grant managed authority. The GUI handles identity, workspace selection and approval prompts; the engine performs local work under the user's account.
2. **A management server.** The server owns the approved model and connector catalog, action policy, accounts, encrypted credentials and audit records. It checks those decisions at its routes, rather than trusting that a client merely hid a button. Action grants bind the identity, engine, operation, policy revision and expiry; they are consumed once.

The management server becomes a trusted part of the data path. It forwards requests to LiteLLM and executes approved connector calls, so its administrators, host, TLS keys and vault need protection. Prompt content passes through this service even though its security audit is not designed to duplicate content logging.

## Responsibilities

| Layer | Responsibility |
| --- | --- |
| LiteLLM | Existing AI gateway functions, model routing and configured prompt/response logging. |
| Management server | Shared model/action/connector policy, identity, encrypted personal keys, grants and security audit. |
| Managed endpoint application | Local workspace and execution, central authorization, user approvals, policy polling and stopping managed work on detected loss of access. |
| Organization | Standard-user accounts, application allowlisting, trusted certificates, endpoint/server protection and deployment acceptance. |

Only server-approved models are allowed. A cloud model requires both its individual approval and the global cloud-model setting. Administrators can add HTTPS MCP or API connectors and review individual tools; a user asking the AI to "install this connector" cannot add it to that catalog. Personal and service credentials are selected per connector; OAuth uses a personal authorization flow.

An administrator can deny AI CMD or PowerShell centrally without removing the employee's terminal. Changing policy causes managed work to stop after the client detects the revision. This has a measurable timeout/polling window; it is not instantaneous remote control or a guarantee that an already-completed action can be undone.

## Identity and personal setup

The server supports SAML federation and administrator-created email accounts using SMTP-delivered one-time codes. Local accounts have no password and no open self-registration. Each person supplies a personal LiteLLM key, encrypted on the Windows server and bound to its owner and gateway destination. The endpoint engine uses a management token instead of receiving that key.

The central identity loads allowed capabilities. It does not migrate source files or conversation history onto the server. Those remain in the endpoint profile. Model requests may include workspace content when the user asks the assistant to work with it.

## Removing the HTTP relay workaround

The reported earlier setup could not reliably establish the direct OpenCode/Bun HTTPS connection to a LiteLLM models endpoint. Troubleshooting tried additional CA files and system-CA settings, then used a localhost HTTP relay that handled the upstream HTTPS connection with explicit CA configuration.

The original console error and presented certificate chain were not preserved. The endpoint was reported to use Let's Encrypt, with a proxy previously configured. This is insufficient evidence to conclude that the cause was an internal CA, an expired certificate, interception or an incomplete chain. The historical production path has not been reproduced by the current lab tests.

The managed architecture removes that local HTTP relay. The endpoint connects to its management server over verified HTTPS, and the Windows service connects directly to LiteLLM over verified HTTPS. An administrator can supply an additional trusted CA bundle where needed. Certificate validation stays enabled; hostname, dates, chain and trusted roots must agree. Managed transport rejects unapproved destinations and does not inherit arbitrary proxy/TLS settings from the user environment.

Synthetic HTTPS tests exercise custom CA trust and rejection paths, including invalid certificates, altered CA bundles, TLS override attempts and redirects. They provide evidence for the tested implementation, not proof that a particular organization's real gateway certificate or network route is correctly configured. Use the troubleshooting steps in the [configuration guide](CONFIGURATION.md#10-troubleshoot-without-weakening-tls) on the deployment network.

## Logging without another prompt archive

LiteLLM remains the configured prompt/response logging system. The harness records the different evidence administrators need: sign-ins, account changes, policy and connector changes, credential enrollment and action/security outcomes. Endpoint-reported events are labeled as reports, not trusted proof that a command executed exactly as reported.

Local OpenCode storage still contains application history and can include prompts, model output and tool results. Omitting central content logging does not remove that local history. The current server audit database is not an immutable external ledger, and retention/export needs an organizational decision.

## What this cannot promise

Installation permissions can prevent a standard user from editing protected files. They cannot make software tamperproof against an administrator, SYSTEM, a hypervisor administrator or a compromised operating system. Hash allowlisting helps restrict executable selection; its actual enforcement must be tested with the organization's product.

An allowed AI shell can do what the user can do. Read/Edit policy does not confine an unrestricted shell to a workspace, and the harness does not govern commands the user runs separately. Stronger endpoint-wide confinement would require additional OS or network controls beyond this project's agreed application scope.

An online-only design also depends on the availability of the central server. There is no approved offline mode. High availability, cross-machine vault recovery, external immutable audit and a complete cross-platform release remain separate work; see [operations](OPERATIONS.md) and [release requirements](../cloud/RELEASING.md).

## Evidence and remaining work

Windows 0.1.4 has bounded lab installation, service, policy, identity, TLS and GUI evidence. Hosted tests cover the managed engine on the recorded macOS 15/26/27 hosts. The Mac GUI and PKG are unfinished and macOS 14 has not been executed. Some Windows GUI, identity and deployment acceptance cases also remain open.

The independent read-only reviews issued scoped decisions for the evidence they inspected. They did not issue an overall product-release pass. The [Windows ledger](../VERIFICATION.md), [Mac results](../cloud/RESULTS.md) and [release gate](../cloud/RELEASING.md) separate implementation, tested scope and unfinished acceptance. This repository documents the approach and current implementation; it does not claim all requested production requirements have been completed.
