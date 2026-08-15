# Registry Update Semantic Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw Registry update comparison and historical-row grouping with semantic, ownership-aware, authoritative update reconciliation that safely auto-applies enrichment and offers deterministic topology resolution.

**Architecture:** A pure semantic planning layer produces per-link change and topology plans. SQLite persists immutable evaluation facts and derives current actionable groups independently from paginated history. Compact API routes expose summary/list/detail/decision contracts, while the React dialog lazy-loads details and reconciles authoritative receipts.

**Tech Stack:** Bun, TypeScript, Hono/Express-compatible server routes, `bun:sqlite`, Drizzle SQLite schema, React, TanStack Query, shadcn/ui, Vitest, Bun test.

## Global Constraints

- Numeric primary and foreign keys remain positive safe integers.
- Port slot numbers are non-negative ordering metadata and are never relationship IDs.
- Local names, serials, addresses, notes, telemetry, assignments, placements, cables, and route cache are preserved.
- Unknown fields from supported Registry contracts round-trip unchanged.
- Safe official signed updates may apply automatically; topology resolution always requires confirmation.
- Current actionable state and audit history remain separate.
- No code path may special-case Intel, Synology, Omada, TP-Link, or another product model.
- No version bump or release tag is created during implementation.

---

### Task 1: Semantic Registry Update Planner

**Files:**
- Create: `server/registry/catalog-update-semantics.mjs`
- Create: `server/registry/catalog-update-semantics.test.mjs`
- Modify: `server/registry/update-service.mjs`
- Modify: `server/registry/update-service.test.mjs`
- Modify: `server/registry/catalog-update-policy.mjs`
- Modify: `server/registry/catalog-update-policy.test.mjs`

**Interfaces:**
- Produces: `normalizeCatalogUpdateItem(item, fingerprintVersion)`
- Produces: `planCatalogUpdate(current, incoming, fingerprintVersion)` returning `{ nextItem, changes, portPlan, identityImpact }`
- Produces: `classifyIdentityChange(current, incoming)` returning `none | enrichment | correction | conflict | replacement`
- Consumes: existing v9/v10 catalog canonicalizers and compatibility evaluator output.

- [ ] **Step 1: Add failing semantic equivalence tests**

Cover `2500M` versus `2.5G`, omitted versus fixed port origin, `2.5 inch` versus `2.5-inch`, stable collection ordering, and empty collections.

- [ ] **Step 2: Add failing identity ownership tests**

Verify missing linked CPU model is enrichment, aliases are normalization, conflicting non-empty model requires review, local display name is omitted from changes, and local instance fields survive the plan.

- [ ] **Step 3: Add failing nested merge tests**

Verify Registry-owned nested paths update while local `memoryMib`, serial, smart settings, unknown local extensions, and unknown incoming Registry extensions survive round trip.

- [ ] **Step 4: Run focused tests and confirm failure**

Run:

```bash
bun run test server/registry/catalog-update-semantics.test.mjs server/registry/update-service.test.mjs server/registry/catalog-update-policy.test.mjs
```

Expected: tests fail because semantic planner exports and ownership-aware behavior do not exist.

- [ ] **Step 5: Implement the pure semantic planner**

Use path-aware changes with this shape:

```js
{
  path: 'specs.socket',
  kind: 'added',
  current: undefined,
  next: 'LGA1700',
  impact: 'product-definition',
}
```

Port plans use numeric IDs as primary identity and semantic keys as corroborating identity. Representation-only changes cannot become attachment changes.

- [ ] **Step 6: Replace raw top-level diff and shallow merge calls**

Keep `catalogFieldDiff` and `mergeCatalogUpdate` as compatibility adapters that delegate to `planCatalogUpdate` until all callers migrate.

- [ ] **Step 7: Run focused tests and commit**

Run the Task 1 test command and commit semantic planning files with:

```bash
git commit -m "fix: reconcile registry updates semantically"
```

### Task 2: Non-Negative Port Slot Persistence

**Files:**
- Create: `server/persistence/core/migrations/generated/0015_nonnegative_port_slots.sql`
- Modify: `server/persistence/core/migrations/manifest.ts`
- Modify: `server/persistence/core/schema/ports.ts`
- Modify: `server/db/inventory-input.mjs`
- Modify: `server/db/inventory-lifecycle.mjs`
- Modify: `server/persistence/migration/core-importer.ts`
- Modify: `server/db/validation.mjs`
- Modify: `shared/power-ports.mjs`
- Modify: `server/persistence/sqlite-store.bun_spec.ts`
- Modify: `server/persistence/migration/core-importer.bun_spec.ts`
- Modify: `src/test/inventory-form-model.test.ts`

**Interfaces:**
- Consumes: `slotNumber` as a non-negative safe integer.
- Preserves: positive numeric `inventory_ports.id` and all port foreign keys.

- [ ] **Step 1: Add failing migration and round-trip tests**

Create a power strip with port ID 1, semantic key `ac-input`, and slot zero. Verify migration, import, update, projection, restart, and backup round trip preserve zero while IDs stay positive.

- [ ] **Step 2: Add failing display test**

Verify canonical slot zero continues to render the single power-strip header endpoint as `AC 01` and outlets as 01 through N.

- [ ] **Step 3: Run focused tests and confirm failure**

```bash
bun test server/persistence/sqlite-store.bun_spec.ts server/persistence/migration/core-importer.bun_spec.ts
bun run test src/test/inventory-form-model.test.ts
```

- [ ] **Step 4: Add migration 0016 and schema constraint**

Rebuild `item_port_details` with `slot_number >= 0`, preserving its rows, indexes, foreign keys, and every other check constraint. Register the exact SHA-256 in the migration manifest.

- [ ] **Step 5: Align lifecycle, importer, and validation rules**

Introduce a dedicated non-negative slot validator rather than reusing relational-ID validation. Retain positive validation for port IDs and endpoint IDs.

- [ ] **Step 6: Run focused tests and commit**

```bash
git commit -m "fix: support canonical power input slot zero"
```

### Task 3: Per-Link Classification And Topology Resolution Plans

**Files:**
- Create: `server/registry/catalog-update-resolution.mjs`
- Create: `server/registry/catalog-update-resolution.test.mjs`
- Modify: `server/registry/catalog-update-policy.mjs`
- Modify: `server/persistence/sqlite-store.ts`
- Modify: `server/persistence/sqlite-store.bun_spec.ts`
- Modify: `server/persistence/store-contract.ts`

**Interfaces:**
- Produces: `buildCatalogResolutionPlan({ current, next, project, link })`
- Returns: `{ available, operations, affectedRelationships, reason }`
- Produces store method: `resolveAndApplyRegistryUpdateGroup(input)`.

- [ ] **Step 1: Add failing per-link classifier tests**

Verify members of one template group can independently be safe, review-required, or blocked. Missing evidence cannot become a confirmed incompatibility.

- [ ] **Step 2: Add failing deterministic resolution tests**

Cover fixed/soldered component adoption, external adapter to fixed adapter, fixed host endpoint cable remapping, numeric resource ID preservation, unique semantic-key port remapping, and ambiguous remapping refusal.

- [ ] **Step 3: Add failing atomic rollback tests**

Verify adapter return-to-inventory, cable remapping, unrelated relationship preservation, stale project revision rejection, and no partial mutation on failure.

- [ ] **Step 4: Run focused tests and confirm failure**

```bash
bun run test server/registry/catalog-update-resolution.test.mjs server/registry/catalog-update-policy.test.mjs
bun test server/persistence/sqlite-store.bun_spec.ts
```

- [ ] **Step 5: Implement pure resolution planning**

Operations use typed numeric references:

```js
{ kind: 'move-connection-endpoint', connectionId: 65, fromPortId: 107, toPortId: 1 }
{ kind: 'unassign-item', assignmentId: 95, returnToInventory: true }
```

The planner refuses operations without a unique target.

- [ ] **Step 6: Implement atomic resolution execution**

Validate the plan again inside the transaction, apply relationship operations before the Registry definition, and verify the final canonical project before commit.

- [ ] **Step 7: Run focused tests and commit**

```bash
git commit -m "feat: resolve supported registry topology updates"
```

### Task 4: Authoritative Current Projection And Decision Receipts

**Files:**
- Create: `server/registry/catalog-update-projection.mjs`
- Create: `server/registry/catalog-update-projection.test.mjs`
- Modify: `server/persistence/core/schema/registry.ts`
- Create: `server/persistence/core/migrations/generated/0016_registry_update_reconciliation.sql`
- Modify: `server/persistence/core/migrations/manifest.ts`
- Modify: `server/persistence/sqlite-store.ts`
- Modify: `server/persistence/sqlite-store.bun_spec.ts`

**Interfaces:**
- Produces: `currentRegistryUpdateEvaluations(database)`.
- Produces: `registryUpdateGroups(database, filters)` returning compact groups.
- Group identity includes target hash and exact link membership through `concurrencyToken`.
- Decisions consume `{ groupId, concurrencyToken }`.

- [ ] **Step 1: Add failing current-projection tests**

Use two evaluation runs for the same link and target. Assert one current member, preserved audit rows, and older pending decision transitioned to `superseded`.

- [ ] **Step 2: Add failing mixed-state tests**

Cover one link applied at revision 1 and pending at revision 2, one target revision with applied and pending links, mixed source revisions, mixed per-link classifications, and distinct item counts.

- [ ] **Step 3: Add failing decision-proof tests**

Verify no-op approval succeeds only when every target link is already linked at the exact revision/hash. Zero changed rows without proof must fail. Close/reopen and restart retain Applied state.

- [ ] **Step 4: Add failing concurrency tests**

Changing member links, target content hash, catalog revision, or project revision after list load must return a refresh-required conflict.

- [ ] **Step 5: Run focused tests and confirm failure**

```bash
bun run test server/registry/catalog-update-projection.test.mjs
bun test server/persistence/sqlite-store.bun_spec.ts
```

- [ ] **Step 6: Add projection indexes and reconciliation migration**

Add indexes required for latest link/target projection. The migration preserves all rows and marks only obsolete pending evaluations as superseded.

- [ ] **Step 7: Replace group and summary queries**

Current Review/Blocked derive from link state and target hash. Applied/Declined derive from paginated audit history. Toolbar counts unresolved groups, while run metrics remain link-level diagnostics.

- [ ] **Step 8: Enforce authoritative receipts**

Return Applied only after persisted Registry links prove exact target state. Include stable idempotency receipt, affected links, projects, and project revisions.

- [ ] **Step 9: Run focused tests and commit**

```bash
git commit -m "fix: derive authoritative registry update state"
```

### Task 5: Compact Paginated And Lazy API Contracts

**Files:**
- Modify: `server/registry-routes.mjs`
- Modify: `server/registry-routes.test.mjs`
- Modify: `server/registry/response-json.mjs`
- Modify: `src/lib/registry-api.ts`
- Modify: `src/types/registry.ts`

**Interfaces:**
- `GET /api/registry/updates?view=summary`
- `GET /api/registry/update-groups?status=&q=&category=&projectId=&reason=&cursor=&limit=`
- `GET /api/registry/update-groups/:groupId?token=`
- `POST /api/registry/update-groups/decision`
- `POST /api/registry/update-groups/:groupId/resolve-and-apply`

- [ ] **Step 1: Add failing route contract tests**

Assert summary has no groups, list has no current/proposed definitions, detail includes per-link plans, pagination is deterministic, invalid cursors fail, and permissions/demo restrictions remain enforced.

- [ ] **Step 2: Add failing response-budget tests**

Use representative multi-item fixtures. Summary must remain count-only, list size proportional to compact metadata, and one decision response below 4 KiB.

- [ ] **Step 3: Run route tests and confirm failure**

```bash
bun run test server/registry-routes.test.mjs server/registry/response-json.test.mjs
```

- [ ] **Step 4: Implement routes and serializers**

Parse bounded `limit` values, opaque cursors, and concurrency tokens. Do not serialize full project or inventory snapshots.

- [ ] **Step 5: Add typed frontend API clients**

Define separate summary, compact page, detail, decision, and resolution types. Remove the legacy full-group loader from active UI code.

- [ ] **Step 6: Run focused tests and commit**

```bash
git commit -m "perf: lazy load registry update details"
```

### Task 6: Registry Updates Dialog Reconciliation

**Files:**
- Create: `src/components/inventory/registry-update-group-card.tsx`
- Create: `src/components/inventory/registry-update-group-detail.tsx`
- Create: `src/components/inventory/registry-update-resolution-dialog.tsx`
- Create: `src/components/inventory/registry-update-filters.tsx`
- Modify: `src/components/inventory/registry-updates-dialog.tsx`
- Modify: `src/test/registry-updates-dialog.test.tsx`
- Modify: `src/lib/query-client.ts`

**Interfaces:**
- Compact list query key: `['registry', 'update-groups', filters]`.
- Detail query key: `['registry', 'update-group', groupId, concurrencyToken]`.
- Pending/error maps remain keyed by group ID.

- [ ] **Step 1: Add failing UI tests**

Cover one-card pending state, one click/one mutation, lazy detail fetch, immediate Review-to-Applied movement, badge decrement, refresh persistence, blocked tab, paginated history, adoption copy, mixed revisions, and inline stale-state errors.

- [ ] **Step 2: Add failing resolution confirmation tests**

Verify exact operations are displayed, confirmation is required, ambiguous groups expose no action, success updates caches, and failure leaves the group unchanged.

- [ ] **Step 3: Run UI tests and confirm failure**

```bash
bun run test src/test/registry-updates-dialog.test.tsx
```

- [ ] **Step 4: Split dialog responsibilities**

Keep the dialog responsible for tabs, filters, and selection. Cards own compact status, detail owns lazy semantic changes, and the resolution dialog owns confirmation.

- [ ] **Step 5: Implement authoritative cache reconciliation**

Apply receipt statuses and summary counts before targeted project refresh. Never map status using template key/revision alone; use returned group IDs and receipts.

- [ ] **Step 6: Run UI tests and commit**

```bash
git commit -m "fix: make registry update review authoritative"
```

### Task 7: Startup Reevaluation And Scope-Limited Refresh

**Files:**
- Modify: `server/registry/catalog-update-startup.mjs`
- Modify: `server/registry/catalog-update-startup.test.mjs`
- Modify: `server/registry/catalog-update-coordinator.mjs`
- Modify: `server/registry/catalog-update-coordinator.test.mjs`
- Modify: `server/persistence/runtime.ts`
- Modify: `server/db/catalog-update-lifecycle.test.mjs`

**Interfaces:**
- Startup performs one forced reevaluation when migration 0017 first activates.
- Safe updates follow the existing trusted-source setting.
- Resolution-required updates remain pending.

- [ ] **Step 1: Add failing startup reconciliation tests**

Verify one post-migration reevaluation, idempotent restart, automatic application of newly safe groups, preserved blocked groups, and no duplicate evaluations.

- [ ] **Step 2: Add failing refresh-scope tests**

Verify specification-only updates do not invalidate canvas topology or route cache; topology resolutions invalidate only affected projects/workspaces and relationships.

- [ ] **Step 3: Run focused tests and confirm failure**

```bash
bun run test server/registry/catalog-update-startup.test.mjs server/registry/catalog-update-coordinator.test.mjs server/db/catalog-update-lifecycle.test.mjs
```

- [ ] **Step 4: Implement startup marker and reevaluation**

Store the completed semantic-reconciliation version in SQLite metadata so it runs once per database and remains restart-safe.

- [ ] **Step 5: Scope frontend/project notifications**

Emit affected project IDs and revisions only when inventory changed. Decline/reconsider and history-only mutations must not advance project revisions.

- [ ] **Step 6: Run focused tests and commit**

```bash
git commit -m "fix: reconcile registry updates after migration"
```

### Task 8: Release Notes And Full Verification

**Files:**
- Modify: `CHANGELOG.md`
- Modify: structured unreleased release-note draft under the repository's existing release-note path
- Test: all touched server, persistence, migration, and frontend suites

**Interfaces:**
- No new public dependency.
- No semver bump, tag, push, or deployment.

- [ ] **Step 1: Add consolidated user-facing release notes**

Describe correct Registry decisions, automatic safe enrichment, semantic port handling, Resolve and apply, compact lazy review data, and preserved topology as consolidated changes.

- [ ] **Step 2: Run focused Registry and migration suites**

```bash
bun run test server/registry server/registry-routes.test.mjs src/test/registry-updates-dialog.test.tsx
bun test server/persistence/sqlite-store.bun_spec.ts server/persistence/migration/core-importer.bun_spec.ts
```

- [ ] **Step 3: Run standard repository checks**

```bash
bun run lint
bun run test
bun run build
```

- [ ] **Step 4: Review data and release safety**

Verify `git diff --check`, no runtime stores or private data are staged, no version changed, and `.superpowers/` remains untouched.

- [ ] **Step 5: Commit verified implementation**

```bash
git commit -m "fix: harden registry update reconciliation"
```
