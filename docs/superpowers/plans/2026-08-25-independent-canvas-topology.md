# Independent Canvas Topology Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every canvas independent hardware assignments, cable connections,
compatibility state, inventory availability, and Systems projections while
preserving all existing inventory and workspace configurations automatically.

**Architecture:** Canonical physical inventory remains project-bound by default;
canvas topology relationships gain composite project/workspace ownership and
workspace-scoped uniqueness. An atomic startup migration preserves original IDs
on the primary canvas, materializes independent copies on other existing
canvases, repairs accidental global inventory, and keeps read models, mutation
paths, Registry updates, backups, sharing, and SSE aligned.

**Tech Stack:** Bun, TypeScript, React 19, SQLite via `bun:sqlite`, Drizzle ORM,
Vitest, Bun test, Express, TanStack Table, existing Rust/WASM engine, existing
SSE infrastructure.

## Global Constraints

- Follow `docs/superpowers/specs/2026-08-25-independent-canvas-topology-design.md`.
- Keep every persisted primary/foreign key a positive safe integer.
- Preserve existing runtime `InventoryItem.id` and add canonical `inventoryId`.
- Never silently mutate another canvas's assignments, ports, cables, or routes.
- Existing fixed-component definitions remain canonical, locked projections.
- New inventory defaults to project-bound; explicitly shared inventory remains global.
- Existing single-membership global items become project-bound automatically.
- Preserve Registry links, installation/account identities, shares, agents, telemetry,
  placements, connections, route cache, metadata, private fields, and legacy aliases.
- Startup migration must create a verified backup and restore it automatically on failure.
- Use scoped SSE invalidation; do not introduce client polling.
- Do not bump `package.json`, create tags, push, publish, or deploy.
- Update structured unreleased release notes and `CHANGELOG.md`.
- Remove task-created temporary data, build outputs, and Docker cache before completion.
- Preserve every Docker volume unless separately authorized.

---

### Task 1: Reproduce the cross-canvas data-loss and inventory-scope defects

**Files:**
- Create: `server/persistence/core/schema/workspace-topology.bun_spec.ts`
- Modify: `server/persistence/migration/core-importer.bun_spec.ts`
- Modify: `src/test/project.test.ts`
- Modify: `src/test/app-return-to-inventory.test.tsx`

**Interfaces:**
- Consumes: `buildLegacyProjectProjection({ database, projectId, workspaceId })`.
- Produces: deterministic two-canvas fixtures and failing preservation assertions.

- [ ] Add one host, six installed components, two canvas placements, and a cable;
  assert removing the host from workspace `3` leaves workspace `2` unchanged:

```ts
expect(originalAfter.assignments).toEqual(originalBefore.assignments)
expect(originalAfter.connections).toEqual(originalBefore.connections)
expect(originalAfter.placements).toEqual(originalBefore.placements)
expect(secondaryAfter.placements).not.toContainEqual(
  expect.objectContaining({ serverId: 'server:7' }),
)
```

- [ ] Add migration assertions requiring `scope: 'project', ownerProjectId: 1`
  for imported legacy hosts and components.
- [ ] Run `bun test server/persistence/core/schema/workspace-topology.bun_spec.ts`
  and `bunx vitest run src/test/project.test.ts src/test/app-return-to-inventory.test.tsx`;
  confirm the targeted cross-canvas/scope expectations fail against existing code.
- [ ] Keep fixtures isolated and clean each temporary database after the test.

### Task 2: Define workspace-owned topology and audit schema

**Files:**
- Modify: `server/persistence/core/schema/topology.ts`
- Modify: `server/persistence/core/schema/routing.ts`
- Modify: `server/persistence/core/schema/audits.ts`
- Modify: `server/persistence/core/schema/systems.ts`
- Modify: `server/persistence/core/schema/topology.bun_spec.ts`
- Modify: `server/persistence/core/schema/schema.bun_spec.ts`

**Interfaces:**
- Consumes: `workspaces.projectId`, `workspaces.id`, canonical inventory/resource IDs.
- Produces: `componentAssignments.workspaceId`, `componentAssignmentSlots.workspaceId`,
  `projectConnections.workspaceId`, `connectionEndpoints.workspaceId`, workspace-scoped
  compatibility and Systems attention records.

- [ ] Add assertions proving the same component/resource slot/port can be occupied
  once in workspace `2` and once in workspace `3`, but not twice in either:

```ts
expect(assign({ projectId: 1, workspaceId: 2, componentItemId: 28 })).toBeDefined()
expect(assign({ projectId: 1, workspaceId: 3, componentItemId: 28 })).toBeDefined()
expect(() => assign({ projectId: 1, workspaceId: 3, componentItemId: 28 })).toThrow()
```

- [ ] Add non-null workspace IDs, composite ownership foreign keys, scoped indexes,
  and uniqueness constraints without changing canonical inventory or slot IDs.
- [ ] Ensure routing/visibility/bends/cache can reference only connections from
  their own project and workspace.
- [ ] Run `bun test server/persistence/core/schema/topology.bun_spec.ts`.

### Task 3: Create and verify the automatic SQLite migration

**Files:**
- Create: `server/persistence/core/migrations/generated/0031_workspace_owned_topology.sql`
- Modify: `server/persistence/core/migrations/manifest.ts`
- Modify: `server/persistence/core/schema/workspace-topology.bun_spec.ts`
- Modify: `server/persistence/core/schema/schema.bun_spec.ts`
- Modify: `server/persistence/migration/cutover.bun_spec.ts`

**Interfaces:**
- Consumes: pre-migration schema `31`, active projects/workspaces, placements,
  assignments, endpoints, routes, visibility, findings, and memberships.
- Produces: ordered migration `0032_workspace_owned_topology`, schema `32`,
  unchanged primary assignment/cable IDs and deterministic secondary copies.

- [ ] Seed schema `31` with a primary and secondary canvas and assert migration
  preserves primary IDs while copying only hosts/endpoints represented on the
  second canvas:

```ts
expect(assignments(2).map(({ id }) => id)).toEqual([4, 5, 6])
expect(assignments(3).map(({ component_item_id }) => component_item_id))
  .toEqual([48, 98, 28])
expect(database.query('PRAGMA foreign_key_check').all()).toEqual([])
```

- [ ] Convert exactly single-membership global items to their owning project;
  leave zero-membership and multi-project global inventory untouched.
- [ ] Rebuild related tables transactionally, preserve routes/bends/findings,
  and refuse ambiguous endpoint-to-host ownership.
- [ ] Compute the migration SHA-256 and add it to the ordered manifest.
- [ ] Run `bun run db:migrations:check`, the targeted migration tests, and repeat
  the migration to verify a zero-change second execution.

### Task 4: Correct inventory creation and expose canonical IDs

**Files:**
- Modify: `server/persistence/migration/core-importer.ts`
- Modify: `server/persistence/migration/core-importer.bun_spec.ts`
- Modify: `server/persistence/core/repositories/inventory-repository.ts`
- Modify: `server/persistence/core/repositories/repositories.bun_spec.ts`
- Modify: `server/persistence/sqlite-store.ts`
- Modify: `server/persistence/core/projections/legacy-project.ts`
- Modify: `src/types/inventory.ts`

**Interfaces:**
- Consumes: active project ID, existing legacy aliases, explicit requested scope.
- Produces: `InventoryItem.inventoryId?: number`, project-bound default creation,
  unchanged `InventoryItem.id` and runtime `type:id` keys.

- [ ] Add a fixture where canonical ID `48` differs from category legacy ID `2`:

```ts
expect(item).toMatchObject({ id: 2, inventoryId: 48, scope: 'project', ownerProjectId: 1 })
expect(item.key).toBe('ram:2')
```

- [ ] Change legacy import, manual creation, duplication, onboarding, and Registry
  import defaults to explicit active-project ownership while preserving explicit
  `scope: 'global'` calls.
- [ ] Add `inventoryId: row.id` to the additive legacy projection contract.
- [ ] Run focused importer, repository, SQLite-store, and runtime projection tests.

### Task 5: Scope read models and topology repositories by workspace

**Files:**
- Modify: `server/persistence/core/projections/legacy-project.ts`
- Modify: `server/persistence/core/read-model/workspace-read-model.ts`
- Modify: `server/persistence/core/read-model/workspace-read-model.bun_spec.ts`
- Modify: `server/persistence/core/repositories/topology-repository.ts`
- Modify: `server/persistence/core/repositories/routing-repository.ts`
- Modify: `server/persistence/core/repositories/repositories.bun_spec.ts`

**Interfaces:**
- Consumes: `projectId: number`, `workspaceId: number`.
- Produces: `listAssignments(projectId, workspaceId)`,
  `assignComponent({ projectId, workspaceId, hostItemId, componentItemId, resourceSlotId })`,
  `unassignComponent(projectId, workspaceId, assignmentId)`,
  `createConnection({ projectId, workspaceId, ... })`,
  `removeConnection(projectId, workspaceId, connectionId)`,
  `portAvailability(projectId, workspaceId, portId, endpointFaceId)`.

- [ ] Assert projections for the same host return distinct assignment/cable sets:

```ts
expect(buildLegacyProjectProjection({ database, projectId: 1, workspaceId: 2 })
  .assignments.map(({ itemId }) => itemId)).toEqual(['cpu:1'])
expect(buildLegacyProjectProjection({ database, projectId: 1, workspaceId: 3 })
  .assignments.map(({ itemId }) => itemId)).toEqual(['cpu:2'])
```

- [ ] Require project/workspace predicates in every assignment, endpoint,
  connection, cache, and repository mutation.
- [ ] Preserve revision-scoped read-model cache behavior and reject mismatched
  project/workspace relationships.
- [ ] Run `bun test server/persistence/core/read-model/workspace-read-model.bun_spec.ts server/persistence/core/repositories/repositories.bun_spec.ts`.

### Task 6: Remove project-wide deletion paths from the runtime store and engine

**Files:**
- Modify: `server/persistence/sqlite-store.ts`
- Modify: `server/persistence/sqlite-store.bun_spec.ts`
- Modify: `server/engine/command-service.mjs`
- Modify: `server/engine/command-service.test.mjs`
- Modify: `server/engine-routes.mjs`
- Modify: `server/engine-routes.test.mjs`
- Modify: `server/project-routes.mjs`
- Modify: `server/project-routes.test.mjs`
- Modify: `src/app/use-canvas-equipment-lifecycle.ts`
- Modify: `src/lib/project.ts`
- Modify: `src/test/project.test.ts`
- Modify: `src/test/app-return-to-inventory.test.tsx`

**Interfaces:**
- Consumes: route scope `{ projectId, workspaceId }` and scoped read models.
- Produces: workspace-only save/patch/deletion/assignment/connection operations.

- [ ] Assert all destructive SQL includes workspace ownership:

```ts
await returnHost({ projectId: 1, workspaceId: 3, hostItemId: 7 })
expect(assignments({ projectId: 1, workspaceId: 2 })).toHaveLength(6)
expect(connections({ projectId: 1, workspaceId: 2 })).toHaveLength(2)
expect(assignments({ projectId: 1, workspaceId: 3 })).toHaveLength(0)
```

- [ ] Scope replacement, persistence snapshots, engine patches, removals, port
  availability, Registry resolution, inventory dependency previews, undo/redo,
  canvas archive, and project deletion appropriately.
- [ ] Keep actual physical inventory deletion cross-canvas and explicit.
- [ ] Run focused engine, route, store, project, and app-return tests.

### Task 7: Make compatibility and attention projections canvas-specific

**Files:**
- Modify: `server/compatibility/audit-service.mjs`
- Modify: `server/compatibility/audit-service.bun_spec.ts`
- Modify: `server/compatibility/routes.mjs`
- Modify: `server/compatibility/routes.test.mjs`
- Modify: `server/systems/attention-projector.mjs`
- Modify: `server/systems/attention-projector.bun_spec.ts`
- Modify: `server/registry/catalog-update-resolution.mjs`
- Modify: `server/registry/catalog-update-resolution.test.mjs`

**Interfaces:**
- Consumes: `{ projectId, workspaceId, hostItemId }` and scoped assignments.
- Produces: isolated dirty-host queues, findings, ignores, attention summaries,
  and all-canvas Registry update validation.

- [ ] Assert compatible CPU on workspace `2` and incompatible CPU on workspace
  `3` produce findings only in workspace `3`:

```ts
expect(service.findings(store, { projectId: 1, workspaceId: 2 })).toEqual([])
expect(service.findings(store, { projectId: 1, workspaceId: 3 })).toEqual([
  expect.objectContaining({ hostItemId: 7, classification: 'actionable' }),
])
```

- [ ] Mark every affected canvas dirty when a canonical host/component or Registry
  template changes, and only the active canvas when local topology changes.
- [ ] Preserve project-wide policies and canvas-local ignored findings.
- [ ] Run focused compatibility, Registry-resolution, and attention tests.

### Task 8: Add canonical inventory ID display and sidebar search

**Files:**
- Modify: `src/components/inspector/inspector-panel.tsx`
- Modify: `src/components/inspector/inspector-contract.ts`
- Modify: `src/components/inventory-sidebar.tsx`
- Modify: `src/lib/sort.ts`
- Modify: `src/test/inspector-panel.test.tsx`
- Modify: `src/test/sort.test.ts`

**Interfaces:**
- Consumes: additive `InventoryItem.inventoryId` and canonical project items.
- Produces: accessible copied canonical IDs and exact `#48` / `48` matching.

- [ ] Add React tests proving category legacy ID `2` renders `Inventory ID 48`:

```ts
expect(screen.getByText('#48')).toBeInTheDocument()
await user.click(screen.getByRole('button', { name: 'Copy inventory ID' }))
expect(navigator.clipboard.writeText).toHaveBeenCalledWith('48')
```

- [ ] Add exact-match search tests for `#48`, `48`, and unchanged name/model search.
- [ ] Compute component availability using the active canvas assignments only.
- [ ] Run focused inspector, inventory sorting, and sidebar tests.

### Task 9: Add Systems canvas selection and scoped projections

**Files:**
- Modify: `server/systems/read-service.mjs`
- Modify: `server/systems/read-service.bun_spec.ts`
- Modify: `server/systems/routes.mjs`
- Modify: `server/systems/routes.test.mjs`
- Modify: `server/systems/saved-view-service.mjs`
- Modify: `server/systems/saved-view-service.bun_spec.ts`
- Modify: `src/components/workbook/systems-workspace.tsx`
- Modify: `src/components/workbook/systems/systems-toolbar.tsx`
- Modify: `src/components/workbook/systems/systems-table-model.ts`
- Modify: `src/components/workbook/systems-workspace.test.tsx`
- Modify: `src/lib/systems-preferences.ts`

**Interfaces:**
- Consumes: `canvasWorkspaceId?: number | null`; `null` means `All systems`.
- Produces: scoped server snapshots, host filtering, saved-view canvas filters,
  and default-canvas configuration for `All systems`.

- [ ] Seed one host placed only on workspace `2`, another placed only on workspace
  `3`, and assert:

```ts
expect(service.initial(store, 1, origin, { canvasWorkspaceId: null }).systems).toHaveLength(2)
expect(service.initial(store, 1, origin, { canvasWorkspaceId: 3 }).systems)
  .toEqual([expect.objectContaining({ itemKey: 'server:7' })])
```

- [ ] Add the `All systems` / canvas selector; persist it in existing project and
  saved-view preferences and fall back safely when a canvas disappears.
- [ ] Resolve CPU, RAM, storage, compatibility, and attention using the selected
  canvas while leaving agent and Registry projections canonical.
- [ ] Verify bounded query count and run focused Systems/backend/frontend tests.

### Task 10: Copy host configuration between canvases

**Files:**
- Create: `server/persistence/core/topology/workspace-configuration-service.ts`
- Create: `server/persistence/core/topology/workspace-configuration-service.bun_spec.ts`
- Create: `src/components/copy-canvas-configuration-dialog.tsx`
- Create: `src/test/copy-canvas-configuration-dialog.test.tsx`
- Modify: `server/project-routes.mjs`
- Modify: `server/project-routes.test.mjs`
- Modify: `src/components/inspector/inspector-panel.tsx`
- Modify: `src/app/app-dialogs.tsx`
- Modify: `src/app/create-lifecycle-dialog-props.ts`

**Interfaces:**
- Consumes: `{ projectId, sourceWorkspaceId, targetWorkspaceId, hostItemId,
  includeConnections }`.
- Produces: `previewWorkspaceConfigurationCopy(input)` and
  `copyWorkspaceConfiguration(input)` returning copied IDs, skipped conflicts,
  destination revision, and one atomic history entry.

- [ ] Assert source CPU/RAM IDs are retained as canonical IDs while assignment IDs
  differ; include cables only when explicitly requested and endpoints exist:

```ts
expect(result.assignmentIds).toHaveLength(2)
expect(result.connectionIds).toEqual([])
expect(assignedComponents(3)).toEqual([28, 48])
expect(assignedComponents(2)).toEqual([28, 48])
```

- [ ] Reject slot occupancy, incompatible hardware, foreign-project workspaces,
  unavailable endpoints, and fixed-component replacement atomically.
- [ ] Render source selector, checked components option, unchecked cables option,
  and deterministic impact preview using existing dialog controls.
- [ ] Run the focused Bun service, HTTP route, and React dialog suites.

### Task 11: Isolate LabGD shares, backups, Registry updates, and SSE

**Files:**
- Modify: `server/sharing/source-provider.mjs`
- Modify: `server/sharing/share-projector.test.mjs`
- Modify: `server/backup/sqlite-backup.bun_spec.ts`
- Modify: `server/live-events/topics.mjs`
- Modify: `server/live-events/topics.test.mjs`
- Modify: `server/live-events/sse-hub.test.mjs`
- Modify: `src/app/use-project-history.ts`
- Modify: `src/app/use-project-history.test.tsx`

**Interfaces:**
- Consumes: selected workspace ID and canonical shared item/telemetry identity.
- Produces: workspace-isolated LabGD payloads, compatible backups, scoped SSE,
  and canvas-local undo/redo restoration.

- [ ] Share workspace `2` while workspace `3` uses a different CPU/cable; assert:

```ts
expect(sharedCanvas.connections.map(({ id }) => id)).toEqual([workspaceTwoCableId])
expect(sharedCanvas.connections).not.toContainEqual(
  expect.objectContaining({ id: workspaceThreeCableId }),
)
```

- [ ] Resolve shared resource snapshots against the selected canvas and ensure
  route cache follows only that workspace's connections.
- [ ] Add authorization-checked scoped live topics or include workspace revisions
  in existing permitted topics without adding HTTP polling.
- [ ] Verify full/selective backup and restore keep all canvas relationship IDs.
- [ ] Run focused sharing, backup, SSE, and undo/redo tests.

### Task 12: Document, validate, and clean the completed feature

**Files:**
- Modify: `src/release-notes.ts`
- Modify: `CHANGELOG.md`
- Modify: relevant tests discovered during complete regression execution.

**Interfaces:**
- Consumes: complete workspace-owned topology and schema `32`.
- Produces: unreleased human-readable documentation and clean verified worktree.

- [ ] Add release-note entries for independent canvas configurations, safe
  inventory return, project-bound defaults, ID search, Systems filtering, and
  host configuration copying without changing `package.json` version.
- [ ] Run:

```bash
bun run db:migrations:check
bun run lint
bun run test
bun run build
bun run security:container
```

- [ ] Run a realistic two-canvas end-to-end test on an isolated production-data
  copy, proving host removal in one canvas changes no other canvas.
- [ ] Verify migration twice, selective backup/restore, Registry update safety,
  LabGD selected-canvas payload isolation, and fixed host components.
- [ ] Remove task-created database copies, temporary servers, Docker candidates,
  scanner caches, Rust targets, Vite cache, obsolete build output, and temporary
  screenshots while preserving every Docker volume.
- [ ] Report tests, migration version, remaining worktree state, and disk cleanup;
  do not publish or deploy.
