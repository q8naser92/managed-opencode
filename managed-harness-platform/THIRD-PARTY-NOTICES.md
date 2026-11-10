# Third-party software

Managed OpenCode management code is MIT licensed; see LICENSE. The bundled modified OpenCode engine retains the upstream MIT license, copyright 2025 opencode. This independent managed distribution does not imply endorsement by the upstream maintainers.

`DEPENDENCY-LICENSES.zip` contains the available dependency license/notice files and package metadata from the build environment, plus the OpenCode, Bun and WiX notices. Its inventory includes development tools and multiple versions; it is not an exact list of modules embedded in the executables. Packages that publish only license metadata are marked by an empty noticeFiles list. A complete organization-approved software composition/license audit remains outstanding.

The companion source ZIP contains the platform and modified OpenCode source, pinned lockfiles, Bun 1.4.4 source, and WiX source at commit `aa65968c419420d32e3e1b647aea0082f5ca5b78`. WiX's DTF runtime is distributed with the MSI custom actions under MS-RL; its source and license must accompany redistribution. Bun embeds libraries under several licenses, including JavaScriptCore; its full notice explains the pinned WebKit source/relink procedure. Preserve the upstream notices and terms.

Official source references:

- [OpenCode](https://github.com/anomalyco/opencode/tree/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06)
- [Bun 1.4.4 license and runtime notices](https://github.com/oven-sh/bun/blob/bun-v1.4.4/LICENSE.md)
- [Bun 1.4.4 source](https://github.com/oven-sh/bun/tree/bun-v1.4.4)
- [WiX source and MS-RL](https://github.com/wixtoolset/wix/tree/aa65968c419420d32e3e1b647aea0082f5ca5b78)

The unsigned candidate is provided with source for evaluation and further development. The project has not completed a comprehensive license or supply-chain audit.
