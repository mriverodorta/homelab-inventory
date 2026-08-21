# Public Catalog Protocol Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the existing catalog wire-contract implementation as the immutable public npm package `@homelab-inventory/catalog-protocol@0.1.0` and produce exact integrity evidence for LabGD.

**Architecture:** The existing source remains the single protocol implementation used by Homelab Inventory and the Registry. A strict npm file allowlist exposes only package metadata, documentation, license, and `src/**`; a generalized public-package audit checks the tarball and dependency direction before the exact tarball is published. LabGD consumes only public verification functions and Registry public keys; Registry private signing keys remain outside the package and outside LabGD.

**Tech Stack:** Bun, TypeScript, Vitest, npm registry, Ed25519 verification, Docker Scout, Trivy, distroless multi-architecture images.

## Global Constraints

- Publish exactly `@homelab-inventory/catalog-protocol@0.1.0` with public npm access.
- Include only `package.json`, `README.md`, `LICENSE`, and `src/**` in the npm artifact.
- Do not include tests, fixtures, data, credentials, screenshots, source maps, server code, editor code, or repository configuration.
- LabGD may verify signed Registry artifacts but must never receive a Registry private signing key or sign Registry content.
- Do not change catalog canonicalization, hashing, validation, or signature behavior for this publication.
- Do not bump the Homelab Inventory application version, create application tags, deploy the application, or publish a Registry catalog revision.
- Npm version `0.1.0` is immutable; if post-publication verification fails, deprecate it and release a new version rather than overwriting it.
- Before publication, `bun run lint`, `bun run test`, `bun run build`, and `bun run security:container` must pass.
- Remove the task tarball, clean-install verification project, build output, Rust target output, scanner images, and task-created Docker cache before completion.

---

### Task 1: Define The Public Package Boundary

**Files:**
- Modify: `packages/catalog-protocol/package.json`
- Create: `packages/catalog-protocol/LICENSE`
- Create: `packages/catalog-protocol/tsconfig.json`
- Modify: `packages/catalog-protocol/README.md`
- Modify: `bun.lock`

**Interfaces:**
- Consumes: the existing `packages/catalog-protocol/src/index.ts` public entry point.
- Produces: a public ESM package named `@homelab-inventory/catalog-protocol` at version `0.1.0` with an explicit npm file allowlist.

- [ ] **Step 1: Add a failing package-manifest assertion**

Add the catalog package to the publication-audit test matrix and assert this exact manifest contract:

```ts
expect(manifest).toMatchObject({
  name: '@homelab-inventory/catalog-protocol',
  version: '0.1.0',
  private: false,
  type: 'module',
  files: ['src', 'README.md', 'LICENSE'],
  publishConfig: { access: 'public' },
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `bunx vitest run scripts/check-share-packages.test.mjs`

Expected: FAIL because the current catalog package is version `1.0.0` and lacks the explicit file and public-access declarations.

- [ ] **Step 3: Harden the manifest and package documentation**

Set the package version to `0.1.0`, retain the root ESM export, add the exact file allowlist, and add `publishConfig.access = "public"`. Copy the repository MIT license byte-for-byte. Add a strict no-emit package `tsconfig.json` covering `src` and `test`.

Document these consumer boundaries in the README:

```md
## Trust boundary

Use this package to canonicalize, hash, validate, and verify public Registry
artifacts. Configure only Registry public verification keys. Registry private
signing keys must remain mounted only in the Registry publication worker.
```

- [ ] **Step 4: Refresh and verify the workspace lockfile**

Run: `bun install && bun install --frozen-lockfile`

Expected: both commands succeed and the catalog workspace entry records version `0.1.0` without unrelated dependency changes.

- [ ] **Step 5: Typecheck and test the unchanged protocol implementation**

Run:

```bash
bunx tsc -p packages/catalog-protocol/tsconfig.json
bunx vitest run packages/catalog-protocol/test
```

Expected: all existing protocol generations, signed snapshots, conformance vectors, and v12 projections pass unchanged.

### Task 2: Extend The Publication Audit

**Files:**
- Modify: `scripts/check-share-packages.mjs`
- Modify: `scripts/check-share-packages.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: npm's `pack --dry-run --json` manifest for each public package.
- Produces: `bun run packages:public:check`; retains `packages:share:check` as a compatibility alias.

- [ ] **Step 1: Write failing catalog-package audit tests**

Cover the catalog package as an independent layer-zero package and prove the audit rejects:

```ts
[
  'test/protocol.test.ts',
  'test/fixtures/private.json',
  'data/catalog.sqlite',
  'credentials.json',
  'src/index.ts.map',
  'src/server/publisher.ts',
  'src/editor/catalog.tsx',
]
```

Also assert that `catalog-protocol` and `share-contract` can coexist at dependency layer zero while neither may depend on higher-level viewer packages.

- [ ] **Step 2: Run the focused audit tests and verify they fail**

Run: `bunx vitest run scripts/check-share-packages.test.mjs`

Expected: FAIL because `catalog-protocol` is not yet in the audited package matrix.

- [ ] **Step 3: Generalize the package audit**

Add `packages/catalog-protocol` to the audited directories and add both independent packages at layer zero:

```js
const packageOrder = new Map([
  ['@homelab-inventory/catalog-protocol', 0],
  ['@homelab-inventory/share-contract', 0],
  ['@homelab-inventory/viewer-model', 1],
  ['@homelab-inventory/viewer-react', 2],
])
```

Keep the existing tarball allowlist, private-import scan, public-access checks, clean-package check, and dependency-direction check. Rename user-facing audit messages from "share package" to "public package" without removing the old command.

- [ ] **Step 4: Add and run the generalized commands**

Add:

```json
{
  "packages:public:check": "bun scripts/check-share-packages.mjs",
  "packages:share:check": "bun scripts/check-share-packages.mjs",
  "test:public-packages": "vitest run packages/catalog-protocol packages/share-contract packages/viewer-model packages/viewer-react scripts/check-share-packages.test.mjs"
}
```

Run: `bunx vitest run scripts/check-share-packages.test.mjs && bun run test:public-packages`

Expected: PASS.

### Task 3: Record The User-Visible Interoperability Change

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `src/release-notes.ts`
- Create: `docs/handoffs/catalog-protocol-0.1.0-publication.md`

**Interfaces:**
- Produces: unreleased application documentation plus a durable publication receipt template.
- Consumes: package version, tarball file list, tarball SHA-512 integrity, npm SHA-1 shasum, publication URL, and verification commands.

- [ ] **Step 1: Add the unreleased release-note entry**

Add a concise note that the public catalog protocol package lets trusted external viewers verify exact signed Registry revisions using the same canonicalization and hashing contract as Homelab Inventory. State that no signing authority or private key is included.

- [ ] **Step 2: Add the publication receipt structure**

Create a receipt with fields for:

```md
- Package: `@homelab-inventory/catalog-protocol@0.1.0`
- Source commit: recorded before publication
- Tarball: `homelab-inventory-catalog-protocol-0.1.0.tgz`
- Included files: recorded from `npm pack --json`
- Local SHA-512 integrity: recorded before publication
- Registry SHA-512 integrity: recorded after publication
- Registry SHA-1 shasum: recorded after publication
- npm URL: `https://www.npmjs.com/package/@homelab-inventory/catalog-protocol/v/0.1.0`
- External clean-install verification: pending until publication
```

The receipt must not contain npm credentials, tokens, environment data, Registry private keys, or private inventory data.

- [ ] **Step 3: Run documentation validation**

Run: `bun run release-notes:check && git diff --check`

Expected: PASS with no app version bump.

- [ ] **Step 4: Commit the publication-ready source**

```bash
git add packages/catalog-protocol scripts/check-share-packages.mjs scripts/check-share-packages.test.mjs package.json bun.lock CHANGELOG.md src/release-notes.ts docs/handoffs/catalog-protocol-0.1.0-publication.md
git commit -m "chore: prepare catalog protocol package publication"
```

Expected: the package tree is clean so the real publication audit can run.

### Task 4: Run Every Prepublication Gate

**Files:**
- Modify: `docs/handoffs/catalog-protocol-0.1.0-publication.md`

**Interfaces:**
- Consumes: the clean publication-ready source commit.
- Produces: an exact `.tgz` whose contents and local integrity are recorded before npm publication.

- [ ] **Step 1: Confirm npm identity and version availability**

Run:

```bash
npm whoami
npm org ls homelab-inventory
if npm view @homelab-inventory/catalog-protocol@0.1.0 version >/dev/null 2>&1; then
  echo 'Refusing to overwrite published version 0.1.0' >&2
  exit 1
fi
```

Expected: npm reports `maikeldorta`, the organization lists that account as owner, and version `0.1.0` is not published.

- [ ] **Step 2: Run package and application verification**

Run:

```bash
bun install --frozen-lockfile
bun run packages:public:check
bun run lint
bun run test
bun run build
bun run security:container
```

Expected: all commands pass; both final distroless architectures boot and Docker Scout plus Trivy report zero findings at every severity.

- [ ] **Step 3: Create and inspect the exact publication tarball**

Run:

```bash
cd packages/catalog-protocol
npm pack --json --ignore-scripts
tar -tzf homelab-inventory-catalog-protocol-0.1.0.tgz
openssl dgst -sha512 -binary homelab-inventory-catalog-protocol-0.1.0.tgz | openssl base64 -A
```

Expected: the tarball contains only the four allowlisted surfaces and the computed integrity matches the `npm pack --json` integrity.

- [ ] **Step 4: Record and commit the prepublication evidence**

Add the source commit, exact file list, local integrity, test counts, build result, and security result to the receipt. Then run:

```bash
git add docs/handoffs/catalog-protocol-0.1.0-publication.md
git commit -m "docs: record catalog protocol publication preflight [skip release-notes]"
```

### Task 5: Publish And Verify The Immutable Package

**Files:**
- Modify: `docs/handoffs/catalog-protocol-0.1.0-publication.md`

**Interfaces:**
- Consumes: the exact preflighted tarball from Task 4.
- Produces: public npm version `0.1.0`, exact npm integrity evidence, and a clean LabGD-style external installation proof.

- [ ] **Step 1: Publish the exact tarball**

Run from `packages/catalog-protocol`:

```bash
npm publish homelab-inventory-catalog-protocol-0.1.0.tgz --access public
```

Expected: npm publishes exactly `@homelab-inventory/catalog-protocol@0.1.0`. If npm requires an interactive OTP or rejects authorization, stop without changing package contents or publishing another version.

- [ ] **Step 2: Compare npm integrity with the local tarball**

Run:

```bash
npm view @homelab-inventory/catalog-protocol@0.1.0 version dist.integrity dist.shasum --json
npm view @homelab-inventory/catalog-protocol@0.1.0 files --json
```

Expected: version is `0.1.0`; Registry `dist.integrity` equals the locally recorded SHA-512 integrity.

- [ ] **Step 3: Verify a clean external consumer**

Create `/private/tmp/homelab-catalog-protocol-verify-0.1.0`, initialize a Bun project, install the exact package, and run this verification:

```ts
import {
  canonicalJson,
  digestCatalogTemplate,
  verifySignedCatalogArtifact,
} from '@homelab-inventory/catalog-protocol'

if (typeof canonicalJson !== 'function') throw new Error('canonicalJson export missing')
if (typeof digestCatalogTemplate !== 'function') throw new Error('digestCatalogTemplate export missing')
if (typeof verifySignedCatalogArtifact !== 'function') throw new Error('verifySignedCatalogArtifact export missing')

const digest = await digestCatalogTemplate({
  type: 'cpu',
  name: 'External verification CPU',
  manufacturer: 'Example',
  model: 'V1',
})
if (!/^[a-f0-9]{64}$/.test(digest.identityHash)) throw new Error('invalid identity hash')
if (!/^[a-f0-9]{64}$/.test(digest.contentHash)) throw new Error('invalid content hash')
console.log('catalog protocol external verification passed')
```

Expected: the exact npm package imports in a project with no workspace links and produces deterministic SHA-256 hashes.

- [ ] **Step 4: Fail safely if external verification fails**

If the published package fails integrity or external verification, run:

```bash
npm deprecate @homelab-inventory/catalog-protocol@0.1.0 "Do not use: post-publication verification failed; use the next published patch version."
```

Do not overwrite or unpublish `0.1.0`.

- [ ] **Step 5: Record final evidence and commit it**

Update the receipt with npm integrity, shasum, URL, clean-install output, and publication timestamp. Then run:

```bash
git add docs/handoffs/catalog-protocol-0.1.0-publication.md
git commit -m "docs: record catalog protocol npm publication [skip release-notes]"
```

- [ ] **Step 6: Clean every task artifact**

Remove the npm tarball, `/private/tmp/homelab-catalog-protocol-verify-0.1.0`, obsolete `dist/`, `node_modules/.vite`, Rust `target/`, task-created scanner images, and task-created Docker build cache. Preserve Docker volumes and active development dependencies. Report final repository, Docker build cache, and task temporary-path sizes.

- [ ] **Step 7: Return the LabGD pinning handoff**

Report the exact package version, npm integrity, shasum, source commit, receipt commit, npm URL, and external verification result. Explicitly state that LabGD must configure Registry public verification keys through Infisical and must not receive a Registry private signing key.
