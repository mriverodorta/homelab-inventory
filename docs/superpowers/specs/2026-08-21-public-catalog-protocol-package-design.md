# Public Catalog Protocol Package Design

## Purpose

Publish the existing catalog wire-contract implementation as
`@homelab-inventory/catalog-protocol@0.1.0` so LabGD can verify and mirror exact
historical Registry definitions with the same canonicalization, hashing,
signature, snapshot, and contract-version behavior used by Homelab Inventory.

LabGD is a verifier only. It receives public signed artifacts and configured
Registry public keys. It never receives a Registry private signing key and
never signs, republishes, or mutates Registry catalog revisions.

## Package Boundary

The first public release retains the existing package source as the canonical
implementation but narrows the npm artifact to:

- `package.json`
- `README.md`
- `LICENSE`
- `src/**`

Tests, fixtures, screenshots, source maps, application data, credentials,
server code, editor code, and repository configuration are excluded. The
manifest declares ESM exports, `private: false`, and public npm access. The
initial public package version is `0.1.0` because this is the first external
consumer and the npm API has not previously carried a compatibility promise.

The root export remains the protocol entry point for Homelab Inventory and the
Registry. The README distinguishes public verification APIs from Registry-only
signing operations. Exporting signing primitives does not confer signing
authority: private keys remain unavailable outside the Registry publisher.

## Verification Flow

LabGD downloads immutable public Registry artifacts and verifies them in this
order:

1. Select a configured public key by the signed key identifier.
2. Verify manifest, snapshot, and digest-index signatures.
3. Verify referenced artifact SHA-256 hashes and byte sizes.
4. Parse the declared catalog contract and fingerprint versions without
   silently accepting unsupported versions.
5. Resolve the exact `templateKey`, `templateRevision`, and `contentHash`
   requested by a share.
6. Store the verified immutable definition in the LabGD historical mirror.

Failure is blocking and leaves the previously verified mirror unchanged. LabGD
must never resolve `latest` when rendering an immutable or revision-bound share.

## Cross-Project Evidence

Homelab Inventory records the package version and dry-run tarball contents
before publication. After npm publication it records the Registry-reported
SHA-512 integrity and SHA-1 shasum. LabGD pins exactly `0.1.0`, commits its
lockfile integrity, and verifies the installed package identity during startup.

The package publication audit is extended to cover `catalog-protocol` while
preserving the dependency direction of the existing share packages. No package
may import private application or server modules.

## Tests And Release Gate

Before publication:

- All catalog protocol tests and conformance vectors pass unchanged.
- TypeScript type checking passes.
- The npm dry-run artifact contains only the allowlisted public files.
- The package audit rejects tests, fixtures, secrets, private data, source maps,
  server code, and editor code.
- Homelab Inventory lint, full tests, production build, and dual-architecture
  zero-vulnerability container gate pass.

After publication, a clean temporary Bun project installs the exact npm package
and verifies public imports and signed-artifact validation. The temporary
project and npm/build caches created by the task are removed.

## Rollout And Immutability

Npm version `0.1.0` is immutable. Publication happens only after every local
gate passes. If post-publication verification fails, `0.1.0` is deprecated with
a precise reason; it is never overwritten. A corrected release uses a new
semver version.

LabGD remains fail-closed until it pins the published version and exact npm
integrity. No Homelab Inventory application deployment or Registry catalog
publication is required merely to publish this shared library.
