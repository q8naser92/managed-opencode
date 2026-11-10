# Third-party software

Managed OpenCode management code is MIT licensed; see LICENSE. The bundled modified OpenCode engine retains the upstream MIT license, copyright 2025 opencode. This independent managed distribution does not imply endorsement by the upstream maintainers.

The prepared **Windows 0.1.4 deployment bundle** includes `DEPENDENCY-LICENSES.zip`, containing the available dependency license/notice files and package metadata from its build environment, plus the OpenCode, Bun and WiX notices. Its inventory includes development tools and multiple versions; it is not an exact list of modules embedded in the executables. Packages that publish only license metadata are marked by an empty noticeFiles list. A complete organization-approved software composition/license audit remains outstanding.

The prepared **Windows 0.1.4 companion source ZIP** contains the platform and modified OpenCode source, pinned lockfiles, Bun 1.4.4 source, and WiX source at commit `aa65968c419420d32e3e1b647aea0082f5ca5b78`. These two full release bundles are distinct from the development Git repository and cloud-validation source ZIP: the latter contain platform/fork source and guides, but do not embed the Bun/WiX source archives or `DEPENDENCY-LICENSES.zip`. The final installer release must supply the corresponding dependency materials; see [release requirements](cloud/RELEASING.md).

WiX's DTF runtime is distributed with the MSI custom actions under MS-RL; preserve its accompanying source and license when redistributing the prepared package. Bun embeds libraries under several licenses, including JavaScriptCore; its full notice explains the pinned WebKit source/relink procedure. Preserve the upstream notices and terms.

Official source references:

- [OpenCode](https://github.com/anomalyco/opencode/tree/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06)
- [Bun 1.4.4 license and runtime notices](https://github.com/oven-sh/bun/blob/bun-v1.4.4/LICENSE.md)
- [Bun 1.4.4 source](https://github.com/oven-sh/bun/tree/bun-v1.4.4)
- [WiX source and MS-RL](https://github.com/wixtoolset/wix/tree/aa65968c419420d32e3e1b647aea0082f5ca5b78)

The unsigned candidate is provided with source for evaluation and further development. The project has not completed a comprehensive license or supply-chain audit.
