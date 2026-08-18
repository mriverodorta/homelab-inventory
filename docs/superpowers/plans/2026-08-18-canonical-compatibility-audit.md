# Canonical Compatibility Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one persisted server-side compatibility audit projection shared by Systems, Inspector, Canvas, and Audit while correcting M.2 A/E, ECC, assigned-slot, expansion-power, and CPU-generation behavior.

**Architecture:** Keep `shared/compatibility` as pure domain logic, add normalized M.2 A/E resource fields and persisted audit work tables to core SQLite, and introduce a `CompatibilityAuditService` that incrementally reconciles affected hosts. Expose compact ETag-aware APIs and publish scoped events through the existing application live-event bus so frontend consumers update without polling.

**Tech Stack:** Bun, TypeScript, JavaScript ES modules, SQLite through `bun:sqlite`, Drizzle schema/migrations, Express, TanStack Query, React, Vitest, Bun test, application SSE live events.

## Global Constraints

- Persist every primary and foreign key as a positive safe integer.
- Evaluate saved assignments against their recorded numeric resource slot.
- Missing metadata is informational; proven incompatibility or unresolved ambiguity is actionable.
- Preserve assignments, placements, connections, manual bends, route cache, private fields, Registry links, and ignore state.
- Keep physical adapters outside this change; future adapters use the existing `other` inventory category.
- Do not poll compatibility endpoints; use the existing application SSE connection.
- Do not infer that every M.2 A/E socket exposes both PCIe and USB.
- Do not bump the application version until deployment is explicitly requested.

---

## File Map

Create:

- `shared/compatibility/cpu-generation-aliases.mjs`: versioned canonical CPU product-generation aliases.
- `shared/compatibility/cpu-generation-aliases.d.mts`: public alias helper declarations.
- `server/compatibility/audit-service.mjs`: dirty-host reconciliation and persisted finding authority.
- `server/compatibility/audit-service.bun_spec.ts`: reconciliation, restart, ignore, and preservation tests.
- `server/compatibility/routes.mjs`: summary, host detail, project findings, and ignore routes.
- `server/compatibility/routes.test.mjs`: authorization, ETag, filtering, and route tests.
- `src/lib/compatibility-audit-api.ts`: typed frontend API client and ETag cache.
- `src/hooks/use-compatibility-audit.ts`: TanStack Query and SSE synchronization.
- `src/types/compatibility-audit.ts`: persisted read-model types.
- `server/persistence/core/migrations/generated/0021_canonical_compatibility_audits.sql`: schema and deterministic M.2 A/E data migration.
- `server/persistence/core/migrations/generated/meta/0021_snapshot.json`: generated Drizzle snapshot.

Modify:

- `shared/compatibility/index.mjs` and `index.d.mts`: exact-resource evaluation, classification, ECC, M.2 A/E, power, and generation rules.
- `src/types/compatibility.ts`: optional-module physical fields and finding classification.
- `server/persistence/core/schema/audits.ts`: dirty-host and finding relationship/classification columns.
- `server/persistence/core/schema/resources.ts`: normalized optional-module interface, key, size, bus, and intended-kind tables.
- `server/persistence/core/projections/legacy-project.ts`: project physical-field projection.
- `server/persistence/migration/core-importer.ts`: import current and legacy optional-module shapes.
- `server/persistence/core/schema/schema.bun_spec.ts`, `server/persistence/migration/core-importer.bun_spec.ts`, and `server/persistence/sqlite-store.bun_spec.ts`: migration and round-trip coverage.
- `server/backup/sqlite-section-exporter.ts` and `server/backup/sqlite-restore-staging.ts`: include new relational tables.
- `server/systems/attention-projector.mjs`: consume actionable compatibility findings only.
- `server/index.mjs`: service startup, invalidation hooks, routes, and live-event publication.
- `server/live-events/topics.mjs` and tests: authorize `compatibility:<projectId>`.
- `server/auth/api-permissions.mjs` and tests: compatibility read and ignore policies.
- `src/components/host-compatibility-tab.tsx`: persisted actionable and informational sections.
- `src/lib/audit.ts`: retain non-compatibility topology rules and stop recalculating compatibility.
- `src/components/audit-drawer.tsx`: merge persisted compatibility findings with local topology findings.
- `src/lib/canvas-project-index.ts`: consume server actionable counts.
- `src/app/app.tsx` and `src/app/create-workspace-surface-props.ts`: load and pass project compatibility projections.
- `src/components/inspector/inspector-panel.tsx` plus server/NAS/PC Build inspector tab files: pass host projection data.
- `src/components/canvas/workbench-canvas.tsx` and `src/components/canvas/use-canvas-project-model.ts`: pass project summary counts into the Canvas index.
- `src/release-notes.ts` and `CHANGELOG.md`: user-visible migration and compatibility changes.

---

### Task 1: Correct The Pure Compatibility Evaluator

**Files:**
- Create: `shared/compatibility/cpu-generation-aliases.mjs`
- Create: `shared/compatibility/cpu-generation-aliases.d.mts`
- Modify: `shared/compatibility/index.mjs`
- Modify: `shared/compatibility/index.d.mts`
- Modify: `src/types/compatibility.ts`
- Test: `src/test/compatibility-rules.test.ts`
- Test: `src/test/compatibility-allocation.test.ts`
- Test: `src/test/compatibility-normalization.test.ts`

**Interfaces:**
- Produces: `canonicalCpuGenerationTokens(value: unknown): readonly string[]`.
- Produces: findings with `classification: 'actionable' | 'informational'`.
- Produces: `evaluateAssignmentCompatibility({... assignedAllocation })` where `assignedAllocation` is the persisted allocation or `undefined`.
- Consumes later: normalized optional-module fields `interfaceFamily`, `acceptedKeys`, `moduleSizes`, `availableBuses`, and `intendedModuleKinds`.

- [ ] **Step 1: Write failing CPU alias and ECC tests**

Add focused cases equivalent to:

```ts
expect(canonicalCpuGenerationTokens('Ryzen PRO 4000')).toContain('amd:ryzen-pro-4000')
expect(canonicalCpuGenerationTokens('Zen 2')).toContain('amd:architecture:zen-2')
expect(evaluateAssignmentCompatibility({ host, component: ordinarySodimm }).findings)
  .not.toContainEqual(expect.objectContaining({ code: 'memory.ecc.missing' }))
expect(evaluateAssignmentCompatibility({ host, component: nonEccRdimm }).findings)
  .toContainEqual(expect.objectContaining({ code: 'memory.registered-ecc.required', classification: 'actionable' }))
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run:

```bash
bunx vitest run src/test/compatibility-rules.test.ts src/test/compatibility-normalization.test.ts
```

Expected: failures for absent alias exports, missing classification, and the current ECC unknown finding.

- [ ] **Step 3: Implement versioned CPU tokens and finding classification**

Use explicit product-generation aliases rather than architecture-wide equivalence:

```js
export const CPU_GENERATION_ALIAS_VERSION = 1

export function canonicalCpuGenerationTokens(value) {
  const normalized = normalizedLabel(value)
  return Object.freeze(ALIASES.get(normalized) ?? (normalized ? [`literal:${normalized}`] : []))
}
```

Make `addMissing()` emit `classification: 'informational'`; proven mismatch/capacity findings emit `classification: 'actionable'`.

- [ ] **Step 4: Write failing exact-slot, M.2 A/E, and expansion-power tests**

Cover:

```ts
expect(resultForAssignedSlot.findings).toContainEqual(expect.objectContaining({
  code: 'expansion.interface.mismatch',
  resourceId: assignedGroupId,
}))
expect(wiredAeNicResult.status).toBe('compatible')
expect(singleSlotPowerResult.findings).not.toContainEqual(expect.objectContaining({
  field: 'host.expansionSlots.maxPowerWatts',
}))
expect(multiSlotResult.findings).toContainEqual(expect.objectContaining({
  field: 'host.expansionSlots.maxPowerWatts',
  classification: 'informational',
}))
```

- [ ] **Step 5: Run exact-slot tests and confirm failure**

Run:

```bash
bunx vitest run src/test/compatibility-allocation.test.ts src/test/compatibility-rules.test.ts
```

Expected: the evaluator chooses the best group, rejects the wired NIC by kind, and reports missing per-slot power.

- [ ] **Step 6: Implement the evaluator rules**

Implement these exact rules:

- Narrow host resource collections to `assignedAllocation.groupId` for saved assignments.
- Match M.2 A/E by interface family, accepted key, module size, and evidenced required bus.
- Treat `intendedModuleKinds` and legacy `acceptedModuleKinds` as descriptive for M.2 A/E.
- Default missing ECC to false for ordinary UDIMM/SO-DIMM/unspecified unregistered modules without persisting a value.
- Require ECC for RDIMM/LRDIMM.
- Use global expansion power as the effective slot limit only when exactly one expansion group exists.
- Match CPU product-generation aliases without equating architecture to all products using it.

- [ ] **Step 7: Run all compatibility tests**

Run:

```bash
bunx vitest run src/test/compatibility-rules.test.ts src/test/compatibility-allocation.test.ts src/test/compatibility-normalization.test.ts src/test/compatibility-workflows.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit the evaluator change**

```bash
git add shared/compatibility src/types/compatibility.ts src/test/compatibility-*.test.ts
git commit -m "fix: canonicalize compatibility evaluation"
```

---

### Task 2: Add Canonical M.2 A/E And Audit Persistence

**Files:**
- Modify: `server/persistence/core/schema/resources.ts`
- Modify: `server/persistence/core/schema/audits.ts`
- Modify: `server/persistence/core/projections/legacy-project.ts`
- Modify: `server/persistence/migration/core-importer.ts`
- Create: `server/persistence/core/migrations/generated/0021_canonical_compatibility_audits.sql`
- Create: `server/persistence/core/migrations/generated/meta/0021_snapshot.json`
- Modify: `server/persistence/core/migrations/generated/meta/_journal.json`
- Modify: `server/backup/sqlite-section-exporter.ts`
- Modify: `server/backup/sqlite-restore-staging.ts`
- Test: `server/persistence/core/schema/schema.bun_spec.ts`
- Test: `server/persistence/migration/core-importer.bun_spec.ts`
- Test: `server/persistence/sqlite-store.bun_spec.ts`

**Interfaces:**
- Produces: normalized optional-module tables keyed by `host_resource_groups.id`.
- Produces: `compatibility_audit_dirty_hosts` unique on `(project_id, host_item_id)`.
- Produces: finding columns `assignment_id`, `resource_slot_id`, and `classification`.
- Preserves: existing numeric resource group and slot IDs.

- [ ] **Step 1: Add failing schema and round-trip tests**

Create a host fixture containing:

```json
{
  "id": 1,
  "key": "m2-ae-slot",
  "aliases": ["wlan-m2"],
  "count": 1,
  "label": "M.2 A/E slot",
  "interfaceFamily": "m2-ae",
  "acceptedKeys": ["A+E"],
  "moduleSizes": ["2230"],
  "availableBuses": [{ "family": "pcie", "lanes": 1, "pcieGeneration": 3 }],
  "intendedModuleKinds": ["wireless-card"]
}
```

Assert the canonical tables and legacy project projection preserve every field and alias.

- [ ] **Step 2: Run persistence tests and confirm failure**

Run:

```bash
bun test server/persistence/core/schema/schema.bun_spec.ts server/persistence/migration/core-importer.bun_spec.ts server/persistence/sqlite-store.bun_spec.ts
```

Expected: missing table/column and round-trip failures.

- [ ] **Step 3: Add normalized resource and audit schema**

Add focused tables:

```text
optional_module_resource_groups
optional_module_accepted_keys
optional_module_module_sizes
optional_module_available_buses
resource_intended_kinds
compatibility_audit_dirty_hosts
```

Use foreign keys to canonical numeric resource groups. Add checks for `m2-ae`, positive PCIe generations/lanes, valid bus families, valid classifications, and JSON validity.

- [ ] **Step 4: Generate migration 0021**

Run:

```bash
bun run db:generate
```

Verify the generated filename is `0021_canonical_compatibility_audits.sql`; rename the generated slug and update `_journal.json` only if Drizzle chose a different descriptive slug.

- [ ] **Step 5: Add deterministic data migration statements**

Within migration 0021:

- Relabel unambiguous `wlan-m2` groups to `M.2 A/E slot`.
- Canonicalize their semantic key to `m2-ae-slot`, adding a deterministic numeric suffix only on a real same-host collision.
- Preserve `host_resource_groups.id`, `inventory_resources.id`, and `host_resource_slots.id`.
- Insert `wlan-m2` into `resource_identity_aliases` without replacing an existing conflicting alias.
- Move legacy `wireless-card` accepted kinds to intended kinds for canonical M.2 A/E groups.
- Insert `interface_family = 'm2-ae'`, known `A+E` acceptance, and `2230` size only for unambiguous legacy WLAN resources.
- Do not fabricate PCIe or USB bus rows.
- Insert every active compute host into `compatibility_audit_dirty_hosts`.

- [ ] **Step 6: Add migration preservation and ambiguity tests**

Assert before/after values for:

```text
resource IDs
slot IDs
assignment resource_slot_id
placements
connections
manual routes
route cache
Registry links
private fields
```

Add a collision fixture proving an ambiguous resource is unchanged and not silently canonicalized.

- [ ] **Step 7: Update import, projection, backup, and restore table sets**

Import both new physical fields and legacy `wlan-m2`/`acceptedModuleKinds`. Export and selective restore all new tables in dependency order. Validation must reject dangling resource, assignment, or slot references.

- [ ] **Step 8: Run schema, migration, backup, and restore tests**

Run:

```bash
bun run db:migrations:check
bun test server/persistence server/backup/sqlite-backup.bun_spec.ts
```

Expected: PASS with core schema version 22.

- [ ] **Step 9: Commit the persistence change**

```bash
git add server/persistence server/backup
git commit -m "feat: persist canonical compatibility audits"
```

---

### Task 3: Implement The Compatibility Audit Service

**Files:**
- Create: `server/compatibility/audit-service.mjs`
- Create: `server/compatibility/audit-service.bun_spec.ts`
- Modify: `server/systems/attention-projector.mjs`
- Test: `server/systems/attention-projector.bun_spec.ts`

**Interfaces:**
- Produces: `CompatibilityAuditService.markHostDirty(store, input)`.
- Produces: `CompatibilityAuditService.markHostsForItemDirty(store, input)`.
- Produces: `CompatibilityAuditService.markProjectDirty(store, projectId, reason)`.
- Produces: `CompatibilityAuditService.reconcile(store, { limit }): { claimed, evaluated, reused, repaired, failed }`.
- Produces: `summary()`, `hostDetails()`, `findings()`, `setIgnored()`, `start()`, and `stop()`.
- Consumes: shared evaluator from Task 1 and schema from Task 2.

- [ ] **Step 1: Write failing reconciliation tests**

Test one host with actionable and informational findings and assert:

```ts
expect(service.reconcile(store)).toEqual({
  claimed: 1,
  evaluated: 1,
  reused: 0,
  repaired: 0,
  failed: 0,
})
expect(activeFindings.map(({ classification }) => classification).sort())
  .toEqual(['actionable', 'informational'])
```

Also test stable IDs, resolved timestamps, reopening, and ignore preservation.

- [ ] **Step 2: Run service tests and confirm failure**

Run:

```bash
bun test server/compatibility/audit-service.bun_spec.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement host assembly and stable finding identity**

Read the canonical project snapshot for evaluator input but resolve assignment and resource-slot numeric IDs directly from SQLite for persistence. Generate finding keys from:

```js
fingerprint({ projectId, hostItemId, assignmentId, resourceSlotId, ruleKey })
```

Store display and navigation context in `details_json`, not in the key.

- [ ] **Step 4: Implement transactional reconciliation**

Within one SQLite transaction:

- Recheck the dirty row input revision.
- Repair only one-destination missing allocations through the store's validated assignment API.
- Upsert current findings.
- Resolve absent findings.
- Preserve or restore ignore rows.
- Complete the audit run.
- Remove only the dirty row version that was evaluated.
- Mark Systems attention dirty after commit.

- [ ] **Step 5: Add restart, stale-input, and failure tests**

Prove:

- A newer invalidation survives an older evaluation.
- Restart resumes dirty rows.
- Failure retains previous active findings and marks state stale/failed.
- Repeated failure does not create duplicate runs or findings.
- Ambiguous assignment repair performs no mutation and creates one actionable finding.

- [ ] **Step 6: Make Systems consume actionable rows only**

Change the audit source query to include:

```sql
AND finding.classification = 'actionable'
```

Keep ignored and resolved exclusions. Add a test proving informational findings produce `auditCount: 0`.

- [ ] **Step 7: Run audit and Systems projection tests**

Run:

```bash
bun test server/compatibility/audit-service.bun_spec.ts server/systems/attention-projector.bun_spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit the service**

```bash
git add server/compatibility server/systems/attention-projector.mjs server/systems/attention-projector.bun_spec.ts
git commit -m "feat: project compatibility audits server side"
```

---

### Task 4: Wire Invalidation And Application SSE

**Files:**
- Modify: `server/index.mjs`
- Modify: `server/live-events/topics.mjs`
- Test: `server/live-events/event-bus.test.mjs`
- Test: `server/live-events/routes.test.mjs`
- Test: `server/live-events/sse-hub.test.mjs`
- Test: `server/compatibility/audit-service.bun_spec.ts`

**Interfaces:**
- Produces topic: `compatibility:<projectId>` authorized by `project.view`.
- Produces event kind: `compatibility.updated`.
- Event payload: `{ projectId, hostType, hostId, revision, actionableCount, informationalCount, state }`.

- [ ] **Step 1: Write failing topic and event tests**

Assert:

```js
expect(parseApplicationLiveTopic('compatibility:1')).toMatchObject({
  permission: 'project.view',
  kind: 'compatibility',
  projectId: 1,
})
```

Prove another project scope does not receive the event and payload stays under the live-event size limit.

- [ ] **Step 2: Run live-event tests and confirm failure**

Run:

```bash
bun test server/live-events/*.test.mjs
```

Expected: unsupported-topic failure.

- [ ] **Step 3: Register the compatibility topic and publisher**

Publish after audit transaction commit:

```js
applicationEventBus.publish({
  scope: store,
  topics: `compatibility:${projectId}`,
  kind: 'compatibility.updated',
  payload,
})
```

- [ ] **Step 4: Replace direct Systems-only dirty hooks with audit invalidation**

Route existing project commit, Registry update, policy, restore, and topology hooks through `CompatibilityAuditService`. The audit service then marks Systems attention dirty after a successful projection. Notification-only hooks remain Systems-specific.

- [ ] **Step 5: Add incremental invalidation tests**

Prove:

- Editing a component marks only hosts that assign it.
- Editing a host marks that host in every project where it is visible.
- Assignment changes mark old and new hosts.
- Registry refresh marks linked hosts and hosts containing linked components.
- Unrelated project commits do not enqueue every host.

- [ ] **Step 6: Run server integration tests**

Run:

```bash
bun test server/live-events server/compatibility server/systems
```

Expected: PASS.

- [ ] **Step 7: Commit SSE and invalidation wiring**

```bash
git add server/index.mjs server/live-events server/compatibility
git commit -m "feat: stream compatibility projection updates"
```

---

### Task 5: Add Compatibility Read And Ignore APIs

**Files:**
- Create: `server/compatibility/routes.mjs`
- Create: `server/compatibility/routes.test.mjs`
- Modify: `server/auth/api-permissions.mjs`
- Test: `server/auth/api-permissions.test.mjs`
- Modify: `server/index.mjs`

**Interfaces:**
- Produces: `GET /api/projects/:projectId/compatibility/summary`.
- Produces: `GET /api/projects/:projectId/hosts/:hostType/:hostId/compatibility`.
- Produces: `GET /api/projects/:projectId/compatibility/findings`.
- Produces: `PUT /api/projects/:projectId/compatibility/findings/:findingId/ignore`.
- Produces: `DELETE /api/projects/:projectId/compatibility/findings/:findingId/ignore`.

- [ ] **Step 1: Write failing authorization tests**

Require `project.view` for reads and `audit.manage` for ignore writes. Assert unknown methods and malformed numeric IDs remain denied.

- [ ] **Step 2: Write failing route tests**

Cover:

- Project summary excludes full details.
- Host details separate actionable and informational arrays.
- Findings support `classification`, `severity`, `visibility`, `hostType`, `hostId`, `limit`, and cursor filters.
- `If-None-Match` returns `304`.
- Ignore and restore preserve finding identity and publish an update.

- [ ] **Step 3: Run route tests and confirm failure**

Run:

```bash
bun test server/compatibility/routes.test.mjs server/auth/api-permissions.test.mjs
```

Expected: missing route and authorization-policy failures.

- [ ] **Step 4: Implement bounded ETag-aware routes**

Use canonical JSON fingerprints for ETags. Cap findings pages at 100 records. Return `409 finding-resolved` when attempting to ignore a resolved finding and `404` for a finding outside the requested project.

- [ ] **Step 5: Migrate legacy ignored warning IDs during first projection**

For each new finding, compute and retain its old frontend warning ID in diagnostic details. If `compatibilityPolicy.ignoredWarningIds` contains that ID, create the relational ignore row without changing project data. New ignore actions write only `compatibility_audit_ignores`.

- [ ] **Step 6: Run route and permission tests**

Run:

```bash
bun test server/compatibility/routes.test.mjs server/auth/api-permissions.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit the API**

```bash
git add server/compatibility/routes.mjs server/compatibility/routes.test.mjs server/auth server/index.mjs
git commit -m "feat: expose compatibility audit projections"
```

---

### Task 6: Add The Frontend Compatibility Data Layer

**Files:**
- Create: `src/types/compatibility-audit.ts`
- Create: `src/lib/compatibility-audit-api.ts`
- Create: `src/hooks/use-compatibility-audit.ts`
- Test: `src/hooks/use-compatibility-audit.test.tsx`
- Modify: `src/live-events/model.ts`
- Test: `src/live-events/application-live-events-provider.test.tsx`
- Test: `src/live-events/no-browser-polling.test.ts`

**Interfaces:**
- Produces: `useCompatibilitySummary(projectId, enabled)`.
- Produces: `useHostCompatibility(projectId, hostType, hostId, enabled)`.
- Produces: `useCompatibilityFindings(projectId, filters, enabled)`.
- Produces: `useSetCompatibilityFindingIgnored(projectId)`.

- [ ] **Step 1: Define the persisted read-model types**

Include:

```ts
export type CompatibilityAuditClassification = 'actionable' | 'informational'
export type CompatibilityProjectionState = 'current' | 'refreshing' | 'failed'

export type CompatibilityAuditFinding = {
  id: number
  findingKey: string
  ruleKey: string
  classification: CompatibilityAuditClassification
  severity: 'info' | 'warning' | 'error'
  hostItemId: number
  componentItemId: number | null
  assignmentId: number | null
  resourceSlotId: number | null
  message: string
  ignored: boolean
}
```

- [ ] **Step 2: Write failing ETag, SSE, and no-polling tests**

Assert one `compatibility.updated` event updates the summary count and invalidates only the matching host/detail and open findings queries. Use fake timers to prove no `setInterval` or refetch interval is registered.

- [ ] **Step 3: Run frontend data tests and confirm failure**

Run:

```bash
bunx vitest run src/hooks/use-compatibility-audit.test.tsx src/live-events/no-browser-polling.test.ts
```

Expected: missing module and topic-type failures.

- [ ] **Step 4: Implement API clients and hooks**

Use the existing `fetchWithTimeout`, ETag cache pattern, and `useLiveEventTopic`. Keep queries at `staleTime: Infinity`; use SSE updates and reconnect resync instead of timers.

- [ ] **Step 5: Run frontend data tests**

Run:

```bash
bunx vitest run src/hooks/use-compatibility-audit.test.tsx src/live-events
```

Expected: PASS.

- [ ] **Step 6: Commit the frontend data layer**

```bash
git add src/types/compatibility-audit.ts src/lib/compatibility-audit-api.ts src/hooks/use-compatibility-audit.ts src/hooks/use-compatibility-audit.test.tsx src/live-events
git commit -m "feat: consume compatibility audits over sse"
```

---

### Task 7: Consolidate Systems, Inspector, Canvas, And Audit UI

**Files:**
- Modify: `src/components/host-compatibility-tab.tsx`
- Modify: `src/components/compatibility-status.tsx`
- Modify: `src/lib/audit.ts`
- Modify: `src/components/audit-drawer.tsx`
- Modify: `src/lib/canvas-project-index.ts`
- Modify: `src/app/app.tsx`
- Modify: `src/app/create-workspace-surface-props.ts`
- Modify: `src/components/inspector/inspector-panel.tsx`
- Modify: `src/components/inspector/equipment/server-inspector-tabs.tsx`
- Modify: `src/components/inspector/equipment/nas-inspector-tabs.tsx`
- Modify: `src/components/inspector/equipment/pc-build-inspector-tabs.tsx`
- Modify: `src/components/canvas/workbench-canvas.tsx`
- Modify: `src/components/canvas/use-canvas-project-model.ts`
- Test: `src/test/audit.test.ts`
- Test: `src/test/audit-drawer.test.tsx`
- Test: `src/test/inspector-panel.test.tsx`
- Test: `src/components/workbook/systems-workspace.test.tsx`
- Test: `src/test/canvas-project-index.test.ts`
- Test: `src/test/canvas-quality.test.ts`
- Test: `src/test/standalone-canvas-cards.test.tsx`

**Interfaces:**
- Consumes: hooks from Task 6.
- Retains: local `getProjectAuditWarnings()` only for stale connections, network traces, switch configuration, and runtime power-topology warnings.
- Removes: frontend project-wide compatibility calculation from `src/lib/audit.ts` display paths.

- [ ] **Step 1: Write failing cross-view consistency tests**

Provide one persisted projection fixture with two actionable and three informational findings. Assert:

```ts
expect(systemsAttentionCount).toBe(2)
expect(canvasCompatibilityCount).toBe(2)
expect(inspectorIssues).toHaveLength(2)
expect(inspectorUnverifiedDetails).toHaveLength(3)
expect(auditInformationalFilter).toHaveLength(3)
```

- [ ] **Step 2: Run UI tests and confirm failure**

Run:

```bash
bunx vitest run src/test/audit.test.ts src/test/audit-drawer.test.tsx src/test/inspector-panel.test.tsx src/components/workbook/systems-workspace.test.tsx
```

Expected: frontend evaluator still creates independent counts and no informational section exists.

- [ ] **Step 3: Convert Host Compatibility to the persisted projection**

Keep local allocation planning only for slot-utilization display and unsaved edits. Render persisted findings in two sections:

```text
Compatibility issues
Unverified details
```

Show current data with a subtle Refreshing label when state is `refreshing`; show a stale warning without removing findings when state is `failed`.

- [ ] **Step 4: Remove compatibility calculation from the local Audit domain**

Delete `compatibilityResults` from `AuditEvaluationContext` and remove `getCompatibilityAuditWarnings()`. Keep non-compatibility topology rules. Merge persisted compatibility groups into the Audit drawer by numeric host/component destinations.

- [ ] **Step 5: Update Canvas counts**

Pass the compact project compatibility summary into `buildCanvasProjectIndex`. Add persisted actionable compatibility counts to local topology warning counts without counting informational findings.

- [ ] **Step 6: Add Audit drawer filters and relational ignore actions**

Add `Actionable` and `Informational` filters. Existing host/type/stale filters continue to apply to local topology warnings. Compatibility ignore/restore calls the new numeric finding API; local topology ignores retain the existing project-policy path until separately migrated.

- [ ] **Step 7: Verify no duplicate findings or browser polling**

Add tests proving one compatibility finding appears once when Inspector, Canvas, and Audit are mounted together and that no timer-based request is started.

- [ ] **Step 8: Run all affected frontend tests**

Run:

```bash
bunx vitest run src/test/audit.test.ts src/test/audit-drawer.test.tsx src/test/inspector-panel.test.tsx src/components/workbook/systems-workspace.test.tsx src/test/compatibility-*.test.ts src/live-events
```

Expected: PASS.

- [ ] **Step 9: Commit the UI consolidation**

```bash
git add src/components src/lib/audit.ts src/lib/canvas-project-index.ts src/test
git commit -m "fix: unify compatibility findings across views"
```

---

### Task 8: Complete Release Documentation And End-To-End Verification

**Files:**
- Modify: `src/release-notes.ts`
- Modify: `CHANGELOG.md`
- Test: `src/test/release-notes.test.ts`
- Test: preservation and migration fixtures from Tasks 2-7.

**Interfaces:**
- Produces: an unreleased user-visible compatibility and migration entry.
- Does not produce: a version bump, tag, push, or deployment.

- [ ] **Step 1: Add structured unreleased notes and changelog entries**

Document:

- Shared server-side compatibility findings.
- Separate informational metadata gaps.
- Correct M.2 A/E physical matching.
- Ordinary non-ECC defaults.
- Exact assigned-slot auditing.
- CPU alias and expansion-power corrections.
- Automatic migration and SSE updates.

- [ ] **Step 2: Run focused migration and preservation proof**

Run the test fixture that records hashes/counts before and after migration and assert:

```text
assignments lost: 0
placements changed: 0
connections changed: 0
manual bends changed: 0
route cache changed: 0
private fields changed: 0
Registry links lost: 0
duplicate M.2 A/E resources: 0
ambiguous migrations applied: 0
```

- [ ] **Step 3: Run the complete validation suite**

Run:

```bash
bun run lint
bun run test
bun run build
```

Expected: all commands exit 0. Existing documented nonblocking warnings may remain; no new warnings are accepted.

- [ ] **Step 4: Run container security preflight**

Run:

```bash
bun run security:container
```

Expected: final distroless `linux/amd64` and `linux/arm64` images boot successfully, and Docker Scout plus Trivy report zero known vulnerabilities at every severity.

- [ ] **Step 5: Perform local browser verification**

Using a copied/sanitized data set, verify:

- Systems attention count matches Inspector and Canvas actionable counts.
- Inspector separates unverified details.
- Audit filtering and ignore/restore work.
- An M.2 A+E wired NIC assigned to the canonical slot has no WLAN-kind error.
- SSE updates all open views after an assignment or Registry change.
- Network logs show one open SSE connection and no compatibility polling requests.

- [ ] **Step 6: Commit documentation and final verification fixes**

```bash
git add src/release-notes.ts src/test/release-notes.test.ts CHANGELOG.md
git commit -m "docs: describe canonical compatibility audits"
```

- [ ] **Step 7: Report readiness without deploying**

Report commits, schema version, test counts, build result, security result, preservation assertions, and any Registry contract dependency. Do not bump the version or push until the user requests deployment.
