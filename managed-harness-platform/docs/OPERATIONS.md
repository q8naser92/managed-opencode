# Operations and recovery

Status: operational guidance for the integration candidate. A complete restore exercise is still an outstanding acceptance gate. Do not rely on an untested recovery procedure for production data.

## Locations

| Location | Purpose |
| --- | --- |
| `C:\Program Files\ManagedOpenCodeCentral\Server` | Server and Windows service binaries |
| `C:\Program Files\ManagedOpenCodeCentral\Client` | Desktop GUI and managed engine |
| `C:\Program Files\ManagedOpenCodeCentral\Setup` | Elevated configuration GUI and ACL scripts |
| `C:\ProgramData\ManagedOpenCodeCentral\Server` | Database, TLS/SAML material, protected vault key and server boot settings |
| `C:\ProgramData\ManagedOpenCodeCentral\Client` | Protected management enrollment and optional engine CA bundle |
| `C:\ProgramData\ManagedOpenCodeCentral\Packages` | Protected retained MSI sources used for EXE-installed repair |
| `C:\ProgramData\ManagedOpenCodeCentral\SetupLogs` | Logs from the combined setup EXE |
| `%LOCALAPPDATA%\ManagedOpenCode\<central-user-id>` | User-owned local engine profile and session storage |

The server service runs as `NT SERVICE\ManagedOpenCodeServer`. The endpoint engine runs as the signed-in user, within a Windows job that is closed when managed work stops. The product does not require an endpoint scheduled task or an inbound endpoint control port.

## Health and routine changes

Check `Get-Service ManagedOpenCodeServer`. From an elevated shell, the installed `managed-server.exe --validate`, `--validate-access` and `--healthcheck` commands check configuration, an administrator login path and the actual verified HTTPS listener. Do not invoke the service host's internal key-reading command during routine operations or write key material into logs.

Use the web console for models, policies, connectors, users and SMTP. Use the elevated configuration GUI for listener/TLS/SAML boot settings and endpoint enrollment. Stop active managed work before maintenance. Clients stop when the management connection is lost; they reconnect when it returns but cancelled commands must be restarted deliberately.

When changing a public port, update server origin, listener/firewall, endpoint enrollment and identity-provider URLs as one maintenance change. The installer opens the selected server listener port. Restrict the inbound rule's source networks according to your deployment; the installer preserves existing address filters during a configuration update.

## Backups

Back up the Windows server with a method that preserves the machine identity and DPAPI secrets, such as a protected full-VM/system backup. For a consistent application snapshot, stop `ManagedOpenCodeServer` before taking the backup and start it after the backup completes. Preserve the entire server data directory, including any SQLite WAL/SHM files, certificate/private-key files and the DPAPI-protected vault file. Never copy just a live SQLite database file and assume it is consistent.

Treat backups as secrets. Limit access, encrypt them, define retention and verify restore to an isolated network. A copied application directory on a freshly installed Windows machine cannot decrypt this machine's DPAPI vault. Cross-machine export is not implemented.

Restore a full machine/system backup to an isolated instance, verify service startup and TLS, then verify a test user's login, an encrypted credential, a model request, connector access and policy audit before reconnecting production clients. Revoke existing sessions and rotate affected credentials after a compromise; restoring old data can restore previously valid tokens or policy. A restore drill and an explicit operational session-revocation procedure are still outstanding acceptance work.

## Installer rollback

Setup stages a unique administrator/SYSTEM-only transaction backup before modifying configuration. Failed configuration restores the previous files and listener port. Successful setup removes that backup. A leftover `Installer-Client-<id>` or `Installer-Server-<id>` directory needs administrator investigation before manual deletion. Never restore an arbitrary directory into protected configuration, and never use a partially collected backup after successful commit cleanup failed.

MSI uninstall preserves data by design. For lab resets, keep a verified backup and explicitly approve any data destruction. For ordinary repair, use MSI repair and leave the enrollment/database in place.

## TLS troubleshooting

Separate DNS/TCP connectivity, TLS validation and HTTP authorization. Receiving HTTP 401/403 from the intended HTTPS endpoint means the TLS handshake completed; it does not mean the API key is correct. Compare the actual presented certificate chain with the expected issuing CA and check the full intermediate chain, hostname and server clock. Check environment proxy variables as well as OS proxy settings.

The server rejects invalid, mismatched or inappropriate TLS configuration during setup. Add only an administrator-verified root/intermediate bundle when private trust is required. Never use `NODE_TLS_REJECT_UNAUTHORIZED=0`, a permissive certificate callback, or an HTTP relay as the fix.
