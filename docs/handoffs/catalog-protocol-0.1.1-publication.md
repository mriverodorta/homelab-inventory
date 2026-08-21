# Catalog Protocol 0.1.1 Publication Receipt

## Package

- Package: `@homelab-inventory/catalog-protocol@0.1.1`
- npm URL: `https://www.npmjs.com/package/@homelab-inventory/catalog-protocol/v/0.1.1`
- Source repository: `https://github.com/mriverodorta/homelab-inventory`
- Source directory: `packages/catalog-protocol`
- License: MIT

## Reconciliation Boundary

This release reconciles the Registry's frozen publication vectors with
Homelab Inventory's runtime and revision-24 conformance fixtures. It preserves
the complete `0.1.0` root API while making the public package the only protocol
source tree. The Registry consumes the exact npm version after publication.

The package contains public verification code and no Registry private signing
key or publication authority.

## Source Evidence

- Design commit: `563d490`
- Implementation-plan commit: `7c738a0`
- Registry-reference tests commit: `8b57873`
- Reconciled source commit: `a7519c1`
- Revision-24 conformance fixture records: 44
- Revision-24 fixture checksum:
  `bb8e589ab79d9205466961a82792a15107b179f878be0f42dfba763cdb337a80`

## Package Allowlist

- `LICENSE`
- `README.md`
- `package.json`
- `src/canonical-units.ts`
- `src/canonicalize.ts`
- `src/contract.ts`
- `src/contribution-auth.ts`
- `src/facets.ts`
- `src/hash.ts`
- `src/index.ts`
- `src/m2-ae-compatibility.ts`
- `src/m2-physical.ts`
- `src/normalization.ts`
- `src/projector.ts`
- `src/reconcile.ts`
- `src/sanitize.ts`
- `src/signatures.ts`
- `src/snapshot.ts`
- `src/types.ts`

## Verification Evidence

Package, application, Registry candidate, build, migration, signed-artifact,
and container-security results are recorded here after their corresponding
gates complete.

## npm Evidence

Publication timestamp, archive sizes, SHA-1, SHA-256, SHA-512 integrity,
downloaded-tarball comparison, and clean external-consumer verification are
recorded here only after npm serves the immutable `0.1.1` artifact.

No npm credentials, application data, Registry credentials, or private signing
material are recorded in this receipt.
