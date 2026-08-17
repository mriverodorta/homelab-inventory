# Registry Revision 21 PCIe Minimum Lanes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import catalog revision 21 and correctly evaluate optional PCIe functional minimum lanes without changing existing user topology.

**Architecture:** Make the v11 canonicalizer preserve an absent minimum and enforce synchronization with the compatibility projection. Keep SQLite nullable, remove connector-width inference from compatibility evaluation, and prove update safety and artifact fidelity through focused tests plus a live revision 21 refresh.

**Tech Stack:** Bun, TypeScript, React, Vitest, `bun:sqlite`, shared catalog protocol, distroless Docker.

## Global Constraints

- Catalog contract remains v11.
- `minimumElectricalLanes` is optional and never inferred.
- Present values are positive safe integers and cannot exceed `connectorLanes`.
- Catalog refresh alone cannot modify inventory or project topology.
- Release notes and changelog must describe the user-visible fix.
- Release only after lint, tests, build, and zero-vulnerability container preflight pass.

---

### Task 1: Canonical v11 validation

**Files:**
- Modify: `packages/catalog-protocol/src/canonical-units.ts`
- Test: `packages/catalog-protocol/test/network-v11.test.ts`

**Interfaces:**
- Consumes: `canonicalizeCatalogItemV11(value)` and canonical network records.
- Produces: Canonical PCIe host interfaces with an optional synchronized minimum.

- [ ] Add failing tests for absent, invalid, excessive, mismatched, and compatibility-only minima.
- [ ] Make PCIe host-interface minimum parsing conditional on field presence.
- [ ] Reject compatibility-only minima before deriving the synchronized projection.
- [ ] Run the network protocol tests and confirm they pass.

### Task 2: Compatibility evaluator semantics

**Files:**
- Modify: `shared/compatibility/index.mjs`
- Test: `src/test/compatibility-rules.test.ts`

**Interfaces:**
- Consumes: Optional `requirements.expansion.minimumElectricalLanes`.
- Produces: An insufficient-lanes error only for a declared minimum that is not met.

- [ ] Add failing tests for an x8 connector with no minimum in an x4 electrical slot and for X520-DA2 minimum x4 in DS1621+.
- [ ] Remove the connector-width-derived electrical warning branch.
- [ ] Preserve mechanical fit and PCIe generation behavior.
- [ ] Run compatibility tests and confirm they pass.

### Task 3: Identity, artifact, and update behavior

**Files:**
- Modify: `server/registry/catalog-update-semantics.test.mjs`
- Modify: `server/registry/catalog-update-policy.test.mjs`
- Modify: `server/registry/snapshot-service.bun_spec.mjs`
- Modify: protocol snapshot or bundle tests selected from existing coverage.

**Interfaces:**
- Consumes: Revision 2 and revision 3 X520-DA2 definitions.
- Produces: Identity-stable/content-changing digests and safe relaxation planning.

- [ ] Prove lowering and omitting a minimum preserve identity and change content.
- [ ] Prove a minimum relaxation introduces no finding and is classified safe.
- [ ] Prove snapshots, digest indexes, and offline bundles preserve absent/present minima.
- [ ] Verify the published X520-DA2 hashes from revision 21.

### Task 4: Catalog refresh and persistence safety

**Files:**
- Modify: registry snapshot, catalog index, and SQLite store tests matching current refresh architecture.

**Interfaces:**
- Consumes: A signed 5,232-template revision 21 snapshot or deterministic fixture derived from it.
- Produces: An activated revision 21 catalog without inventory or project mutation.

- [ ] Add a revision 21 import regression covering all 5,232 templates without committing private data.
- [ ] Assert X520-DA2 revision 3 and optional-minimum distribution.
- [ ] Assert repeated refresh and restart are idempotent.
- [ ] Assert linked records, assignments, placements, connections, and project revisions are unchanged by refresh.

### Task 5: User-facing release documentation

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `src/release-notes.ts`

**Interfaces:**
- Produces: One concise unreleased fix entry describing revision 21 support and corrected PCIe lane audits.

- [ ] Add the changelog entry.
- [ ] Add the structured unreleased release-note detail.
- [ ] Run release-note validation through the standard test/build flow.

### Task 6: Verification and patch release

**Files:**
- Modify during release: package version, structured release notes, and generated release metadata according to repository scripts.

**Interfaces:**
- Produces: A patch release on `main/latest` and healthy production/demo deployments.

- [ ] Run `bun run lint`.
- [ ] Run `bun run test`.
- [ ] Run `bun run build`.
- [ ] Run `bun run security:container` and require zero known vulnerabilities on amd64 and arm64.
- [ ] Finalize the next patch version using the local staged release workflow.
- [ ] Push `main` and publish the exact approved OCI candidates to `latest` without candidate tags.
- [ ] Wait for Watchtower and verify production/demo health.
- [ ] Refresh the live catalog and verify revision 21, 5,232 templates, and X520-DA2 revision 3.
- [ ] Verify the linked update applies according to trust policy and the DS1621+ lane alert disappears.
