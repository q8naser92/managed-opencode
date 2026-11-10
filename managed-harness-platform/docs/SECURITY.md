# Security boundary

The supported threat model is a standard Windows user using an administrator-installed, approved managed client. Protect the installed executables and machine configuration with Windows ACLs and your organization's application allowlisting. Local administrators, SYSTEM, hypervisor administrators and a compromised operating system are outside this boundary. No installer can make software absolutely tamperproof against those principals.

The fork reads central configuration through the protected server enrollment. User/project configuration, arbitrary provider setup and unmanaged engine routes do not grant authority. The server rechecks model access, credentials, connector definitions and action grants; hiding GUI controls alone is not the enforcement mechanism. Grants are tied to a user, engine, operation digest, revision and expiry, and can be consumed only once.

An ordinary user cannot modify the protected Program Files installation or ProgramData enrollment. Asking the AI to modify those files does not change its Windows privileges. Application allowlisting should approve the delivered client and engine executables as well as the installer according to the organization's deployment process. A new build changes hashes and needs an updated approved release. The lab does not contain the organization's third-party allowlisting product, so that product's enforcement is a separate acceptance test.

Allowing ordinary CMD/PowerShell is an intentional requirement. Neither application ACLs nor an approved EXE hash makes every action from that user's terminal subject to harness policy. Similarly, an AI shell granted broad user-level execution is not a filesystem/network sandbox. Central controls cover actions through the managed application; stronger endpoint-wide isolation requires additional operating-system or network controls.

## Transport and identity

The endpoint initiates HTTPS connections to the management server. The local engine and SAML desktop callback bind loopback only; the engine requires a randomly generated local credential. Public management TLS, upstream LiteLLM TLS, connector TLS and SMTP TLS are verified. Redirects must not move a credential to an arbitrary destination.

The old HTTP-to-HTTPS LiteLLM relay is not used. The management service calls LiteLLM directly over verified HTTPS, with an explicitly administered additional CA bundle when required. A public Let's Encrypt certificate should be diagnosed by checking the chain actually presented, hostname, dates, interception and runtime trust. Do not import an unverified certificate merely to suppress an error. The original production endpoint was not reachable from the lab; its original error code and real network path remain unverified.

SAML validation binds responses to issuer, audience, destination, recipient, request/browser state and replay protection. Desktop sign-in exchanges a one-use code with PKCE. Local email codes have expiry, attempt/resend limits and one-use validation. Email sign-in depends on the security of the user's mailbox and TLS SMTP infrastructure.

## Credentials and machine data

Server secrets use AES-256-GCM with owner, purpose and destination authenticated as part of encryption. The wrapping key is protected by Windows machine DPAPI and file ACLs. The service identity can access what it needs; ordinary endpoint users do not receive other users' keys. A machine administrator can still access server secrets; secure the server and its backups accordingly.

The DPAPI key is machine-bound. Copying `management.sqlite` and `vault-key.dpapi` to an unrelated Windows installation is not a supported recovery method. There is currently no cross-machine key export/rotation feature. See the recovery limits in the operations guide.

Audit logs are administrative evidence, not an immutable external ledger. A privileged server operator can alter the local database. External append-only audit export, high availability, disaster recovery to a new host and organizational Entra/allowlisting acceptance are not established by the current lab results.
