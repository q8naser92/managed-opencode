# Configure Managed OpenCode

This walkthrough covers the implemented Windows server/client configuration. The preserved Windows 0.1.4 installer is an unsigned pilot with bounded acceptance; current development source also contains Mac engine work. There is no final cross-platform installer release. The Mac GUI and PKG are unfinished, so the Windows client steps below cannot be used as a Mac installation procedure.

Use the [build guide](BUILDING.md) to produce a candidate from source, or use an explicitly reviewed pilot package you already have. Future final packages belong in [GitHub Releases](https://github.com/r0kud0mukur0/managed-opencode/releases) after the [release gate](../cloud/RELEASING.md). Do not substitute upstream OpenCode installers: they do not include this management boundary.

The preserved Windows 0.1.4 binaries are available in the [v0.1.4-pilot.1 prerelease](https://github.com/r0kud0mukur0/managed-opencode/releases/tag/v0.1.4-pilot.1), together with documentation, source, checksums and scoped review evidence. Start with its complete deployment ZIP and read its known limitations before installing.

## 1. Plan addresses, trust and prerequisites

Choose these values before installing. All examples below are fictional.

| Value | Example | Purpose |
| --- | --- | --- |
| Management server public origin | `https://managed.example.org:7443` | Address clients and browsers use; HTTPS origin only, without an application path. |
| Server listener port | `7443` | An available port on the Windows server. This is configurable. |
| Gateway API base | `https://gateway.example.org/v1` | LiteLLM's HTTPS API base, including its API path. |
| Server TLS certificate | `C:\Deployment\server-fullchain.pem` | Full PEM chain whose SAN covers the management hostname. |
| Server TLS private key | `C:\Deployment\server-key.pem` | Matching unencrypted PEM key, staged with administrator-only protection. |
| Identity | Email OTP, SAML, or both | At least one usable administrator sign-in path is required. |
| SMTP, for email OTP | `smtp.example.org:587` with STARTTLS | Verified TLS delivery to approved users. Implicit TLS is also supported. |

Use a dedicated x64 Windows Server 2019/2022 host for the target deployment, with correct time, DNS and certificate trust. Windows native components require .NET Framework 4.7.2 or later. Server Core uses the silent installer and remote browser administration; the graphical setup requires an interactive desktop.

Clients initiate HTTPS connections to the management server. The server initiates connections to LiteLLM and approved HTTPS services, plus TLS SMTP where configured. No product connection needs to be initiated from the server into the endpoint. Local engine/authentication callbacks bind loopback. See [installation networking](INSTALLATION.md) for the direct-connect requirement: inherited proxy settings are deliberately not used, and proxy negotiation is not implemented.

If using an internal CA, deploy its trusted root through the organization's certificate-management process for browsers and native Windows clients. Additional engine/server CA bundles are configured separately. A normal public certificate should not require inventing a corporate CA bundle. Never disable certificate verification to get setup to finish.

## 2. Install the management server

For an interactive installation, run `ManagedOpenCode-Setup.exe` elevated, select **Server**, then enter the public origin, listener port, certificate/key paths and gateway URL. Configure the initial administrator through email OTP or SAML. The same EXE offers the Client role for endpoints.

For mass deployment, use `ManagedOpenCode-Server.msi` and a protected configuration file. Copy [server.example.json](../deployment/server.example.json) outside the repository into an administrator/SYSTEM-only staging directory, then replace every example with your real values. Do not put populated deployment files or private keys into Git.

An email-bootstrap example is:

```json
{
  "origin": "https://managed.example.org:7443",
  "port": 7443,
  "gatewayUrl": "https://gateway.example.org/v1",
  "tlsCert": "C:\\Deployment\\server-fullchain.pem",
  "tlsKey": "C:\\Deployment\\server-key.pem",
  "bootstrap": {
    "adminEmail": "harness-admin@example.org",
    "smtp": {
      "enabled": true,
      "host": "smtp.example.org",
      "port": 587,
      "mode": "starttls",
      "serverName": "smtp.example.org",
      "username": "harness-mail",
      "from": "harness@example.org"
    },
    "smtpPassword": "REPLACE_IN_THE_PROTECTED_DEPLOYMENT_COPY"
  }
}
```

Use `mode: "tls"` and the appropriate port for implicit TLS. An approved relay without SMTP authentication uses an empty username and no password. The SMTP password here is a deployment secret, not an end-user password.

For server connections that require private CA trust, use the Server setup field **Additional trusted CA bundle (optional)**. In JSON, add the top-level property `"caFile": "C:\\Deployment\\organization-root.pem"` to `server.json`. Supply an administrator-verified PEM CA bundle. The service uses this bundle for its listener verification and upstream/SMTP trust; it does not rely on the Windows certificate store. This is separate from the browser/native-client trust deployment and the client's own optional `caFile`. Omit the extra bundle when normal public trust is sufficient.

From an elevated command prompt in the package directory:

```bat
msiexec.exe /i ManagedOpenCode-Server.msi /qn /norestart CONFIGFILE="C:\Deployment\server.json" /l*v "C:\Deployment\server-install.log"
```

Keep the log in the same protected staging area. Success is exit code 0; 3010 requests a reboot. Investigate failures instead of continuing with an incomplete installation. The supplied [deployment wrapper](../deployment/Install-ManagedOpenCode.ps1) is an alternative for deployment tools that need explicit exit-code handling.

Verify the service and HTTPS endpoint:

```powershell
Get-Service -Name ManagedOpenCodeServer
Invoke-RestMethod -Uri 'https://managed.example.org:7443/health'
```

The service should be running and `/health` should return its service/version response through normal certificate validation. Open the same HTTPS origin in a browser. Securely remove the populated temporary bootstrap copy after deployment according to your deployment process; retain a protected operational configuration record for later reconfiguration.

## 3. Configure sign-in

### Email accounts with one-time codes

Use the bootstrap administrator's email to request a code and sign in. In **Email sign-in**, review the SMTP host, port, TLS mode, certificate DNS name, username and sender. **Test SMTP connection** checks the connection; also complete an actual email-code login to verify delivery.

In **People**, enter an **Approved email address** and select **Create email account** for each permitted local user. There is no open self-registration or local password. Users request an eight-digit code, valid for five minutes, with bounded attempts and resends. Disabling an account removes its access and linked engine authority.

### SAML federation, including Entra or a test IdP

The server uses SAML. Configure the identity provider with the service-provider metadata from:

```text
https://managed.example.org:7443/auth/metadata
```

The assertion consumer service is:

```text
https://managed.example.org:7443/auth/saml/callback
```

Configure signed responses and assertions with a persistent NameID. Set application assignment at the identity provider. Supply the IdP sign-in URL, issuer and signing certificate to setup, plus the service-provider entity ID and signing certificate/private key. Administrator assignments use persistent subject IDs, not display names or guessed email identities.

For JSON setup, the optional `saml` object has this shape; replace example subject IDs and all paths/URLs with your registration's values:

```json
{
  "entryPoint": "https://identity.example.org/realms/managed/protocol/saml",
  "idpIssuer": "https://identity.example.org/realms/managed",
  "idpCert": "C:\\Deployment\\idp-signing.pem",
  "entityId": "https://managed.example.org:7443/auth/metadata",
  "signingCert": "C:\\Deployment\\saml-signing.pem",
  "signingKey": "C:\\Deployment\\saml-signing-key.pem",
  "adminSubjects": ["PERSISTENT_SUBJECT_ASSIGNED_BY_YOUR_IDP"]
}
```

Insert that object under the top-level `saml` property of the complete server configuration. IdP and application identifiers must match exactly. Changing the management public origin also requires updating SAML registration/callback settings and client enrollment.

Keycloak lab evidence does not establish a successful Entra deployment. Test browser sign-in and the complete native client browser/loopback exchange against your actual registration. The final native federated login acceptance remains open in the [verification ledger](../VERIFICATION.md).

## 4. Approve the AI gateway and models

Open **Policy & models** as an administrator.

1. Under **Approved service destinations**, enter allowed HTTPS origins, one per line, and select **Save destinations**. Origins include a nondefault port when needed, but no `/v1` or other path. A new installation seeds the gateway origin from setup.
2. Set **HTTPS API base URL** to the gateway base, such as `https://gateway.example.org/v1`.
3. Select **Add model**. Enter the exact **Model ID** exposed by LiteLLM, a **Display name**, whether it is a **Cloud** model, and whether it is **Enabled**.
4. Leave **Permit explicitly approved cloud models** off unless you intend to enable approved cloud models. Turning it on alone does not approve every cloud model; each model still needs its individual entry and enabled setting.
5. Select **Publish policy**. Users should see only the resulting approved catalog.

New installations start with no approved models. Provider credentials do not grant access to model IDs outside the policy. When changing the gateway destination later, users must enroll keys for that destination; old keys are not forwarded to the new host. Editing the installer gateway field only seeds a new database; use the console for an existing server.

## 5. Set local AI capabilities

In **Policy & models**, set **Read files**, **Edit files**, **CMD** and **Windows PowerShell** independently:

| Mode | Result |
| --- | --- |
| Deny | The managed AI cannot perform the action. |
| Ask | The user must approve that specific requested action. |
| Allow | The action may proceed under the current policy and limits. |

Set **Command time limit (seconds)** and **Maximum session steps**, then publish. Current development source also exposes **macOS shell (zsh / bash)**, separate from CMD/PowerShell and defaulting to Deny for older policies. This does not mean a Mac client installer is available.

Reads and edits initially require approval; commands start denied. Choose policy based on the work users actually need. An allowed shell has the user's normal filesystem/network permissions and can perform reads or writes through commands. These switches are not a sandbox around an unrestricted shell and do not disable the user's own terminal.

Clients poll current policy; they stop managed work when a changed policy or lost connection is detected. Measure that delay during acceptance. Already-completed effects cannot be recalled by a later policy change.

## 6. Add custom MCP and API connectors

Use **Connectors** in the administrator console. First approve each required service origin under **Policy & models**; include OAuth token-service destinations as applicable.

For an MCP connector, supply its HTTPS endpoint, choose authentication, discover tools and review their definitions. Enable only approved tools and select their Allow/Ask/Deny policies. Discovery does not automatically approve a tool. Changed tool definitions require another review.

For a custom API connector, define actions with their HTTP methods, paths and argument schemas, or import an OpenAPI document and review the resulting actions. Configure supported resource restrictions and explicitly enable the approved actions. Review the imported scope before making it available to users.

Choose authentication per connector:

| Mode | Who provides access |
| --- | --- |
| No credential | Use only for an endpoint that intentionally needs none. |
| Shared service credential | An administrator supplies the server-held credential. Its permissions apply to the connector's calls. |
| Personal credential | Each user supplies their own connector key. |
| OAuth | Each user authorizes their account; the administrator configures authorization/token URLs, client ID, scopes and client-authentication method. Any required client secret stays on the server. |

Users open **Connector accounts** for personal connector setup. The browser has its own authenticated session. Connector approval does not grant permissions in the external system: service accounts and personal tokens must still be appropriately scoped there.

All connector calls go through the central checks. Arbitrary local `stdio` MCP commands and user-installed plugins are outside the supported catalog. Asking the AI to install a connector cannot change central approvals. Disable the connector or its tools centrally when removing access.

## 7. Install and enroll Windows clients

Run the combined EXE elevated, select **Client**, and enter the server origin, for example `https://managed.example.org:7443`. The address includes your selected port. Daily use should run under a standard Windows account.

For mass deployment, copy [client.example.json](../deployment/client.example.json) into protected staging:

```json
{
  "serverOrigin": "https://managed.example.org:7443"
}
```

If an additional engine CA bundle is required, add `"caFile": "C:\\Deployment\\organization-root.pem"`. Provision Windows/browser trust separately for the native GUI. Setup copies enrollment and CA material into protected machine locations.

```bat
msiexec.exe /i ManagedOpenCode-Client.msi /qn /norestart CONFIGFILE="C:\Deployment\client.json" /l*v "C:\Deployment\client-install.log"
```

For application allowlisting, use the package's payload hashes as well as the installer hashes. Allowing an MSI hash does not necessarily allow every installed executable in a third-party control product. Validate your own enforcement with a standard account. The pilot binaries are unsigned.

## 8. Complete each user's setup

Launch the installed managed client as the intended user:

1. Select **Sign in** for federation or **Email code** for an approved local email account.
2. Open **Personal API key**, enter that user's LiteLLM key and save it. Do not use a shared administrator key for everyone.
3. Choose an approved model and select **Choose folder** for a local workspace.
4. Start a harmless test request. Review any approval prompt and confirm the expected result.
5. Use **Connector accounts** if an enabled connector needs a personal credential or OAuth authorization.
6. Use **Stop**, **New session** and **Sign out** to check the expected local session behavior.

The key is encrypted on the management server, bound to the user and gateway. A persistent per-user LiteLLM environment variable is no longer required by this central design. The engine receives a management token. Access follows the central identity; files and transcripts do not roam between computers. Separate operating-system users have separate endpoint profiles.

## 9. Accept the deployment

These are checks to run against your actual candidate and environment, not a claim that every case has already passed. Preserve sanitized evidence and have a separate reviewer judge it.

| Check | Expected observation |
| --- | --- |
| Install and trust | Correct version/hashes, running server, verified HTTPS on the selected port, protected machine configuration. |
| Login | Approved email OTP and configured SAML flows work; unapproved/disabled users cannot gain access. |
| Models and keys | An approved model works with the user's key; an unapproved or disabled model is denied; one user's key is not another's. |
| Actions | Deny prevents execution, Ask requires the specific approval, and cancellation/rejection is honored. |
| Connectors | Approved tools with suitable credentials work; disabled tools, arbitrary destinations and unauthorized operations fail. |
| Policy change and outage | Active work stops after detected policy change/account revocation/server loss; record elapsed time and process cleanup. |
| Local boundary | Standard users cannot modify protected installation/enrollment; alternate unapproved executables are blocked by your allowlisting product. |
| Audit | Administrative changes and login/security events appear without creating a second prompt/response archive. |
| Lifecycle | Clean install, upgrade, repair and uninstall work with the exact distributed files on the intended OS baseline. |

Use [Windows evidence](../VERIFICATION.md), [Mac evidence](../cloud/RESULTS.md) and [release requirements](../cloud/RELEASING.md) to identify outstanding cases. A green unit/engine workflow is not a full installed-product test. Organization-wide delivery still requires completing the release gate, including the unfinished Mac client.

## 10. Troubleshoot without weakening TLS

| Symptom | Check |
| --- | --- |
| Server unavailable | Service state, selected listener port, port conflict, DNS, firewall and `/health` with normal TLS validation. Setup does not silently choose another port. |
| Certificate failure | Actual certificate/chain presented, SAN hostname, expiry, clock, missing intermediates and runtime trust. Compare the path used by browser, native client and service; inspect active network interception rather than assuming an OS proxy toggle removed it. |
| HTTP 401/403 from the gateway | An HTTP response means TLS completed on that tested connection. Check the personal key and gateway authorization; do not diagnose the status itself as a certificate error. |
| No models | Exact model IDs, enabled flags, global cloud setting and the current published policy. An empty catalog is the default. |
| Key stopped working after gateway change | Enroll a key for the new gateway destination; keys are bound to their destination. |
| No email code | Approved account, SMTP TLS mode/port, certificate DNS name, credentials, sender/relay permissions, delivery and resend limits. Complete a real delivery test after the connection test. |
| SAML rejected | Issuer, entity ID/audience, ACS destination, persistent NameID, signing certificate, clock and application assignment. Test both browser and native flows. |
| Connector not available | Approved service origin, connector enabled state, tool review/approval and personal/service authentication. Re-discovery can require renewed approval. |
| Setup reports an untrusted existing path | Investigate its ownership and write access. Do not bypass the protection or merely change ACLs while hostile open handles may exist. |

Do not use `NODE_TLS_REJECT_UNAUTHORIZED=0`, `rejectUnauthorized: false` or an HTTP downgrade. The earlier real certificate error remains unverified; capture the actual error and public certificate details from your environment before choosing a trust fix. Keep private keys, authorization headers and OTPs out of diagnostic reports.

## 11. Operate, change and recover

Use the browser console for normal model, action, connector and account changes. Use **Audit events** to inspect security/administrative history; the current view shows the latest 250 records. Plan retention and export separately. LiteLLM owns configured prompt/response logging; endpoint application profiles still contain local conversation data.

For installation-level changes, run `C:\Program Files\ManagedOpenCodeCentral\Setup\ManagedConfigure.exe` elevated and load a complete protected configuration. Follow [installation](INSTALLATION.md) for reconfiguration versus repair, service restarts and removal. Changing the public address requires coordinated client, firewall, certificate and IdP changes.

Uninstall retains machine data and the protected package cache for deliberate administrator handling. The vault wrapping key is bound to the Windows machine through DPAPI. Copying its database/key file to another Windows host is not a supported disaster-recovery method. Read [operations and recovery](OPERATIONS.md) before planning backups, migration or production availability.
