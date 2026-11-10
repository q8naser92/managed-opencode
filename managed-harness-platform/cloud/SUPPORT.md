# Mac client support requirements

The requested client versions are **macOS 14, 15, 26 and 27**. The central server
continues to target Windows Server 2019 and 2022. A requested version is not a
claim that the application, installer or every patch release has passed testing.
The intended minimum deployment target for the future Mac GUI and installer is
macOS 14.0; packaged native dependencies must also be compatible with that target.

| macOS | Requested native architectures | Test environment |
| --- | --- | --- |
| 14 | Apple Silicon and Intel, on Apple-supported hardware | Separate real Mac host required; GitHub-hosted images retired. |
| 15 | Apple Silicon and Intel, on Apple-supported hardware | GitHub `macos-15` and `macos-15-intel`. |
| 26 | Apple Silicon and Intel, on Apple-supported hardware | GitHub `macos-26` and `macos-26-intel`. |
| 27 | Apple Silicon | GitHub `xcode-27`; assert actual OS major 27 before tests. |

Apple's [macOS 27 hardware list](https://support.apple.com/en-ca/127255) lists
Apple Silicon Macs. Intel hardware is not part of the macOS 27 target. Native
Apple Silicon validation does not establish Rosetta compatibility.

As checked on 10 November 2026, GitHub's
[available images](https://github.com/actions/runner-images/blob/main/README.md)
include the 15/26 runners and the `xcode-27` image. Its
[image definition](https://github.com/actions/runner-images/blob/main/images/macos/xcode-27-arm64-Readme.md)
reports macOS 27. The validation script checks `sw_vers` and the runtime
architecture so an image-label change cannot silently count as the requested OS.
Artifacts are named by both major version and architecture, and contain the
actual OS version/build, tested commit and native executable metadata.

GitHub's [retirement notice](https://github.com/actions/runner-images/issues/15226)
states that its macOS 14 runners retired on 2 November 2026. A successful 15,
26 or 27 job must never substitute for a macOS 14 result. macOS 14 remains an
open validation requirement. No additional Mac rental or cloud account was
created as part of updating this matrix.

On a separately provisioned real macOS 14 test host, clone and check out the exact
reviewed repository commit. Run from that Git checkout's root with Bun 1.4.4
installed, recording the source commit explicitly:

```sh
GITHUB_SHA="$(git rev-parse HEAD)" EXPECTED_MAC_MAJOR=14 EXPECTED_MAC_ARCH=arm64 bash managed-harness-platform/cloud/validate-macos.sh
# Use EXPECTED_MAC_ARCH=x64 on an Intel Mac instead.
```

Before a Mac client release, every applicable OS/architecture combination must
pass installed GUI login, email OTP and federated login, personal-key enrollment,
TLS, centrally approved models/connectors, deny/ask/allow decisions, policy
revocation, disconnect behavior, engine/child-process cleanup, multi-user access,
protected installation/enrollment, upgrade and uninstall checks. Repeat those
checks for the final distributable binaries, obtain the independent read-only
reviewer's decision, and record exact tested OS patch versions and artifact hashes.
Building on one version does not prove the same artifact works on the others.

See [RESULTS.md](RESULTS.md) for observed results and current limitations. The
existing results cover the engine only; the Mac GUI and PKG are still unfinished.
