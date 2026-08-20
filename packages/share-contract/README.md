# @homelab-inventory/share-contract

Closed, deterministic public schemas for Homelab Inventory shares.

## API

- `parseShareManifest` and `parseShareViewBlob` reject unknown signed fields.
- `canonicalShareJson` produces stable cross-runtime JSON.
- `shareContentHash` hashes canonical UTF-8 bytes with SHA-256.
- `classifyShareField` identifies safe, opt-in, and forbidden data.
- `negotiateShareCapabilities` fails closed on unsupported contract or view versions.

Registry references are revision-pinned and include the exact template content hash. The package contains no API client, credentials, persistence, or private application data.

## Versioning

Package versions follow independent SemVer. A breaking signed-data change requires a new `shareContractVersion`; it is not hidden inside a package major version. Services consuming this contract should pin an exact package version and negotiate capabilities before accepting a share.
