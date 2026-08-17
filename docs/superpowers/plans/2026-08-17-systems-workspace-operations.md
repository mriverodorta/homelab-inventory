# Systems Workspace Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Systems workspace into a scalable fleet view with synchronized saved views, configurable and virtualized columns, keyboard navigation, and cached per-host attention triage.

**Architecture:** Keep the existing compact initial/live Systems read model and extend it with materialized Attention summaries and optional host fields. Persist saved views and Attention projections in normalized core SQLite tables, expose project-scoped APIs, and use TanStack Table plus TanStack Virtual for browser state and rendering without evaluating host assemblies in list requests.

**Tech Stack:** Bun, TypeScript, bun:sqlite, Drizzle schema declarations, Express, React, TanStack Query, TanStack Table, TanStack Virtual, shadcn/ui, Vitest, Bun test.

## Global Constraints

- Type and Name are mandatory, visible, pinned left, and ordered first.
- Search text and pixel column widths never enter server persistence.
- Saved views are private per authenticated account or installation-wide in open mode.
- Open-mode views transfer atomically to the administrator who enables authentication.
- Agent stale/offline and update availability qualify a host for Needs Attention but do not increase the Attention count.
- Systems list requests read materialized Attention summaries and never run compatibility or notification evaluation per row.
- Previous valid Attention results remain readable during refresh or failure.
- Persist every primary and foreign key as a positive safe integer.
- Preserve inventory, projects, workspaces, assignments, placements, cables, routing cache, registry enrollment, and telemetry through migration.
- Update `CHANGELOG.md` and `src/release-notes.ts`; do not bump the application version.

---

### Task 1: Add Relational Systems Operations Schema

**Files:**
- Create: `server/persistence/core/migrations/generated/0019_systems_workspace_operations.sql`
- Create: `server/persistence/core/schema/systems.ts`
- Modify: `server/persistence/core/migrations/manifest.ts`
- Modify: `server/persistence/core/schema/index.ts`
- Modify: `server/persistence/core/schema/schema.bun_spec.ts`

**Interfaces:**
- Produces: normalized `systems_saved_views`, `systems_saved_view_filters`, `systems_saved_view_columns`, `system_attention_summaries`, `system_attention_findings`, and `system_attention_dirty_hosts` tables.
- Produces: Drizzle exports with the same camel-cased names for repository tasks.

- [ ] **Step 1: Write schema tests that expect migration 0020 and enforce relational constraints**

```ts
expect(CORE_MIGRATIONS).toHaveLength(20)
expect(CORE_MIGRATIONS.at(-1)?.id).toBe('0020_systems_workspace_operations')
expect(() => database.query(`INSERT INTO systems_saved_views (...) VALUES (...)`).run(...)).toThrow()
```

- [ ] **Step 2: Run the focused schema tests and confirm they fail**

Run: `bun test server/persistence/core/schema/schema.bun_spec.ts`

Expected: FAIL because migration 0020 and its tables do not exist.

- [ ] **Step 3: Add the transactional SQL migration and Drizzle declarations**

The migration must use positive integer checks, project/account foreign keys, case-insensitive owner/project name uniqueness, one-default partial indexes for account and open owners, enumerated checks, unique filter values, unique column keys/orders, and an initial dirty-host backfill:

```sql
INSERT INTO system_attention_dirty_hosts (project_id, host_type, host_id, reason, created_at_ms)
SELECT DISTINCT p.id, t.key, i.id, 'migration-backfill', unixepoch('subsec') * 1000
FROM projects p
JOIN inventory_items i ON i.archived_at_ms IS NULL
JOIN inventory_item_types t ON t.id = i.type_id AND t.key IN ('server', 'nas', 'pcBuild')
LEFT JOIN project_inventory_memberships m ON m.project_id = p.id AND m.item_id = i.id
WHERE p.archived_at_ms IS NULL AND (i.owner_project_id = p.id OR m.id IS NOT NULL);
```

- [ ] **Step 4: Generate and record the migration SHA-256, then run schema tests**

Run: `shasum -a 256 server/persistence/core/migrations/generated/0019_systems_workspace_operations.sql`

Run: `bun test server/persistence/core/schema/schema.bun_spec.ts server/persistence/sqlite/migrator.bun_spec.ts`

Expected: PASS, including restart idempotency and foreign-key checks.

- [ ] **Step 5: Commit the schema slice**

```bash
git add server/persistence/core/migrations server/persistence/core/schema
git commit -m "feat: add systems operations schema"
```

### Task 2: Implement Saved View Repository And Ownership

**Files:**
- Create: `server/persistence/core/repositories/systems-repository.ts`
- Create: `server/systems/saved-view-service.mjs`
- Modify: `server/persistence/core/repositories/index.ts`
- Modify: `server/persistence/core/repositories/repositories.bun_spec.ts`
- Create: `server/systems/saved-view-service.bun_spec.ts`

**Interfaces:**
- Produces: `createSystemsRepository(context)` with `listSavedViews`, `createSavedView`, `replaceSavedView`, `deleteSavedView`, `setDefaultSavedView`, and `transferOpenViewsToAccount`.
- Produces: `SystemsSavedViewService` methods accepting `{ projectId, accountId, input }`; `accountId: null` resolves open ownership.

- [ ] **Step 1: Add failing ownership, uniqueness, revision-conflict, and normalization tests**

```ts
expect(service.list(store, { projectId: 1, accountId: 7 })).toEqual([])
await expect(service.replace(store, { projectId: 1, accountId: 7, viewId, expectedRevision: 1, input }))
  .rejects.toMatchObject({ code: 'systems-view-conflict', status: 409 })
```

Tests must prove Type and Name cannot be hidden/reordered, names are case-insensitively unique, only one default exists, and `query`/pixel widths are rejected or omitted.

- [ ] **Step 2: Run focused tests and confirm missing repository/service failures**

Run: `bun test server/persistence/core/repositories/repositories.bun_spec.ts server/systems/saved-view-service.bun_spec.ts`

Expected: FAIL because the repository and service do not exist.

- [ ] **Step 3: Implement normalized transaction-backed CRUD**

Use a canonical configuration shape:

```ts
type SavedViewConfiguration = {
  types: SystemsHostType[]
  registrations: ('registered' | 'unregistered')[]
  registryStates: ('linked' | 'unlinked')[]
  sortKey: SystemsColumnKey
  sortDirection: 'ascending' | 'descending'
  density: 'dense' | 'comfortable'
  columns: { key: SystemsColumnKey; visible: boolean; order: number }[]
}
```

Every mutation runs in one SQLite transaction and updates `revision = revision + 1` only after matching the expected revision.

- [ ] **Step 4: Run focused tests and confirm they pass**

Run: `bun test server/persistence/core/repositories/repositories.bun_spec.ts server/systems/saved-view-service.bun_spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit saved-view persistence**

```bash
git add server/persistence/core/repositories server/systems/saved-view-service*
git commit -m "feat: persist systems saved views"
```

### Task 3: Expose Saved View APIs And Authentication Transfer

**Files:**
- Modify: `server/systems/routes.mjs`
- Modify: `server/systems/routes.test.mjs`
- Modify: `server/auth/api-permissions.mjs`
- Modify: `server/auth/auth-service.mjs`
- Modify: `server/auth/auth-service.test.mjs`
- Modify: `server/index.mjs`

**Interfaces:**
- Consumes: `SystemsSavedViewService` from Task 2.
- Produces: project-scoped GET/POST/PATCH/DELETE/default endpoints with ETags and 409 conflict codes.

- [ ] **Step 1: Add failing HTTP contract tests**

Cover authenticated and open ownership, ETag/304 list behavior, create/update/delete/default, duplicate-name 409, revision 409, and forbidden cross-account access.

- [ ] **Step 2: Add failing authentication transition test**

The test enables authentication as the initial administrator and asserts open-owned rows become account-owned in the same transaction boundary before the settings update is reported successful.

- [ ] **Step 3: Implement route validation, status mapping, and permission classification**

Use JSON bodies with `expectedRevision` on update/delete/default and return:

```json
{ "message": "This saved view changed in another session.", "code": "systems-view-conflict" }
```

- [ ] **Step 4: Wire open-view transfer into authentication enablement**

Invoke `transferOpenViewsToAccount(ownerId)` before committing the first enabled authentication mode; a failure aborts mode activation.

- [ ] **Step 5: Run route and authentication tests**

Run: `bun test server/systems/routes.test.mjs server/auth/auth-service.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit API and transfer behavior**

```bash
git add server/systems server/auth server/index.mjs
git commit -m "feat: expose synchronized systems views"
```

### Task 4: Build The Materialized Attention Projection

**Files:**
- Create: `server/systems/attention-repository.ts`
- Create: `server/systems/attention-projector.mjs`
- Create: `server/systems/attention-projector.bun_spec.ts`
- Modify: `server/persistence/core/repositories/systems-repository.ts`
- Modify: `server/persistence/core/repositories/repositories.bun_spec.ts`

**Interfaces:**
- Produces: `markHostDirty`, `markHostsForItemDirty`, `claimDirtyHosts(limit)`, `replaceAttentionProjection`, `listAttentionSummaries`, and `getAttentionDetails`.
- Produces: `SystemAttentionProjector.reconcile(store, { limit: 25 })` and `details(store, projectId, hostType, hostId)`.

- [ ] **Step 1: Add failing projection tests for all approved sources**

Fixtures must include pending/blocked Registry evaluations, unresolved compatibility findings on host and assigned components, open notification incidents, agent-only states, refresh failure, and unchanged fingerprints.

- [ ] **Step 2: Run focused tests and confirm missing projector failures**

Run: `bun test server/systems/attention-projector.bun_spec.ts`

Expected: FAIL.

- [ ] **Step 3: Implement bounded dirty-host reconciliation**

Build a deterministic input fingerprint from relevant relational rows. Skip evaluation when it matches the current summary. During replacement, retain the old rows until a transaction atomically writes the new summary and findings. On exceptions set state `failed` without deleting prior findings.

- [ ] **Step 4: Prove no N+1 and stale-result behavior**

Instrument the audit evaluator in tests and assert one evaluation per dirty changed host, zero for unchanged hosts, and no evaluation from summary reads.

- [ ] **Step 5: Run focused tests and commit**

Run: `bun test server/systems/attention-projector.bun_spec.ts server/persistence/core/repositories/repositories.bun_spec.ts`

```bash
git add server/systems/attention-* server/persistence/core/repositories
git commit -m "feat: materialize system attention"
```

### Task 5: Integrate Attention Invalidation And Read APIs

**Files:**
- Modify: `server/persistence/sqlite-store.ts`
- Modify: `server/registry-routes.mjs`
- Modify: `server/notifications/notification-evaluator.mjs`
- Modify: `server/systems/read-service.mjs`
- Modify: `server/systems/read-service.bun_spec.ts`
- Modify: `server/systems/routes.mjs`
- Modify: `server/systems/routes.test.mjs`
- Modify: `server/index.mjs`

**Interfaces:**
- Consumes: projection APIs from Task 4.
- Produces: initial rows with `operatingSystem`, `lanIp`, and Attention count; live rows with `uptimeSeconds`, `attentionCount`, `attentionState`, and `attentionRevision`.
- Produces: `GET /api/projects/:projectId/systems/:hostType/:hostId/attention` with ETag support.

- [ ] **Step 1: Add failing read-model and detail-route tests**

Assert list payloads contain only summary fields, detail payloads contain grouped findings, 304 works, and no projection evaluation occurs in either request.

- [ ] **Step 2: Add failing invalidation tests**

Assert inventory/assignment changes dirty only affected assemblies; Registry and notification transitions dirty all and only related hosts.

- [ ] **Step 3: Implement compact reads and invalidation hooks**

Keep full findings out of Systems initial/live payloads. Reconcile a bounded batch after commits or on the existing server maintenance loop; list reads continue serving persisted values while work remains queued.

- [ ] **Step 4: Run backend Systems, Registry, notification, and store tests**

Run: `bun test server/systems server/registry-routes.test.mjs server/notifications server/persistence/sqlite-store.bun_spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit backend integration**

```bash
git add server/persistence/sqlite-store.ts server/registry-routes.mjs server/notifications server/systems server/index.mjs
git commit -m "feat: serve cached system attention"
```

### Task 6: Add Browser Contracts For Views, Columns, And Attention

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `src/types/systems.ts`
- Create: `src/lib/systems-saved-views.ts`
- Create: `src/lib/systems-saved-views.test.ts`
- Modify: `src/lib/systems-api.ts`
- Modify: `src/hooks/use-systems.ts`
- Modify: `src/lib/systems-preferences.ts`
- Modify: `src/lib/systems-preferences.test.ts`

**Interfaces:**
- Produces: `SYSTEMS_COLUMN_KEYS`, `normalizeSystemsViewConfiguration`, saved-view API functions/hooks, Attention detail query, and browser-local widths keyed by owner/project/view/column.

- [ ] **Step 1: Add TanStack dependencies**

Run: `bun add @tanstack/react-table @tanstack/react-virtual`

- [ ] **Step 2: Add failing normalization and persistence tests**

Prove Type/Name lock behavior, default columns/density, no query/width serialization to the server, and width scope isolation.

- [ ] **Step 3: Implement types, normalizers, ETag caches, and query hooks**

Saved-view mutations invalidate only `['projects', projectId, 'systems', 'views']`; Attention detail invalidates only its host key.

- [ ] **Step 4: Run focused frontend model tests**

Run: `bun test src/lib/systems-saved-views.test.ts src/lib/systems-preferences.test.ts src/lib/systems-api.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit browser contracts**

```bash
git add package.json bun.lock src/types/systems.ts src/lib/systems-* src/hooks/use-systems.ts
git commit -m "feat: add systems view client contracts"
```

### Task 7: Build Saved View And Column Toolbar Controls

**Files:**
- Create: `src/components/workbook/systems/systems-toolbar.tsx`
- Create: `src/components/workbook/systems/systems-saved-view-menu.tsx`
- Create: `src/components/workbook/systems/systems-save-view-dialog.tsx`
- Create: `src/components/workbook/systems/systems-column-menu.tsx`
- Create: `src/components/workbook/systems/systems-density-menu.tsx`
- Create: `src/components/workbook/systems/systems-toolbar.test.tsx`
- Modify: `src/components/workbook/systems-workspace.tsx`

**Interfaces:**
- Consumes: Task 6 hooks and normalized configuration.
- Produces: one compact toolbar with immutable All Systems/Needs Attention and custom view lifecycle actions.

- [ ] **Step 1: Add failing interaction tests**

Cover selecting a view, Modified state, save new, replace/update, rename/delete/default/reset, query exclusion, and conflict retry messaging.

- [ ] **Step 2: Run tests and confirm missing components fail**

Run: `bun test src/components/workbook/systems/systems-toolbar.test.tsx`

- [ ] **Step 3: Implement shadcn-based toolbar controls**

Keep Search right-aligned and ephemeral. Needs Attention applies all five inclusion conditions but leaves Attention count semantics unchanged.

- [ ] **Step 4: Run toolbar tests and commit**

Run: `bun test src/components/workbook/systems/systems-toolbar.test.tsx`

```bash
git add src/components/workbook/systems
git commit -m "feat: add systems saved view toolbar"
```

### Task 8: Replace The Table With TanStack Table And Virtual

**Files:**
- Modify: `src/components/workbook/systems/systems-table.tsx`
- Modify: `src/components/workbook/systems/systems-table-model.ts`
- Modify: `src/components/workbook/systems/systems-table-model.test.ts`
- Create: `src/components/workbook/systems/systems-table-layout.ts`
- Create: `src/components/workbook/systems/systems-table-layout.test.ts`
- Create: `src/components/workbook/systems/systems-attention-cell.tsx`
- Modify: `src/components/workbook/systems-workspace.tsx`

**Interfaces:**
- Consumes: view configuration and browser widths from Task 6.
- Produces: shared CSS-grid header/row template, content-fit compact columns, pinned Type/Name, configurable order/visibility, resizers, densities, keyboard navigation, and virtualization above 100 rows.

- [ ] **Step 1: Add failing model/layout tests**

Assert compact columns use `max-content`, content columns receive flexible tracks, header and rows share one template, locked columns remain first, and virtualization threshold is exactly 101.

- [ ] **Step 2: Add failing keyboard and Attention-cell component tests**

Cover arrows, Home/End, Enter, Escape focus restoration, `/` search guard, blank zero Attention, and positive clickable Attention.

- [ ] **Step 3: Implement TanStack columns and virtual rows**

Render fixed-height rows by density, overscan a small bounded count, synchronize horizontal scroll, and preserve semantic row roles/labels. Sort buttons own no extra horizontal padding or negative margins.

- [ ] **Step 4: Run Systems frontend tests**

Run: `bun test src/components/workbook/systems src/lib/systems-preferences.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the table rewrite**

```bash
git add src/components/workbook/systems src/components/workbook/systems-workspace.tsx
git commit -m "feat: scale systems table interactions"
```

### Task 9: Add The Inspector Attention Tab

**Files:**
- Create: `src/components/inspector/attention/attention-tab.tsx`
- Create: `src/components/inspector/attention/attention-tab.test.tsx`
- Modify: `src/components/inspector/inspector-contract.ts`
- Modify: `src/components/inspector/inspector-panel.tsx`
- Modify: `src/components/inspector/equipment/server-inspector-tabs.tsx`
- Modify: `src/components/inspector/equipment/nas-inspector-tabs.tsx`
- Modify: `src/components/inspector/equipment/pc-build-inspector-tabs.tsx`
- Modify: `src/components/workbook/systems-workspace.tsx`

**Interfaces:**
- Consumes: Attention detail hook from Task 6.
- Produces: Registry, Compatibility & Audit, and Notifications groups with destination actions; direct opening from a table count.

- [ ] **Step 1: Add failing tab visibility and direct-open tests**

Prove the tab appears for positive, refreshing, or failed persisted projections; stays absent for zero current projections; and opens directly from the table count.

- [ ] **Step 2: Implement the reusable Attention tab and active-tab handoff**

Each finding displays stable severity and affected item context. Destination actions reuse existing Registry, Audit, Compatibility, and Notifications workflows.

- [ ] **Step 3: Run Inspector and Systems tests**

Run: `bun test src/components/inspector src/components/workbook/systems`

Expected: PASS.

- [ ] **Step 4: Commit Inspector integration**

```bash
git add src/components/inspector src/components/workbook/systems-workspace.tsx
git commit -m "feat: add system attention inspector"
```

### Task 10: Release Notes, Browser Verification, And Full Checks

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `src/release-notes.ts`
- Modify: relevant Playwright/browser tests under `tests/` if existing Systems coverage lives there.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: documented unreleased behavior and verified desktop/mobile interaction.

- [ ] **Step 1: Update structured and human-readable unreleased notes**

Describe synchronized Systems views, configurable/virtualized columns, keyboard behavior, cached Attention triage, and the compact-column alignment fix without a version bump.

- [ ] **Step 2: Run focused migration and feature suites**

Run: `bun test server/persistence/core/schema/schema.bun_spec.ts server/systems src/components/workbook/systems src/components/inspector/attention`

Expected: PASS.

- [ ] **Step 3: Run repository checks**

Run: `bun run lint`

Expected: exit 0; existing warnings may remain.

Run: `bun run test`

Expected: all tests pass.

Run: `bun run build`

Expected: production server and frontend builds pass.

- [ ] **Step 4: Test the local app in desktop and mobile viewports**

Verify toolbar alignment, compact columns, header/body scroll synchronization, saved-view lifecycle, Inspector push layout, positive Attention navigation, zero Attention blank cells, virtualization with over 100 fixture rows, keyboard navigation, focus restoration, and no page-level horizontal overflow.

- [ ] **Step 5: Review the final diff for private/runtime data and commit**

Run: `git diff --check && git status --short`

```bash
git add CHANGELOG.md src/release-notes.ts tests
git commit -m "feat: complete systems operations workspace"
```
