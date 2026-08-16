# Canonical Catalog And NAS Power Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Canonicalize historical catalog templates at the local index boundary, remove user-visible legacy suffixes, and render fixed NAS power as a single correctly numbered header endpoint.

**Architecture:** Preserve verified signed snapshots unchanged, project their item payloads into the current canonical unit model when rebuilding the disposable SQLite catalog index, and force one automatic rebuild through an index schema bump. Keep relational port identities unchanged while introducing a display-only AC ordinal for NAS header chips.

**Tech Stack:** Bun, TypeScript, React, bun:sqlite, Vitest, Testing Library, Drizzle-managed SQLite migrations.

## Global Constraints

- Do not rewrite signed catalog snapshot artifacts or their hashes.
- Preserve inventory assignments, placements, cable endpoints, and route-cache identities.
- Historical v1-v8 measurements must convert exactly or fail activation.
- Current v9/v10 contract violations must fail explicitly.
- Do not bump the application version, tag, push, or deploy.
- Update Unreleased changelog and structured release notes.

---

### Task 1: Canonical Runtime Catalog Projection

**Files:**
- Create: `server/registry/catalog-runtime-projection.mjs`
- Create: `server/registry/catalog-runtime-projection.bun_spec.mjs`
- Modify: `server/registry/catalog-index.mjs`
- Modify: `server/registry/catalog-index-contract.mjs`
- Modify: `server/registry/catalog-index.bun_spec.mjs`

**Interfaces:**
- Produces: `projectCatalogTemplateForRuntime(template)` returning a cloned template whose `item` is canonical while signed identity metadata is unchanged.
- Consumes: `canonicalizeCatalogItemV9`, `canonicalizeCatalogItemV10`, and fingerprint version constants from the catalog protocol package.

- [ ] **Step 1: Write failing projection tests**

Cover a fingerprint-v8 RAM record using `capacityGb`, a legacy storage record using `capacityTb`, a v9 record using canonical fields, and a v10 NAS record with fixed power topology. Assert canonical item fields and unchanged hash metadata.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `bun test server/registry/catalog-runtime-projection.bun_spec.mjs`

- [ ] **Step 3: Implement runtime projection**

Use exact canonical conversion for fingerprint versions below 9, v9 canonicalization for fingerprint 9, and strict v10 validation for fingerprint 10. Never mutate the source template.

- [ ] **Step 4: Integrate projection into index rebuilding**

Write canonical item JSON, searchable text, and facets from the runtime projection while retaining the signed template metadata columns. Increase `CATALOG_INDEX_SCHEMA_VERSION` from `2` to `3` so startup rebuilds existing indexes.

- [ ] **Step 5: Verify focused tests**

Run: `bun test server/registry/catalog-runtime-projection.bun_spec.mjs server/registry/catalog-index.bun_spec.mjs`

### Task 2: Catalog Range Regression Coverage

**Files:**
- Modify: `server/registry/catalog-index.bun_spec.mjs`
- Modify: `server/registry/snapshot-service.bun_spec.mjs`

**Interfaces:**
- Consumes: canonical runtime projection from Task 1.
- Produces: regression coverage for historical records under current signed facets.

- [ ] **Step 1: Add failing mixed-version facet tests**

Assert inclusive RAM bounds, exact equal bounds, and canonical historical ranges for CPU, GPU, storage, network, switch, UPS, and power data.

- [ ] **Step 2: Run focused tests**

Run: `bun test server/registry/catalog-index.bun_spec.mjs server/registry/snapshot-service.bun_spec.mjs`

- [ ] **Step 3: Correct any projection gaps**

Extend only the shared canonical-unit translation when a published historical field has a defined exact current equivalent. Reject ambiguous fields rather than guessing.

- [ ] **Step 4: Re-run focused tests**

Run: `bun test server/registry/catalog-index.bun_spec.mjs server/registry/snapshot-service.bun_spec.mjs`

### Task 3: Current Terminology For Persisted Select Values

**Files:**
- Modify: `src/components/inventory-form/field-primitives.tsx`
- Modify: `src/test/inventory-item-dialog.test.tsx`
- Modify: `src/test/inspector-panel.test.tsx`

**Interfaces:**
- Preserves: `withLegacyOption(options, currentValue)` behavior that keeps unknown persisted values selectable.
- Changes: visible label for an unknown persisted value from `<value> (Legacy)` to `<value>`.

- [ ] **Step 1: Update tests to require verbatim labels**

Assert that values such as `M.2 2230 A/E` and `Omada managed` remain present without a legacy suffix.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `bun run test -- src/test/inventory-item-dialog.test.tsx src/test/inspector-panel.test.tsx`

- [ ] **Step 3: Remove the generated suffix**

Render the persisted value or its known option label directly. Do not rewrite arbitrary user-authored strings.

- [ ] **Step 4: Re-run focused tests**

Run: `bun run test -- src/test/inventory-item-dialog.test.tsx src/test/inspector-panel.test.tsx`

### Task 4: NAS Power Ownership Presentation

**Files:**
- Modify: `src/components/nas-card.tsx`
- Modify: `src/test/nas-card.test.tsx`
- Modify: `src/test/power-adapter-workflow.test.tsx`

**Interfaces:**
- Adds: optional display ordinal input for the local NAS `PortChip` renderer.
- Preserves: endpoint `portId`, semantic key, persisted `slotNumber`, and cable identity.

- [ ] **Step 1: Add failing NAS rendering tests**

Assert that internal PSU and fixed external adapter NAS records render one header chip labeled `AC 01`, fixed adapters render no body card or assignment slot, and replaceable adapters retain their assignment row.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `bun run test -- src/test/nas-card.test.tsx src/test/power-adapter-workflow.test.tsx`

- [ ] **Step 3: Implement display-only AC ordinals**

Use the position among host-owned AC input ports for chip text and tooltip. Continue passing the persisted port ID to every endpoint handler.

- [ ] **Step 4: Remove duplicate fixed-adapter body rendering**

Keep fixed adapter metadata in persisted topology and inspectors but omit the canvas body card.

- [ ] **Step 5: Re-run focused tests**

Run: `bun run test -- src/test/nas-card.test.tsx src/test/power-adapter-workflow.test.tsx`

### Task 5: Migration, Recovery, And Documentation

**Files:**
- Modify: `server/persistence/migration/catalog-rebuilder.bun_spec.ts`
- Modify: `server/persistence/migration/cutover.bun_spec.ts`
- Modify: `CHANGELOG.md`
- Modify: the active structured Unreleased release-note file located by `scripts/check-release-notes.mjs`

**Interfaces:**
- Consumes: catalog index schema version 3.
- Produces: verified automatic rebuild, idempotent restart, and user-visible release documentation.

- [ ] **Step 1: Add migration tests**

Verify a schema-2 index is backed up and rebuilt as schema 3, the active marker advances, canonical facets are present, and a second startup is a no-op.

- [ ] **Step 2: Run migration tests**

Run: `bun test server/persistence/migration/catalog-rebuilder.bun_spec.ts server/persistence/migration/cutover.bun_spec.ts`

- [ ] **Step 3: Update Unreleased documentation**

Consolidate the canonical catalog filter repair, terminology cleanup, and NAS power rendering correction into human-readable entries.

- [ ] **Step 4: Run complete verification**

Run:

```bash
bun run lint
bun run test
bun run build
bun run release-notes:check
```

- [ ] **Step 5: Review final diff and data safety**

Confirm no runtime `data/`, credentials, screenshots, version bumps, tags, or unrelated user changes are included.
