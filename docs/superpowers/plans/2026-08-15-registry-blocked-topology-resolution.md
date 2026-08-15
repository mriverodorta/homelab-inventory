# Registry Blocked Topology Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make supported blocked Registry topology updates explainable and atomically resolvable while preserving numeric relationships, assigned hardware, and unaffected cables.

**Architecture:** The Registry update pipeline will materialize one canonical target before comparison, validation, preview, and persistence. A pure topology planner will emit typed resource remaps, endpoint moves, and assignment releases; the SQLite replacement path will consume explicit remaps inside the existing cross-project transaction. The group-detail API will normalize all changes to a path-based contract, and the React dialog will render exact reasons and server-provided operation previews.

**Tech Stack:** Bun, TypeScript, ECMAScript modules, `bun:sqlite`, React, TanStack Query, shadcn/ui, Vitest, Bun test.

## Global Constraints

- Positive numeric IDs are persisted relationship identity.
- A semantic resource-key rename with the same resource type and numeric ID preserves assignment IDs and slot positions.
- Automatic safe Registry updates never execute topology-resolution operations.
- Preview is read-only; resolution requires explicit confirmation and one atomic transaction.
- Unknown supported Registry fields survive canonicalization and persistence.
- Only cables with migrated endpoints lose calculated route-cache data.
- Do not add model-, vendor-, or category-specific aliases.
- Update Unreleased release notes and changelog; do not bump the version or create a tag.

---

### Task 1: Canonical Target And Change Contract

**Files:**
- Modify: `server/registry/local-catalog-mapping.mjs`
- Modify: `server/registry/local-catalog-mapping.test.mjs`
- Modify: `server/persistence/sqlite-store.ts`
- Modify: `server/registry/catalog-update-projection.mjs`
- Modify: `server/registry/catalog-update-projection.test.mjs`
- Modify: `src/types/registry.ts`

**Interfaces:**
- Produces: `materializeCatalogItem(item, options)` returning a local-type item with canonical power ports.
- Produces: `canonicalCatalogFieldChange(change)` returning `{ path, kind, impact, current, next }`.
- Consumes: `withCanonicalPowerPorts()` from `shared/power-ports.mjs`.

- [ ] **Step 1: Add failing canonical NAS materialization tests**

Add a fixed external-adapter NAS fixture without explicit ports and assert that
`materializeCatalogItem()` returns exactly one host-owned `ac-input`. Verify
replaceable adapter topology still has no host-owned endpoint.

```js
expect(materializeCatalogItem(fixedNas).ports).toEqual([
  expect.objectContaining({ key: 'ac-input', type: 'ac-input' }),
])
```

- [ ] **Step 2: Run the materialization test and confirm failure**

Run:

```bash
bun run test server/registry/local-catalog-mapping.test.mjs
```

Expected: the fixed NAS has no generated AC input.

- [ ] **Step 3: Canonicalize every materialized catalog item**

Import `withCanonicalPowerPorts` and return the materialized local representation
through that canonicalizer after physical-class conversion. Preserve unknown
fields and the selected usage role.

- [ ] **Step 4: Add failing change-contract projection tests**

Cover both a new semantic change containing `path` and an existing stored change
containing `field`. Assert the API projection returns only this shape:

```js
{
  path: 'compatibility.host.storageSlots[0].key',
  kind: 'changed',
  impact: 'assignment',
  current: 'drive-bays',
  next: 'sata-bays',
}
```

- [ ] **Step 5: Normalize historical and current changes at the API boundary**

Add one projector that uses `change.path ?? change.field`, derives `kind` when
older rows omit it, and derives an impact category from the path. Apply it to
summary members and detailed member changes. Change `CatalogFieldChange` to use
required `path`, `kind`, and `impact`; do not retain `field` in the client type.

- [ ] **Step 6: Run focused tests and commit**

```bash
bun run test server/registry/local-catalog-mapping.test.mjs server/registry/catalog-update-projection.test.mjs
git add server/registry/local-catalog-mapping.mjs server/registry/local-catalog-mapping.test.mjs server/registry/catalog-update-projection.mjs server/registry/catalog-update-projection.test.mjs server/persistence/sqlite-store.ts src/types/registry.ts
git commit -m "fix: canonicalize registry topology targets"
```

### Task 2: Numeric Resource-ID Remapping

**Files:**
- Modify: `server/registry/catalog-update-resolution.mjs`
- Modify: `server/registry/catalog-update-resolution.test.mjs`
- Modify: `server/persistence/migration/core-importer.ts`
- Modify: `server/persistence/migration/core-importer.bun_spec.ts`

**Interfaces:**
- Produces: `remap-resource-key` resolution operations containing `resourceId`, `fromKey`, `toKey`, and numeric `assignmentIds`.
- Extends: `replaceLegacyInventoryItem({ ..., resourceKeyRemaps? })` where remaps are keyed by current semantic key and validated against stable numeric resource-group IDs.

- [ ] **Step 1: Add failing pure planner tests for stable resource IDs**

Create current storage resource ID 1 with key `drive-bays`, proposed resource ID
1 with key `sata-bays`, and five occupied positions. Assert the planner emits one
remap operation and no `unassign-item` operations.

Also test:

- a proposed count below the highest occupied slot is unavailable;
- duplicate numeric resource IDs within one resource type are unavailable;
- incompatible resource type/category remains unavailable;
- a genuinely removed resource still emits explicit releases where safe.

- [ ] **Step 2: Run the planner tests and confirm failure**

```bash
bun run test server/registry/catalog-update-resolution.test.mjs
```

Expected: the current planner returns five `unassign-item` operations.

- [ ] **Step 3: Replace key-set removal with identity-aware resource planning**

Flatten supported host resource collections into records containing collection,
numeric ID, key, count, and allowed assignment type. Match by numeric ID first.
Emit `remap-resource-key` for a safe key rename and emit release operations only
for truly removed resource IDs. Include the remapped assignment IDs in
`affectedRelationships.assignmentIds` without treating them as removed.

- [ ] **Step 4: Add failing importer replacement tests**

Persist a host with assignments in resource ID 1/key `drive-bays`, replace it
with resource ID 1/key `sata-bays`, and pass the explicit remap. Assert:

```ts
expect(assignmentsAfter).toEqual(assignmentsBefore)
expect(slotPositionsAfter).toEqual(slotPositionsBefore)
expect(resourceKeyAfter).toBe('sata-bays')
```

Add negative tests for a remap whose numeric resource ID changed, missing target
slot, duplicate target key, or assignment not listed in the plan.

- [ ] **Step 5: Extend replacement persistence with explicit remaps**

Add `resourceKeyRemaps?: ReadonlyArray<{ resourceId: number; fromKey: string; toKey: string; assignmentIds: number[] }>`.
Before deleting resource rows, validate each current alias has the stated legacy
group ID and each assignment ID belongs to it. During restoration, look up the
new slot by `toKey` only for a validated remap; otherwise retain existing strict
same-key behavior. Restore original assignment-slot IDs and positions.

- [ ] **Step 6: Run focused tests and commit**

```bash
bun run test server/registry/catalog-update-resolution.test.mjs
bun test server/persistence/migration/core-importer.bun_spec.ts
git add server/registry/catalog-update-resolution.mjs server/registry/catalog-update-resolution.test.mjs server/persistence/migration/core-importer.ts server/persistence/migration/core-importer.bun_spec.ts
git commit -m "fix: preserve assignments across resource key changes"
```

### Task 3: Atomic Resolve-And-Apply Execution

**Files:**
- Modify: `server/persistence/sqlite-store.ts`
- Modify: `server/persistence/sqlite-store.bun_spec.ts`
- Modify: `server/registry-routes.test.mjs`

**Interfaces:**
- Consumes: canonical target from `materializeCatalogItem()`.
- Consumes: typed resolution operations from `buildCatalogResolutionPlan()`.
- Produces: authoritative resolution receipt with decisions, counts, affected project/link IDs, and affected relationships.

- [ ] **Step 1: Add a failing DS620slim integration fixture**

Create the captured transition with:

- five storage assignments in resource ID 1/key `drive-bays`;
- one replaceable Synology power-adapter assignment;
- one cable attached to the adapter endpoint;
- two network cables attached to NAS ports 1 and 2;
- proposed fixed adapter topology and key `sata-bays`.

Assert detail planning is available and applying it preserves storage assignment
IDs and positions, migrates only the power endpoint, returns the adapter to
inventory, retains network cables, and updates the link revision/hash.

- [ ] **Step 2: Add failing atomicity and staleness tests**

Cover stale project revision, changed assignment slot, changed cable endpoint,
changed catalog hash, and a failure after inventory replacement. Assert database
hashes and project revisions are unchanged after every failed transaction.

- [ ] **Step 3: Thread resource remaps through replacement**

Collect `remap-resource-key` operations per project and pass them to
`replaceInventoryRecord()` and `replaceLegacyInventoryItem()`. Do not delete
assignments represented by remap operations. Continue deleting only explicit
`unassign-item` operations.

- [ ] **Step 4: Revalidate the plan inside the mutation boundary**

Before mutation, verify current link target, project revisions, assignments,
resource aliases, occupied positions, and connection endpoints. Apply endpoint
moves, assignment releases, canonical inventory replacement, endpoint restores,
Registry state, and evaluation decision in the existing immediate transaction.

- [ ] **Step 5: Return complete affected relationships**

Include remapped assignment IDs, moved connection IDs, returned inventory refs,
and affected projects in the receipt. Verify an applied group exists at the exact
revision/hash before returning success.

- [ ] **Step 6: Run focused tests and commit**

```bash
bun test server/persistence/sqlite-store.bun_spec.ts
bun run test server/registry-routes.test.mjs
git add server/persistence/sqlite-store.ts server/persistence/sqlite-store.bun_spec.ts server/registry-routes.test.mjs
git commit -m "fix: resolve registry topology updates atomically"
```

### Task 4: Explainable Blocked-Update Dialog

**Files:**
- Create: `src/components/inventory/registry-update-change.tsx`
- Create: `src/components/inventory/registry-update-resolution-preview.tsx`
- Modify: `src/components/inventory/registry-update-group-detail.tsx`
- Modify: `src/components/inventory/registry-updates-dialog.tsx`
- Modify: `src/test/registry-updates-dialog.test.tsx`

**Interfaces:**
- Consumes: canonical `CatalogFieldChange` records.
- Consumes: `CatalogUpdateResolution` with exact reason and server-provided operations.
- Produces: human-readable change cards and resolution preview using shadcn/ui primitives.

- [ ] **Step 1: Add failing UI tests**

Assert a blocked detail renders:

- `Storage slot key`;
- `compatibility.host.storageSlots[0].key`;
- current and proposed values;
- an Assignment impact badge;
- exact backend reason;
- preserved assignment, moved cable, and returned adapter operations;
- **Resolve and apply** only when `available` is true.

Assert unavailable plans show their exact reason instead of the generic sentence.
Assert only the clicked action receives a spinner/disabled state.

- [ ] **Step 2: Run UI tests and confirm failure**

```bash
bun run test src/test/registry-updates-dialog.test.tsx
```

Expected: field labels are blank and the generic unavailable copy is rendered.

- [ ] **Step 3: Extract focused change and resolution components**

`RegistryUpdateChange` derives a readable label from the final semantic path
segments while always displaying the exact path. `RegistryUpdateResolutionPreview`
renders backend operations without inferring mutations from the field diff.
Use existing shadcn `Button`, `Badge`, and confirmation dialog composition.

- [ ] **Step 4: Reconcile successful resolution state**

Keep the existing TanStack Query mutation flow but update summary/list/detail
caches from the authoritative receipt. Move the group to Applied, update the
toolbar count immediately, and invalidate only affected workspace queries.

- [ ] **Step 5: Run UI tests and commit**

```bash
bun run test src/test/registry-updates-dialog.test.tsx
git add src/components/inventory/registry-update-change.tsx src/components/inventory/registry-update-resolution-preview.tsx src/components/inventory/registry-update-group-detail.tsx src/components/inventory/registry-updates-dialog.tsx src/test/registry-updates-dialog.test.tsx src/types/registry.ts
git commit -m "fix: explain and resolve blocked registry updates"
```

### Task 5: Release Documentation And Full Verification

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `src/release-notes.ts`

**Interfaces:**
- Documents: user-visible blocked-update field labels, exact reasons, and safe Resolve-and-apply workflow.

- [ ] **Step 1: Update user-visible release documentation**

Add one consolidated Unreleased fix describing deterministic topology resolution,
relationship preservation, and corrected blocked-change labels. Do not mention
the private live item IDs or inventory contents.

- [ ] **Step 2: Run focused regression suite**

```bash
bun run test server/registry/local-catalog-mapping.test.mjs server/registry/catalog-update-projection.test.mjs server/registry/catalog-update-resolution.test.mjs server/registry-routes.test.mjs src/test/registry-updates-dialog.test.tsx
bun test server/persistence/migration/core-importer.bun_spec.ts server/persistence/sqlite-store.bun_spec.ts
```

- [ ] **Step 3: Run repository checks**

```bash
bun run lint
bun run test
bun run build
```

- [ ] **Step 4: Review privacy and diff scope**

```bash
git diff --check
git status --short
git diff --stat
git diff -- CHANGELOG.md
```

Verify no runtime stores, private inventory data, addresses, serials,
credentials, or screenshots are staged.

- [ ] **Step 5: Commit release documentation and final integration**

```bash
git add CHANGELOG.md src/release-notes.ts
git commit -m "fix: complete blocked registry topology resolution"
```
