# Installation

This guide describes version 0.1.4. Final combined-EXE upgrade and source-independent repair passed on Windows 11 25H2 and Windows Server 2022. Consult the verification ledger for narrower GUI and operating-system acceptance limits. Use a controlled pilot before broader deployment.

## Prepare the server

Use a dedicated 64-bit Windows server, a stable HTTPS name, and a certificate whose subject alternative names include that name. Supply the full certificate chain and its matching unencrypted PEM private key. Setup copies key material to administrator-owned storage; only the service identity receives read access. The server's clock, DNS and certificate trust must be correct.

Choose any available listening port from 1 through 65535. The public address normally uses that same port; a deliberate reverse-proxy deployment may use a different public port. Update the firewall, client enrollment and SAML callback configuration together when changing a public address. An occupied listener port fails setup rather than silently choosing another one.

Provide an HTTPS LiteLLM API base URL, such as `https://gateway.example/v1`. Set up either SAML administrators or an initial email administrator with working TLS SMTP. Setup rejects a configuration without a usable administrator path. Models start empty, cloud models disabled, reads and edits set to Ask, and CMD/PowerShell set to Deny.

## Graphical setup

Run `ManagedOpenCode-Setup.exe` elevated. Select **Server**, enter its public address, listener port, TLS chain/key, gateway and optional additional CA bundle. Configure SAML, email sign-in, or both. For SAML, supply the identity-provider issuer, sign-in URL and signing certificate, the service-provider entity ID and signing pair, and persistent administrator subject IDs. For email sign-in, supply the initial administrator address and SMTP settings.

After installation, visit the server's HTTPS address. Sign in, approve the models, configure the action policy and add connectors. Changing the gateway on an existing server is done in the web console; the installer field seeds only a new database.

On endpoints, select **Client** in the same EXE and enter the management server address. An additional CA bundle may be supplied for the engine. The native GUI and browser use Windows certificate trust, so provision internal roots through your organization's certificate management as well. Installation must be performed by an administrator; daily use is under a standard Windows account.

## Silent installation

Create a protected JSON file readable by Administrators and SYSTEM. The server file may contain an SMTP bootstrap password, so remove the staging copy after successful deployment. Use UTF-8 JSON; setup also recognizes a Unicode BOM in PEM inputs and normalizes copied PEM files.

Client example:

```json
{
  "serverOrigin": "https://managed.example:7443",
  "caFile": "C:\\Deployment\\organization-root.pem"
}
```

Omit `caFile` when using normal public trust. Install from an elevated command prompt:

```bat
msiexec.exe /i ManagedOpenCode-Client.msi /qn /norestart CONFIGFILE="C:\Deployment\client.json" /l*v "C:\Deployment\client-install.log"
```

Server example for local email sign-in:

```json
{
  "origin": "https://managed.example:7443",
  "port": 7443,
  "gatewayUrl": "https://gateway.example/v1",
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
    "smtpPassword": "REPLACE_WITH_YOUR_SMTP_PASSWORD"
  }
}
```

`mode` can be `tls` for implicit TLS, with the appropriate configured port. A relay without authentication uses an empty username and no password. Certificate verification remains enabled in both modes.

```bat
msiexec.exe /i ManagedOpenCode-Server.msi /qn /norestart CONFIGFILE="C:\Deployment\server.json" /l*v "C:\Deployment\server-install.log"
```

The combined EXE also supports `--role Client|Server --config <path> --quiet`. Success is exit code 0; MSI code 3010 requests a reboot. MSI code 1603 indicates failure; inspect the protected log and server configuration rather than ignoring it.

## SAML registration

Configure signed responses and assertions with persistent NameID. The assertion consumer service is `https://managed.example:7443/auth/saml/callback`; metadata is `/auth/metadata`. Administrator identity is the persistent subject ID, not a display name or a claim guessed from an email address. Keycloak has lab evidence; your Entra tenant still needs its own application assignment and acceptance test.

The optional `saml` setup object has `entryPoint`, `idpIssuer`, `idpCert` (PEM file path), `entityId`, `signingCert` and `signingKey` (PEM paths), and `adminSubjects` (array of persistent subject strings).

## Reconfigure, repair and remove

`C:\Program Files\ManagedOpenCodeCentral\Setup\ManagedConfigure.exe` is the elevated settings GUI. Load a complete setup JSON, review it and apply. Configure-only changes stop/restart the server and verify HTTPS. This GUI does not infer missing values from the existing installation; retain your protected deployment configuration.

MSI repair without `CONFIGFILE` preserves existing enrollment/configuration. To reapply configuration through MSI, use `/i` with `REINSTALL=ALL REINSTALLMODE=amus CONFIGFILE=...`; `/fa` is for repair and must not be used to deliver replacement settings.

Uninstall removes application binaries and the server service/firewall rule. It deliberately retains ProgramData enrollment, database and vault material. An administrator can reinstall against that retained configuration. Permanent data destruction is a separate, explicit administrative operation after backups and retention decisions.

## Enterprise deployment package

Extract the deployment ZIP to a controlled location. `SHA256SUMS.txt` verifies package contents; `ALLOWLIST-SHA256.json` identifies the GUI, engine, server, service host and setup helper that the organization's application control may need to allow. The binaries are unsigned. MSI hash approval alone does not necessarily authorize its installed payloads; test your particular allowlisting product.

The client needs direct HTTPS access to the selected management address. The server needs direct HTTPS access to LiteLLM, the identity provider and approved connectors, and TLS SMTP access for email login. Proxy negotiation is not implemented; the managed transport deliberately avoids inherited proxy settings. Do not assume that OS proxy settings provide this connectivity. There is no inbound product connection from server to endpoint.

For a deployment system running as SYSTEM or an administrator, use the MSI command above, or the supplied wrapper:

```powershell
.\deployment\Install-ManagedOpenCode.ps1 -Role Client -ConfigFile C:\Deployment\client.json -LogPath C:\Deployment\client-install.log
```

Create the staging/log directory with administrator/SYSTEM-only access. The wrapper returns 3010 when a restart is required and throws on installation failure. For inventory/detection, match the per-machine uninstall registration DisplayName `Managed OpenCode Client` or `Managed OpenCode Server` and DisplayVersion `0.1.4`; verify installed file hashes when enforcing this exact candidate.

The combined EXE retains its MSI payload under `C:\ProgramData\ManagedOpenCodeCentral\Packages\<SHA256>` so Windows Installer can repair after the downloaded EXE is deleted. Keep that protected cache while the product is installed. Direct MSI deployment should retain a reliable package source in your deployment system. Uninstall retains both application data and this cache for deliberate administrator cleanup.

## Tested operating systems

The final build has bounded evidence on Windows 11 Pro 25H2 (26200), Windows Server 2022 Standard Evaluation Core (20348), and Windows Server 2019 Standard Evaluation Core (17763). These lab images are not a substitute for your patch-baseline acceptance. Use x64 Windows with .NET Framework 4.7.2 or later. A Server Core deployment uses silent MSI installation and a web browser on another computer for administration; the graphical installer requires an interactive desktop. See VERIFICATION.md for the different test scopes on each OS.

Setup refuses existing installation/cache/workspace paths owned by ordinary users or writable by them. If this check fails, an administrator must investigate and replace the untrusted path during controlled maintenance; simply changing its ACL cannot invalidate handles another process already opened. Do not weaken this check to force installation.
