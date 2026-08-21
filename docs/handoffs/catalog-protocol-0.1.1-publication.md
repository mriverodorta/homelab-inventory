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
- Update-review topology projector commit: `5e1583a`
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

- Package TypeScript build: passed
- Package tests: 131 passed across 19 files
- Application lint: passed with four pre-existing Fast Refresh warnings
- Application Vitest: 2,260 passed across 321 files
- Application Bun auth tests: 2 passed
- Application SQLite/server tests: 318 passed, 1 intentional skip
- Application production build: passed
- Application container preflight: AMD64 and ARM64 booted successfully
- Application Docker Scout: 0 findings on AMD64 and ARM64
- Application Trivy: 0 findings on AMD64 and ARM64
- Registry frozen revision-24 fixture checksum: matched byte-for-byte
- Registry candidate lint: passed
- Registry candidate tests: 830 passed across 181 files
- Registry candidate server and admin builds: passed
- Registry candidate image build: passed

The Registry candidate scan also exposed vulnerabilities already present in
the Registry's Alpine runtime packages. The protocol package has no runtime
dependencies and introduced no container package. Registry runtime hardening
is tracked independently and is not represented as a successful zero-finding
scan in this receipt.

## Candidate Archive

- Filename: `homelab-inventory-catalog-protocol-0.1.1.tgz`
- Files: 19
- Compressed size: 40,740 bytes
- Unpacked size: 199,152 bytes
- SHA-1: `30589482158772e93e9bc73189c79c980b7f9b01`
- SHA-256: `27247489f7ee0a03f11d6b42f873d9fa3c439ffd080f5d447bc970619821ff81`
- SHA-512: `498a2e418be36e5db49b06c10c758b4d6697589628c0cbd67d38881b284ecf4c3995738b59893269d0c587b2e2bbf94144feebd157c4954f2e2feb3ee44060c5`
- npm integrity: `sha512-SYouQYvjbl20mwbBDHWLTWaXWJYowMvWfTiIGyhOz0w5lXOLWYkyadDFh7Liu/lBRP7r0VfElU8uL+s+5EBgxQ==`

## npm Evidence

Publication timestamp, archive sizes, SHA-1, SHA-256, SHA-512 integrity,
downloaded-tarball comparison, and clean external-consumer verification are
recorded here only after npm serves the immutable `0.1.1` artifact.

No npm credentials, application data, Registry credentials, or private signing
material are recorded in this receipt.
