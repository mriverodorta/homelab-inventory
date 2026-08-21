# Catalog Protocol 0.1.0 Publication Receipt

## Package

- Package: `@homelab-inventory/catalog-protocol@0.1.0`
- npm URL: `https://www.npmjs.com/package/@homelab-inventory/catalog-protocol/v/0.1.0`
- Source repository: `https://github.com/mriverodorta/homelab-inventory`
- Source directory: `packages/catalog-protocol`
- License: MIT

## Trust Boundary

The package canonicalizes, hashes, validates, and verifies public Registry
artifacts. It contains no private signing key and confers no Registry
publication authority. Consumers configure only trusted Registry public keys.

## Prepublication Evidence

- Publication-ready source commit: `5baa356801c9092896cc81f0c74fe4bb528ea126`
- Tarball: `homelab-inventory-catalog-protocol-0.1.0.tgz`
- Tarball size: 36,853 bytes compressed; 181,945 bytes unpacked
- Included files: 19
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
  - `src/m2-ae-v12.ts`
  - `src/normalization.ts`
  - `src/projector.ts`
  - `src/reconcile.ts`
  - `src/sanitize.ts`
  - `src/signatures.ts`
  - `src/snapshot.ts`
  - `src/types.ts`
- Local SHA-512 integrity: `sha512-KDrXbZCZsNYvu87znceaz5z14mfMZOZhoFvr/yr1My4c2OiJSJuZNh6XMpHaqhPmNb3fY++cU53jMSeNLDje9w==`
- Local SHA-1 shasum: `5220bae2e95da96e00aa1e1520b9e7071298893c`
- Catalog protocol tests: 91 passed across 15 files
- Standalone source typecheck: passed
- Public package tests: 132 passed across 27 files
- Application Vitest: 2,220 passed across 317 files
- Bun suites: 320 passed and one intentional local-data test skipped
- Lint: passed with four established Fast Refresh warnings
- Production build: passed
- Container security: Linux AMD64 and ARM64 runtime checks passed; Docker
  Scout and Trivy reported zero vulnerabilities at every severity

## Registry Evidence

- Published at: `2026-08-21T18:17:44.639Z`
- Registry SHA-512 integrity: `sha512-KDrXbZCZsNYvu87znceaz5z14mfMZOZhoFvr/yr1My4c2OiJSJuZNh6XMpHaqhPmNb3fY++cU53jMSeNLDje9w==`
- Registry SHA-1 shasum: `5220bae2e95da96e00aa1e1520b9e7071298893c`
- Registry tarball SHA-256: `b59f9658012fca5d0c5f5576cdca5a77479bcc71aa014c5df9aaa2c672d8f59e`
- Registry tarball verification: byte-for-byte identical to the audited local
  tarball, with the same 19-file allowlist and compressed/unpacked sizes
- External clean-install verification: passed using an exact npm dependency
  from a clean temporary project with no workspace or file dependency
- External runtime verification: canonical template identity/content hashing
  and Ed25519 artifact signature verification passed
- External Bun lock integrity: matched the Registry SHA-512 integrity exactly

No npm credentials, application data, Registry credentials, or private signing
material are recorded in this receipt.
