# Administration

Open the management server's HTTPS address in a browser. The web console is the central GUI; the endpoint GUI is for daily coding, approvals and personal credentials. Policy is shared across users in this release.

## Models and AI actions

Set the LiteLLM HTTPS base URL and approve its destination. Add model IDs exactly as LiteLLM exposes them, choose readable names and enable the ones users may use. A model marked Cloud needs both its individual enabled setting and the global cloud-model switch. A user-supplied model ID outside this catalog is rejected by the gateway route.

Set Read, Edit, CMD and PowerShell independently:

| Mode | Managed AI behavior |
| --- | --- |
| Deny | The action cannot execute. |
| Ask | The desktop shows the proposed action; the signed-in user approves or rejects that specific request. |
| Allow | The server grants the action without prompting, subject to current policy and limits. |

Apply changes in the console. Clients poll current policy, and active work is cancelled when policy or connector generation changes. Network failure also stops managed work after detection. This is bounded by request timeouts and polling; it is not a zero-millisecond guarantee. Separate duration and session-step limits prevent indefinite managed runs.

These controls apply to AI activity through this installation. They do not disable the user's own terminal. If an approved AI shell can run arbitrary commands, it has the ordinary user's filesystem and network reach. Do not use Read/Edit restrictions as a sandbox for an otherwise unrestricted shell.

## Users and credentials

SAML users sign in through their identity provider. For local users, first add their email in the console; the user then requests and enters an emailed one-time code. There is no local password or open self-registration. Disabling a user invalidates access, including linked engine activity.

Each user enters their own LiteLLM key in **Personal API key** once. The server validates and encrypts it, bound to that user and gateway destination. The endpoint engine receives a short-lived management token instead of the LiteLLM key. Changing a gateway destination requires key enrollment for that destination; the old key is not forwarded to an unrelated host.

Users' model and connector access follows their central identity. Workspaces and coding transcripts remain on the endpoint; this release does not roam files or conversation history between computers. Separate Windows accounts and separate central identities use separate endpoint profiles.

## Custom connectors

Add an HTTPS MCP connector or a custom API connector in the console. Select authentication: no credential, shared service credential supplied by an administrator, or personal credential supplied by each user. OAuth connectors use a personal account; configure authorization/token URLs, client ID, scopes and the required client-auth method. An OAuth client secret, when needed, is a server-side administrative credential.

For MCP, discover tools and review them before enabling. For APIs, add actions with methods, paths and argument schemas, or import an OpenAPI document and review the resulting actions. Discovery/import does not approve a tool automatically. Enable specific tools, choose Allow/Ask/Deny, and apply supported resource restrictions. Re-discovering changed tool definitions requires renewed review.

The server makes connector calls and checks the current connector version, schema, destination, user credential and approval. Arbitrary local `stdio` MCP commands and user-installed plugins are not supported. If the user asks the AI to install a connector, that request cannot modify the approved catalog. An administrator must configure it centrally.

**Connector accounts** opens the browser console for personal API keys or OAuth sign-in. The browser uses its own authenticated session; desktop sign-in does not expose its token in a URL.

## Audit and logging

Use the audit view for login, account changes, policy revisions, approved destinations, connector changes, credential changes and action outcomes. The current view shows the most recent 250 records; the underlying server database retains more. A production retention/export policy still needs deployment planning.

LiteLLM remains the prompt/response logging system. Do not duplicate that content in central harness audit logs. The harness still needs security metadata to answer who changed policy, which action was denied and whether an endpoint reported cancellation. Client-reported events are labeled as such and are not treated as trusted proof of endpoint execution.

OpenCode's local conversation/profile storage exists for application operation and may contain prompts, model output and tool results. Turning off optional client security events is not a transcript-erasure feature. Protect endpoint user profiles and apply your organization's retention rules.
