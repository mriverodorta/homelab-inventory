# Domain Persistence Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give topology, geometry, compatibility, inventory presentation, custom metadata, workbook, workspace preferences, and operational state independent persistence and revision channels so only relevant changes synchronize WASM or recalculate cables.

**Architecture:** Keep `projects.revision` as the topology revision consumed by the engine, add explicit revisions for workbook, compatibility policy, and item metadata, and classify each mutation with a server-computed effect envelope. An effect-aware frontend coordinator updates domain caches, synchronizes WASM only for topology effects, remeasures geometry only for geometry effects, and records typed domain Undo/Redo commands.

**Tech Stack:** Bun 1.3.x, Bun SQLite, Drizzle ORM and generated SQL migrations, Express 5, TypeScript 7, React 19, TanStack Query, SSE live events, Rust/WASM domain engine, Vitest, Testing Library, Playwright browser verification, Docker distroless runtime.

## Global Constraints

- Core schema 28 migration is automatic, transactional, idempotent, rollback-capable, and covered by the established pre-migration backup.
- `projects.revision` advances only when the normalized engine topology projection changes.
- Custom metadata autosaves after 500 ms and remains part of application-wide Undo/Redo.
- Non-topology changes never rebuild WASM; non-geometry changes never request cable routing.
- Assignments, resource and slot IDs, placements, connections, route cache, private fields, Registry links, inventory identities, and project memberships must be preserved.
- Existing `.superpowers/` runtime files remain untouched.
- Update the structured unreleased release notes and `CHANGELOG.md`; do not bump the app version or deploy.
- Complete verification includes `bun run lint`, `bun run test`, `bun run build`, `bun run security:container`, and browser testing against the isolated `http://127.0.0.1:7899/` data copy.

---

### Task 1: Core Schema 28 Domain Revisions

**Files:**
- Modify: `server/persistence/core/schema/project-base.ts`
- Modify: `server/persistence/core/schema/projects.ts`
- Modify: `server/persistence/core/schema/inventory-metadata.ts`
- Create: `server/persistence/core/migrations/generated/0027_domain_persistence_revisions.sql`
- Modify: `server/persistence/core/migrations/manifest.ts`
- Modify: `server/persistence/core/schema/schema.bun_spec.ts`
- Modify: `server/persistence/sqlite/migrator.bun_spec.ts`
- Test: `server/persistence/core/schema/domain-revisions.bun_spec.ts`

**Interfaces:**
- Produces: `projects.workbookRevision`, `projectCompatibilityPolicies.revision`, and `inventoryItemMetadataRevisions` keyed by `itemId`.
- Preserves: `projects.revision` as the topology revision.

- [ ] **Step 1: Write schema tests that expect independent revision constraints**

```ts
expect(project.workbook_revision).toBeGreaterThan(0)
expect(policy.revision).toBeGreaterThan(0)
expect(metadataRevision).toEqual({ item_id: itemId, revision: 1 })
```

- [ ] **Step 2: Run the focused schema tests and verify they fail before migration 0028 exists**

```bash
bun test server/persistence/core/schema/domain-revisions.bun_spec.ts
```

- [ ] **Step 3: Add strict relational schema declarations and generated SQL**

```sql
ALTER TABLE projects ADD COLUMN workbook_revision INTEGER NOT NULL DEFAULT 1
  CHECK (workbook_revision > 0);
ALTER TABLE project_compatibility_policies ADD COLUMN revision INTEGER NOT NULL DEFAULT 1
  CHECK (revision > 0);
CREATE TABLE inventory_item_metadata_revisions (
  item_id INTEGER PRIMARY KEY NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at_ms INTEGER NOT NULL
) STRICT;
```

- [ ] **Step 4: Initialize workbook revisions deterministically and add the migration checksum to the immutable manifest**

```sql
UPDATE projects SET workbook_revision = revision;
INSERT INTO inventory_item_metadata_revisions (item_id, revision, updated_at_ms)
SELECT id, 1, updated_at_ms FROM inventory_items;
```

- [ ] **Step 5: Verify migration integrity, repeat startup, and unsupported-newer-schema rejection**

```bash
bun run db:migrations:check
bun test server/persistence/sqlite/migrator.bun_spec.ts server/persistence/core/schema/domain-revisions.bun_spec.ts
```

- [ ] **Step 6: Commit the schema boundary**

```bash
git add server/persistence/core/schema server/persistence/core/migrations
git commit -m "feat: separate persistence domain revisions"
```

### Task 2: Server Mutation Effects And Projection Classifiers

**Files:**
- Create: `server/persistence/mutation-effects.ts`
- Create: `server/persistence/mutation-effects.bun_spec.ts`
- Modify: `server/engine/snapshot.mjs`
- Modify: `server/engine/snapshot.test.mjs`
- Create: `src/types/domain-mutation.ts`

**Interfaces:**
- Produces: `MutationEffects`, `DomainMutationResult<T>`, `projectEngineTopologyProjection(project)`, and `classifyInventoryMutation(before, after, context)`.
- Consumes: canonical numeric project, workspace, inventory item, and connection IDs.

- [ ] **Step 1: Write a table-driven classifier test for every known property and mutation category**

```ts
expect(classifyInventoryMutation(before, { ...before, properties: { displayName: 'Edge' } }, context))
  .toMatchObject({ topology: false, geometry: null, presentation: { itemIds: [itemId] } })
expect(classifyInventoryMutation(before, rotated, context))
  .toMatchObject({ topology: false, geometry: { itemIds: [itemId] } })
expect(classifyInventoryMutation(before, withAddedPort, context).topology).toBe(true)
```

- [ ] **Step 2: Verify focused tests fail because the effect classifier is absent**

```bash
bun test server/persistence/mutation-effects.bun_spec.ts
```

- [ ] **Step 3: Extract a topology-only engine projector**

```js
export function createEngineTopology(project) {
  return { items: projectItems(project), assignments: ..., connections: ..., placements: ... }
}

export function createEngineSnapshot(project) {
  return { revision: project.revision, project_name: project.metadata.name, topology: createEngineTopology(project) }
}
```

- [ ] **Step 4: Implement exact effect normalization with sorted unique positive numeric IDs**

```ts
export type MutationEffects = Readonly<{
  topology: boolean
  geometry: GeometryMutationEffect | null
  compatibility: CompatibilityMutationEffect | null
  presentation: PresentationMutationEffect | null
}>
```

- [ ] **Step 5: Prove labels, metadata, policies, and display properties are topology-neutral while ports, power endpoints, assignments, connections, placements, and route intent are topology-relevant**

```bash
bun test server/persistence/mutation-effects.bun_spec.ts server/engine/snapshot.test.mjs
```

- [ ] **Step 6: Commit the effect contract**

```bash
git add server/persistence/mutation-effects.ts server/persistence/mutation-effects.bun_spec.ts server/engine src/types/domain-mutation.ts
git commit -m "feat: classify persistence mutation effects"
```

### Task 3: Independent Metadata Persistence And History

**Files:**
- Modify: `server/inventory-metadata/repository.mjs`
- Modify: `server/inventory-metadata/routes.mjs`
- Modify: `server/inventory-metadata/repository.bun_spec.mjs`
- Modify: `server/inventory-metadata/routes.test.mjs`
- Modify: `server/persistence/sqlite-store.ts`
- Modify: `server/persistence/sqlite-store.bun_spec.ts`
- Modify: `src/lib/inventory-metadata-api.ts`
- Modify: `src/types/inventory-metadata.ts`

**Interfaces:**
- Produces: metadata mutation envelopes containing metadata revision and `effects.topology === false`.
- Removes: `affectedProjectRevisions` from metadata responses.

- [ ] **Step 1: Write regression tests proving metadata replacement and history restore leave `projects.revision`, workspaces, assignments, connections, and route cache unchanged**

```ts
const before = invariantSnapshot(database)
const result = store.updateInventoryItemMetadata(ref, input)
expect(result.effects.topology).toBe(false)
expect(invariantSnapshot(database)).toEqual({ ...before, metadataRevision: before.metadataRevision + 1 })
```

- [ ] **Step 2: Run focused tests and verify the existing canonical revision behavior fails them**

```bash
bun test server/inventory-metadata server/persistence/sqlite-store.bun_spec.ts
```

- [ ] **Step 3: Move metadata writes into one item-metadata transaction with optimistic revision checks**

```js
replaceItemMetadata(itemId, input, { expectedRevision })
// Replace values/tags and increment inventory_item_metadata_revisions atomically.
```

- [ ] **Step 4: Return and validate the shared domain mutation envelope**

```ts
const itemMutationResponse = domainMutationResultSchema(inventoryItemMetadataSchema)
```

- [ ] **Step 5: Keep metadata SSE publication scoped to affected project IDs without canonical invalidation**

```bash
bun test server/inventory-metadata/routes.test.mjs server/inventory-metadata/repository.bun_spec.mjs
```

- [ ] **Step 6: Commit independent metadata persistence**

```bash
git add server/inventory-metadata server/persistence/sqlite-store.ts server/persistence/sqlite-store.bun_spec.ts src/lib/inventory-metadata-api.ts src/types
git commit -m "fix: isolate inventory metadata persistence"
```

### Task 4: Compatibility Policy And Audit State Channel

**Files:**
- Modify: `server/compatibility/routes.mjs`
- Modify: `server/compatibility/routes.test.mjs`
- Modify: `server/compatibility/audit-service.mjs`
- Modify: `server/compatibility/audit-service.bun_spec.ts`
- Modify: `server/persistence/sqlite-store.ts`
- Modify: `src/lib/compatibility-audit-api.ts`
- Modify: `src/hooks/use-compatibility-audit.ts`
- Modify: `src/lib/compatibility-policy.ts`
- Modify: `src/app/create-settings-dialog-props.ts`
- Modify: `src/app/create-workspace-surface-props.ts`
- Modify: `src/app/app.tsx`
- Modify: `src/components/inspector/equipment/server-inspector-tabs.tsx`
- Modify: `src/components/inspector/equipment/nas-inspector-tabs.tsx`
- Modify: `src/components/inspector/equipment/pc-build-inspector-tabs.tsx`

**Interfaces:**
- Produces: `updateCompatibilityPolicy(projectId, patch, expectedRevision)` and compatibility SSE invalidation.
- Removes: compatibility policy writes through whole-project `setProject`.

- [ ] **Step 1: Add route tests for host enablement, verified-memory policy, legacy warning ignore, and clearing ignored warnings**

```ts
expect(result.effects).toEqual({ topology: false, geometry: null, compatibility: { projectIds: [1], hostItemIds: [7] }, presentation: null })
expect(store.getEngineRevision()).toBe(beforeRevision)
```

- [ ] **Step 2: Verify the focused tests fail under whole-project persistence**

```bash
bun test server/compatibility/routes.test.mjs server/compatibility/audit-service.bun_spec.ts
```

- [ ] **Step 3: Implement revision-checked policy patching without replacing project topology collections**

```js
store.updateCompatibilityPolicy(projectId, {
  expectedRevision,
  disabledHosts,
  verifiedMemoryHosts,
  ignoredWarningIds,
})
```

- [ ] **Step 4: Replace all frontend `onUpdateProject(setHostCompatibility...)` and legacy ignore callbacks with the dedicated mutation**

- [ ] **Step 5: Verify policy SSE refreshes Systems, Inspector, Canvas audit badges, and the Audit drawer without engine or routing activity**

```bash
bun test server/compatibility src/hooks/use-compatibility-audit.test.tsx src/test/audit-drawer.test.tsx src/test/compatibility-workflows.test.ts
```

- [ ] **Step 6: Commit compatibility isolation**

```bash
git add server/compatibility server/persistence/sqlite-store.ts src/lib/compatibility-audit-api.ts src/hooks src/app src/components/inspector
git commit -m "fix: isolate compatibility policy persistence"
```

### Task 5: Workbook And Workspace Revision Separation

**Files:**
- Modify: `server/persistence/core/repositories/project-repository.ts`
- Modify: `server/persistence/core/repositories/repositories.bun_spec.ts`
- Modify: `server/persistence/sqlite-store.ts`
- Modify: `server/project-routes.mjs`
- Modify: `server/workspace-routes.mjs`
- Modify: `src/lib/workbook-api.ts`
- Modify: `src/app/use-workbook-controller.ts`
- Modify: `src/app/use-project-commands.ts`
- Modify: `src/test/project-patches.test.ts`
- Modify: `src/test/domain-engine-client.test.ts`

**Interfaces:**
- Produces: workbook mutations guarded by `workbookRevision`; workspace mutations guarded by `workspace.revision`.
- Retires: interactive `update-project-metadata` WASM commands.

- [ ] **Step 1: Write tests proving project name/description/icon and workspace appearance/order/default do not change `projects.revision`**

```ts
const topologyRevision = store.getEngineRevision()
store.updateProject(1, { name: 'Lab' })
expect(store.getEngineRevision()).toBe(topologyRevision)
expect(store.getProjectWorkbook(1).project.workbookRevision).toBeGreaterThan(1)
```

- [ ] **Step 2: Verify current project and workspace repository behavior fails the revision test**

```bash
bun test server/persistence/core/repositories/repositories.bun_spec.ts
```

- [ ] **Step 3: Move project presentation and workspace collection changes to workbook revision transactions**

- [ ] **Step 4: Keep `includesGlobalInventory` topology-aware because changing membership visibility changes engine items**

- [ ] **Step 5: Remove project-name mutation from WASM call sites while preserving engine snapshot compatibility at initialization**

```bash
bun test server/project-routes.test.mjs server/workspace-routes.test.mjs src/test/domain-engine-client.test.ts
```

- [ ] **Step 6: Commit workbook revision isolation**

```bash
git add server/persistence/core/repositories server/persistence/sqlite-store.ts server/project-routes.mjs server/workspace-routes.mjs src/lib/workbook-api.ts src/app src/test
git commit -m "fix: separate workbook and topology revisions"
```

### Task 6: Effect-Aware Inventory Definition And Property Writes

**Files:**
- Modify: `server/persistence/sqlite-store.ts`
- Modify: `server/inventory-routes.mjs`
- Modify: `server/inventory-routes.test.mjs`
- Modify: `server/persistence/sqlite-store.bun_spec.ts`
- Modify: `src/lib/db.ts`
- Modify: `src/app/use-inventory-lifecycle.ts`
- Modify: `src/lib/power-equipment-layout.ts`
- Modify: `src/lib/patch-panel.ts`
- Test: `src/test/inventory-mutation-effects.test.tsx`

**Interfaces:**
- Consumes: `classifyInventoryMutation` from Task 2.
- Produces: domain envelopes for `updateInventoryItem`, `updateInventoryItemProperties`, and catalog-applied item changes.

- [ ] **Step 1: Write tests for display name, notes, serial, manufacturer/model, orientation, endpoint row order, ports, power topology, and catalog merge effects**

```ts
expect(displayNameResult.effects.topology).toBe(false)
expect(displayNameResult.effects.geometry).toBeNull()
expect(orientationResult.effects.topology).toBe(false)
expect(orientationResult.effects.geometry?.itemIds).toEqual([itemId])
expect(portResult.effects.topology).toBe(true)
```

- [ ] **Step 2: Run focused tests and capture the existing unconditional canonical revision failures**

```bash
bun test server/inventory-routes.test.mjs server/persistence/sqlite-store.bun_spec.ts src/test/inventory-mutation-effects.test.tsx
```

- [ ] **Step 3: Apply inventory writes in one transaction, advancing `row_version` always and topology revision conditionally**

```ts
const beforeTopology = projectEngineTopologyProjection(beforeProject)
operation()
const effects = classifyInventoryMutation(beforeItem, afterItem, context)
if (effects.topology) bumpTopologyRevision()
```

- [ ] **Step 4: Publish inventory, compatibility, and targeted geometry events after commit**

- [ ] **Step 5: Apply the same effect classification to Registry updates without changing refresh-only behavior**

- [ ] **Step 6: Verify topology changes still synchronize WASM and descriptive changes do not**

```bash
bun test server/db/catalog-update-lifecycle.test.mjs server/persistence/sqlite-store.bun_spec.ts src/test/app-persistence.test.tsx
```

- [ ] **Step 7: Commit effect-aware inventory persistence**

```bash
git add server/persistence/sqlite-store.ts server/inventory-routes.mjs server/inventory-routes.test.mjs src/lib/db.ts src/app/use-inventory-lifecycle.ts src/test
git commit -m "fix: route inventory writes by mutation effect"
```

### Task 7: Frontend Domain Coordinator And Typed Undo/Redo

**Files:**
- Create: `src/lib/domain-persistence-coordinator.ts`
- Create: `src/lib/domain-persistence-coordinator.test.ts`
- Modify: `src/app/project-history-snapshot.ts`
- Modify: `src/app/use-project-history.ts`
- Modify: `src/app/use-project-history.test.tsx`
- Modify: `src/app/use-project-commands.ts`
- Modify: `src/app/use-project-save-queue.ts`
- Modify: `src/app/app.tsx`
- Modify: `src/engine/client.ts`

**Interfaces:**
- Produces: `applyDomainMutationResult`, typed `HistoryCommand`, and serialized per-domain persistence lanes.
- Consumes: `DomainMutationResult<T>` envelopes from Tasks 3–6.

- [ ] **Step 1: Write coordinator tests proving independent serialization and effect dispatch**

```ts
await coordinator.apply(metadataResult)
expect(engine.synchronizeCanonicalRevision).not.toHaveBeenCalled()
expect(routing.invalidate).not.toHaveBeenCalled()
await coordinator.apply(geometryResult)
expect(routing.invalidate).toHaveBeenCalledWith(geometryResult.effects.geometry)
```

- [ ] **Step 2: Write Undo/Redo tests for metadata, compatibility, workbook, geometry, and topology commands**

- [ ] **Step 3: Replace metadata-in-project snapshots with typed persisted history commands**

```ts
type HistoryCommand = {
  domain: PersistenceDomain
  label: string
  undo: DomainMutation
  redo: DomainMutation
}
```

- [ ] **Step 4: Preserve selection and network traces unless returned effects remove or change their topology records**

- [ ] **Step 5: Retain the canonical reload/rebuild recovery path only for topology conflicts**

```bash
bun test src/lib/domain-persistence-coordinator.test.ts src/app/use-project-history.test.tsx src/test/app-persistence.test.tsx
```

- [ ] **Step 6: Commit frontend domain coordination**

```bash
git add src/lib/domain-persistence-coordinator* src/app src/engine/client.ts src/test
git commit -m "refactor: coordinate persistence by domain"
```

### Task 8: Debounced Metadata Autosave UI

**Files:**
- Modify: `src/components/inventory-metadata/inventory-item-metadata-editor.tsx`
- Create: `src/components/inventory-metadata/use-inventory-metadata-autosave.ts`
- Create: `src/components/inventory-metadata/use-inventory-metadata-autosave.test.tsx`
- Modify: `src/lib/inventory-metadata-query.ts`
- Modify: `src/test/inventory-item-metadata-editor.test.tsx`
- Modify: `src/test/inspector-panel.test.tsx`

**Interfaces:**
- Produces: `useInventoryMetadataAutosave({ ref, initial, persist, recordHistory, debounceMs: 500 })`.
- Consumes: metadata domain mutations and the global history recorder.

- [ ] **Step 1: Write fake-timer tests for debounce, coalescing, serialized in-flight changes, no-op values, flush, error, Retry, and Undo registration**

```ts
await user.click(tag)
await vi.advanceTimersByTimeAsync(499)
expect(persist).not.toHaveBeenCalled()
await vi.advanceTimersByTimeAsync(1)
expect(persist).toHaveBeenCalledTimes(1)
```

- [ ] **Step 2: Verify tests fail with the explicit Save metadata workflow**

```bash
bun test src/components/inventory-metadata/use-inventory-metadata-autosave.test.tsx src/test/inventory-item-metadata-editor.test.tsx
```

- [ ] **Step 3: Implement the isolated autosave hook and flush on item/tab/Inspector teardown**

- [ ] **Step 4: Remove Save and Reset actions and render compact Saving, Saved, and Retry status**

- [ ] **Step 5: Prove metadata saves leave engine readiness, selection, topology revision, route requests, and canvas activity unchanged**

```bash
bun test src/components/inventory-metadata src/test/inspector-panel.test.tsx src/test/app-persistence.test.tsx
```

- [ ] **Step 6: Commit metadata autosave**

```bash
git add src/components/inventory-metadata src/lib/inventory-metadata-query.ts src/test
git commit -m "feat: autosave inventory metadata independently"
```

### Task 9: Geometry-Only Invalidation And Routing Guardrails

**Files:**
- Modify: `src/app/use-project-geometry-sync.ts`
- Modify: `src/components/canvas/use-cable-routing-controller.ts`
- Modify: `src/lib/cable-routing-coordinator.ts`
- Modify: `src/test/cable-routing-coordinator.test.ts`
- Modify: `src/test/canvas-node-dependencies.test.ts`
- Modify: `src/test/workspace-engine-tab-reactivation.test.tsx`

**Interfaces:**
- Consumes: geometry effect payloads and measured routing dependency fingerprints.
- Produces: targeted route invalidation independent of engine phase transitions.

- [ ] **Step 1: Add regression tests that engine ready/rebuild transitions with unchanged routing fingerprints dispatch zero planner requests**

- [ ] **Step 2: Add tests that orientation and endpoint-row changes reconsider only attached connections**

```ts
expect(planner.requests.map((request) => request.connectionId)).toEqual([affectedConnectionId])
```

- [ ] **Step 3: Remove engine-phase return-to-ready as an unconditional routing trigger**

- [ ] **Step 4: Reuse valid persisted route cache entries whenever layout and route fingerprints remain equal**

- [ ] **Step 5: Verify route failures preserve the last valid route and report the failure without fabricating a path**

```bash
bun test src/test/cable-routing-coordinator.test.ts src/test/canvas-node-dependencies.test.ts src/test/workspace-engine-tab-reactivation.test.tsx
```

- [ ] **Step 6: Commit routing isolation**

```bash
git add src/app/use-project-geometry-sync.ts src/components/canvas/use-cable-routing-controller.ts src/lib/cable-routing-coordinator.ts src/test
git commit -m "fix: route only changed canvas geometry"
```

### Task 10: Release Notes And Complete Automated Verification

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `src/release-notes.ts`
- Modify: `src/test/release-notes.test.ts`

**Interfaces:**
- Documents: metadata autosave, independent persistence revisions, Undo/Redo behavior, and reduced engine/routing work.

- [ ] **Step 1: Update Unreleased notes without changing `package.json` version**

```text
Custom metadata and tags now autosave with application-wide Undo/Redo while project presentation, compatibility policy, and descriptive inventory edits use independent persistence revisions that do not rebuild the workspace engine or reroute unchanged cables.
```

- [ ] **Step 2: Run release-note and migration validation**

```bash
bun run release-notes:check
bun run db:migrations:check
```

- [ ] **Step 3: Run lint and all tests**

```bash
bun run lint
bun run test
```

- [ ] **Step 4: Build production assets**

```bash
bun run build
```

- [ ] **Step 5: Build, boot, and scan both final distroless architectures**

```bash
bun run security:container
```

- [ ] **Step 6: Commit documentation and verification fixes**

```bash
git add CHANGELOG.md src/release-notes.ts src/test/release-notes.test.ts
git commit -m "docs: describe independent persistence domains"
```

### Task 11: Isolated 7899 End-To-End Verification

**Files:**
- Create: `artifacts/domain-persistence-7899-verification.md`
- Do not commit: screenshots, copied runtime data, browser traces, or private values.

**Interfaces:**
- Consumes: the exact local candidate image and isolated copied data directory.
- Produces: a sanitized pass/fail evidence report without private inventory values.

- [ ] **Step 1: Record invariant counts and hashes from the isolated dataset, then rebuild and restart the 7899 candidate**

```bash
docker inspect homelab-inventory-wyse-fix-validation --format '{{.Id}} {{.State.StartedAt}}'
curl -fsS http://127.0.0.1:7899/api/health
```

- [ ] **Step 2: Verify automatic schema-28 migration, restart idempotency, health, and rollback artifact presence**

- [ ] **Step 3: Browser-test metadata autosave for tags and every custom-field type, including coalescing, flush, Retry, Undo, and Redo**

- [ ] **Step 4: Browser-test compatibility enablement, verified-memory policy, ignore/unignore, and clear ignored warnings**

- [ ] **Step 5: Browser-test project name/description/icon and workspace name/icon/color/order/default**

- [ ] **Step 6: Browser-test display name, notes, serial, orientation, patch-panel order, and UPS outlet order**

- [ ] **Step 7: Browser-test a true port/topology edit, assignment, placement, connection, route-side change, and bend reset**

- [ ] **Step 8: Browser-test catalog refresh and one controlled local linked-template update without publishing or contacting production**

- [ ] **Step 9: For every workflow inspect SSE, HTTP requests, console activity, engine phase/revision, routing activity, selection, and route cache; confirm only declared effects occur**

- [ ] **Step 10: Repeat relevant workflows at desktop and mobile widths and verify no console errors**

- [ ] **Step 11: Restart the candidate and prove all persisted states and invariants remain stable**

- [ ] **Step 12: Write the sanitized verification report and leave the candidate running at `http://127.0.0.1:7899/`**

```bash
git status --short
```
