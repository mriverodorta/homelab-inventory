# Catalog Protocol Single-Source Reconciliation Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with a fresh review at each commit boundary. The user selected inline execution.

**Goal:** Publish `@homelab-inventory/catalog-protocol@0.1.1` as the deterministic union of the Homelab Inventory and Registry contracts, then make the Registry an exact npm consumer with no duplicate protocol source tree.

**Architecture:** Homelab Inventory owns the only protocol source package. Registry frozen vectors govern historical hashes; Homelab Inventory fixtures govern runtime field preservation. A locally packed candidate is tested in the Registry before npm publication, then the Registry is pinned to the downloaded immutable package.

**Tech Stack:** Bun 1.3.14, TypeScript 7, Vitest, npm public packages, Ed25519, Docker, Docker Scout, Trivy.

## Global Constraints

- Do not deploy Homelab Inventory, the Registry, or LabGD.
- Do not modify any signed Registry catalog artifact.
- Preserve every `0.1.0` root export in `0.1.1`.
- Exact npm versions only; never use a caret, tilde, tag, or range.
- No Registry signing key or private runtime data may enter the package.
- Any vector, signature, build, migration, or security failure blocks publication or Registry migration.
- Leave Homelab Inventory's existing untracked `.superpowers/` directory untouched.
- Preserve all Docker volumes and clean task-created tarballs, build output, images, and build cache.

---

### Task 1: Freeze Cross-Repository Reference Behavior

**Files:**
- Create: `packages/catalog-protocol/test/registry-contract.test.ts`
- Create: `packages/catalog-protocol/test/fixtures/registry/canonical-items.json`
- Modify: `packages/catalog-protocol/test/protocol.test.ts`
- Modify: `packages/catalog-protocol/test/projector.test.ts`

**Interfaces:**
- Consumes: the Registry workspace package and its frozen protocol vectors.
- Produces: package tests that fail until the public implementation reproduces the Registry canonical items and hashes.

- [ ] Copy the Registry canonical vector fixture byte-for-byte and record its SHA-256 in the test.
- [ ] Add reference assertions for all Registry v2-v12 contract vectors, with explicit coverage for v7 motherboard, v10 NAS, v11 network, and both v12 physical M.2 vectors.
- [ ] Add public API compatibility assertions:

```ts
expect(M2_AE_FINGERPRINT_VERSION).toBe(M2_PHYSICAL_FINGERPRINT_VERSION)
expect(canonicalizeCatalogItemV12).toBeTypeOf('function')
expect(projectM2PhysicalHashValue).toBeTypeOf('function')
```

- [ ] Add tests proving absent, empty, and populated `availableBuses` remain distinct and that existing `0.1.0` M.2 compatibility helpers remain exported.
- [ ] Run the new tests and confirm they fail against the unreconciled public package.
- [ ] Commit the failing contract tests.

### Task 2: Reconcile the Public Protocol Source

**Files:**
- Modify: `packages/catalog-protocol/src/canonical-units.ts`
- Modify: `packages/catalog-protocol/src/contract.ts`
- Modify: `packages/catalog-protocol/src/hash.ts`
- Modify: `packages/catalog-protocol/src/index.ts`
- Create: `packages/catalog-protocol/src/m2-physical.ts`
- Modify: `packages/catalog-protocol/src/m2-ae-compatibility.ts`
- Remove: `packages/catalog-protocol/src/m2-ae-v12.ts`
- Modify: `packages/catalog-protocol/src/projector.ts`
- Modify: `packages/catalog-protocol/src/sanitize.ts`
- Modify: `packages/catalog-protocol/src/types.ts`

**Interfaces:**
- Consumes: Task 1 frozen tests and existing application fixture tests.
- Produces: one source implementation that satisfies both repositories without changing signed historical hashes.

- [ ] Adopt one canonical `m2-physical.ts` implementation from the Registry's frozen v12 behavior.
- [ ] Preserve patch compatibility with aliases in `types.ts`:

```ts
export const M2_PHYSICAL_FINGERPRINT_VERSION = 12 as const
export const M2_AE_FINGERPRINT_VERSION = M2_PHYSICAL_FINGERPRINT_VERSION
```

- [ ] Merge canonical-unit, sanitizer, and type fields as a union; do not discard application-only accepted fields or Registry optional-state semantics.
- [ ] Make Registry frozen vectors authoritative when identity/content hash code conflicts.
- [ ] Preserve Homelab Inventory hardware-class support, including workstation, RAM, motherboard, NAS, network, and runtime evaluator fields.
- [ ] Export canonical physical M.2 names plus every `0.1.0` root symbol.
- [ ] Run all catalog package tests and standalone source typecheck.
- [ ] Commit the reconciled implementation.

### Task 3: Prepare Public Package 0.1.1

**Files:**
- Modify: `packages/catalog-protocol/package.json`
- Modify: `packages/catalog-protocol/README.md`
- Modify: `scripts/check-share-packages.mjs`
- Modify: `scripts/check-share-packages.test.mjs`
- Modify: `bun.lock`
- Modify: `CHANGELOG.md`
- Modify: `src/release-notes.ts`
- Create: `docs/handoffs/catalog-protocol-0.1.1-publication.md`

**Interfaces:**
- Consumes: the reconciled Task 2 source.
- Produces: an audited patch package manifest and prepublication receipt.

- [ ] Change only the catalog protocol package version to `0.1.1`.
- [ ] Change the public-package audit so package-specific expected versions support catalog protocol `0.1.1` while the viewer packages remain `0.1.0`.
- [ ] Add a regression test rejecting an unexpected catalog protocol version.
- [ ] Document exact-version consumption and identify `0.1.1` as the first Registry-converged release.
- [ ] Update unreleased human and structured release notes without changing the Homelab Inventory app version.
- [ ] Add a receipt containing the current source commit, the expected file allowlist, and explicit fields for evidence recorded after packing and publication.
- [ ] Run release-note and public-package audits.
- [ ] Commit package metadata and documentation.

### Task 4: Verify and Pack the Homelab Inventory Candidate

**Files:**
- Generated temporarily: `packages/catalog-protocol/homelab-inventory-catalog-protocol-0.1.1.tgz`
- Modify after verification: `docs/handoffs/catalog-protocol-0.1.1-publication.md`

**Interfaces:**
- Consumes: committed `0.1.1` package source.
- Produces: one immutable candidate tarball and recorded checksums.

- [ ] Run `bunx tsc -p packages/catalog-protocol/tsconfig.json`.
- [ ] Run `bun run test:public-packages`.
- [ ] Run `bun run lint`, `bun run test`, and `bun run build`.
- [ ] Run `bun run security:container`; require AMD64/ARM64 boot plus zero Scout and Trivy findings.
- [ ] Pack with `npm pack --json --ignore-scripts` and assert the allowlist is only `LICENSE`, `README.md`, `package.json`, and `src/**`.
- [ ] Record compressed/unpacked sizes, file count, SHA-1, SHA-256, and SHA-512 integrity in the receipt.
- [ ] Commit the completed prepublication evidence.

### Task 5: Prove the Candidate in the Registry

**Files:**
- Temporarily modify, then restore: `ServerSpecsInventoryRegistry/package.json`
- Temporarily modify, then restore: `ServerSpecsInventoryRegistry/bun.lock`
- Temporarily move out of resolution, then restore: `ServerSpecsInventoryRegistry/packages/catalog-protocol`

**Interfaces:**
- Consumes: the exact Task 4 tarball.
- Produces: proof that Registry behavior is package-backed before npm publication.

- [ ] Create a task-scoped Registry verification copy that excludes private data and keeps the real checkout untouched.
- [ ] Set the dependency to the absolute candidate tarball and remove workspace resolution from the verification copy.
- [ ] Update the two direct test imports to use `@homelab-inventory/catalog-protocol`.
- [ ] Run a frozen install followed by `assertCatalogProtocolContract()`.
- [ ] Run Registry lint, all tests, server build, admin build, migration tests, fixture checks, signed snapshot round trips, and historical revision verification.
- [ ] Build the Registry image and run its established vulnerability checks without deploying it.
- [ ] Record candidate-tarball results in the publication receipt.
- [ ] Delete the verification copy and its build/cache artifacts.

### Task 6: Publish and Verify npm 0.1.1

**Files:**
- Modify: `docs/handoffs/catalog-protocol-0.1.1-publication.md`

**Interfaces:**
- Consumes: the exact audited Task 4 tarball proven by Task 5.
- Produces: immutable npm release `0.1.1` and registry evidence.

- [ ] Confirm npm identity and organization ownership.
- [ ] Publish the exact tarball with public access; complete npm web/2FA authentication if required.
- [ ] Wait for npm propagation, then retrieve `dist.integrity`, `dist.shasum`, tarball URL, file count, and unpacked size.
- [ ] Download via `npm pack @homelab-inventory/catalog-protocol@0.1.1` and require byte-for-byte equality with the audited local tarball.
- [ ] Install exact `0.1.1` into a clean external Bun project and verify:

```ts
await digestCatalogTemplate(sample)
await verifySignedCatalogArtifact(signedArtifact, trustedPublicKeys)
```

- [ ] Record publication timestamp and immutable npm evidence in the receipt.
- [ ] Commit the final npm publication receipt.

### Task 7: Convert the Registry to the Exact npm Consumer

**Files:**
- Modify: `ServerSpecsInventoryRegistry/package.json`
- Modify: `ServerSpecsInventoryRegistry/bun.lock`
- Modify: `ServerSpecsInventoryRegistry/Dockerfile`
- Modify: `ServerSpecsInventoryRegistry/test/admin-catalog-routes.test.ts`
- Remove: `ServerSpecsInventoryRegistry/packages/catalog-protocol/**`
- Modify: Registry protocol documentation that claims a local package path is authoritative.

**Interfaces:**
- Consumes: verified npm `0.1.1`.
- Produces: a Registry checkout with no duplicate protocol source.

- [ ] Set the dependency exactly:

```json
"@homelab-inventory/catalog-protocol": "0.1.1"
```

- [ ] Regenerate `bun.lock` and assert its SHA-512 equals the publication receipt.
- [ ] Replace direct relative test imports with package imports.
- [ ] Remove workspace package Docker copy steps and stop copying `packages` into the runtime image.
- [ ] Delete the Registry local protocol package only after the exact npm dependency resolves.
- [ ] Run a frozen install from a clean checkout to prove no local fallback exists.
- [ ] Commit the Registry migration as one consumer-boundary change.

### Task 8: Final Registry Verification and Cleanup

**Files:**
- Modify as needed: Registry changelog/handoff documentation
- Modify: `docs/handoffs/catalog-protocol-0.1.1-publication.md`

**Interfaces:**
- Consumes: the committed Registry exact npm migration.
- Produces: final cross-repository verification evidence with clean worktrees.

- [ ] Run Registry lint, complete tests, server/admin builds, migration/startup checks, protocol fixture checks, and signed historical artifact verification again against npm `0.1.1`.
- [ ] Build and boot the final Registry image for its supported architectures and require zero vulnerability findings under the established policy.
- [ ] Confirm no source or Docker file references `packages/catalog-protocol` except immutable historical documentation.
- [ ] Confirm Homelab Inventory still passes package tests after the npm registry publication.
- [ ] Record the Homelab Inventory source commit, Registry migration commit, npm integrity, test totals, and historical verification results.
- [ ] Remove candidate tarballs, temporary consumers/checkouts, build outputs, task-created images, scanner output, and reclaimable Docker build cache.
- [ ] Preserve Docker volumes and report remaining repository/Docker sizes.
- [ ] Confirm Homelab Inventory has only the pre-existing `.superpowers/` untracked directory and the Registry working tree is clean.
