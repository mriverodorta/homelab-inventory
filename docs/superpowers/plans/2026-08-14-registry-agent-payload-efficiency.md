# Registry Update And Agent Polling Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make registry group decisions immediately reliable and reduce idle agent and registry network traffic to compact, purpose-specific payloads.

**Architecture:** Existing authenticated routes gain explicit compact response views while preserving detailed legacy responses. Registry decisions return compact authoritative outcomes that update TanStack Query caches directly; global agent polling uses a canonical lightweight host map while per-host telemetry remains the source of detailed inspector data.

**Tech Stack:** Bun, TypeScript, React, TanStack Query, server routes, bun:sqlite, Vitest, Testing Library.

## Global Constraints

- Global agent polling runs every 60 seconds and stops while the document is hidden.
- Detailed telemetry is fetched only for the selected host inspector.
- One registry group click performs one decision mutation.
- Registry decision responses must not contain every update group or complete project snapshots.
- Compact agent summaries must not contain metrics, disks, services, containers, network arrays, or storage-health arrays.
- Preserve existing permissions, demo restrictions, numeric relational IDs, and public legacy behavior.
- Update unreleased release notes and `CHANGELOG.md`; do not bump the app version.

---

### Task 1: Compact Registry Contracts

**Files:**
- Modify: `server/registry-routes.mjs`
- Modify: `server/persistence/sqlite-store.ts`
- Modify: `src/types/registry.ts`
- Modify: `src/lib/registry-api.ts`
- Test: `server/registry-routes.test.mjs`
- Test: `server/persistence/sqlite-store.bun_spec.ts`

**Interfaces:**
- Produces: `CatalogUpdateSummaryResponse`, `CatalogUpdateGroupsResponse`, and `CatalogUpdateDecisionResult`.
- Produces: compact `view=summary`, detailed `view=groups`, and compact decision responses.

- [ ] **Step 1: Write failing compact route and response-size tests.**

Assert summary omits `groups` and `updates`, groups omits `updates`, and a decision response serializes below 4096 bytes without a `groups` array.

- [ ] **Step 2: Write failing persistence outcome tests.**

Create two review groups, apply one, and assert only its evaluation becomes `applied`, its link becomes `linked`, the other remains `review`, and affected project/link IDs are returned.

- [ ] **Step 3: Add response types and API clients.**

```ts
type CatalogUpdateSummaryResponse = {
  run: CatalogUpdateRunStatus | null
  counts: { review: number; blocked: number; applied: number; declined: number }
}

type CatalogUpdateDecisionResult = {
  decisions: Array<{ templateKey: string; toRevision: number; status: 'applied' | 'declined' | 'review' }>
  summary: CatalogUpdateSummaryResponse
  affectedProjectIds: number[]
  affectedLinkIds: number[]
}
```

Expose `loadCatalogUpdateSummary()`, `loadCatalogUpdateGroups()`, and compact `decideCatalogUpdateGroups()`.

- [ ] **Step 4: Implement route views and compact decisions.**

Branch the existing GET route on `request.query.view`, retain its no-query legacy shape, and return compact authoritative mutation outcomes.

- [ ] **Step 5: Run focused backend tests.**

```bash
bun test server/registry-routes.test.mjs
bun test server/persistence/sqlite-store.bun_spec.ts
```

### Task 2: Reliable Registry Dialog State

**Files:**
- Modify: `src/components/inventory/registry-updates-dialog.tsx`
- Modify: `src/app/app.tsx`
- Modify: `src/components/notifications/notification-center.tsx`
- Modify: `src/components/inventory/catalog-update-review.tsx`
- Test: `src/test/registry-updates-dialog.test.tsx`
- Test: `src/test/notifications-ui.test.tsx`

**Interfaces:**
- Consumes: compact registry clients from Task 1.
- Produces: group-keyed pending/errors and direct cache reconciliation.

- [ ] **Step 1: Write failing isolated-pending tests.**

Render two cards, leave one decision unresolved, and assert only that card is pending while exactly one mutation call exists.

- [ ] **Step 2: Write failing immediate-removal tests.**

Resolve an applied result and assert the card leaves Review, appears under Applied, updates counts, and does not refetch detailed groups.

- [ ] **Step 3: Implement pending and error maps keyed by group ID.**

Show a spinner only on requested groups and ignore duplicate clicks for pending IDs.

- [ ] **Step 4: Reconcile caches from the decision response.**

Update `['registry', 'update-groups']` and `['registry', 'update-summary']` directly. Remove overlapping broad invalidations and refresh affected active project/registry state once.

- [ ] **Step 5: Move toolbar and notification consumers to compact summary.**

Keep the legacy per-link review on the legacy updates contract.

- [ ] **Step 6: Run focused UI tests.**

```bash
bun run test -- src/test/registry-updates-dialog.test.tsx src/test/notifications-ui.test.tsx
```

### Task 3: Compact Agent Availability Summary

**Files:**
- Modify: `server/agent-routes.mjs`
- Modify: `server/bootstrap-routes.mjs`
- Modify: `src/types/agent.ts`
- Modify: `src/lib/agent-api.ts`
- Modify: `src/components/inspector/agent/server-agent-status.ts`
- Modify: `src/components/server-card.tsx`
- Test: `server/agent-routes.test.mjs`
- Test: `server/bootstrap-routes.test.mjs`

**Interfaces:**
- Produces: canonical compact `AgentStatusSummary.hosts` records.
- Preserves: full per-host status from the telemetry route.

- [ ] **Step 1: Write failing compact-contract tests.**

Seed heavy host data and assert public status/bootstrap omit resource arrays, avoid duplicated server records, expose detail flags, and stay under a representative byte budget.

- [ ] **Step 2: Implement a pure compact projector.**

Retain identity, state, timestamps, version, hostname, detail flags, and upgrade metadata while keeping full status internal.

- [ ] **Step 3: Move frontend lookups to the canonical host map.**

Remove runtime dependence on duplicated `servers` records while retaining optional compatibility typing where needed.

- [ ] **Step 4: Run focused tests.**

```bash
bun test server/agent-routes.test.mjs server/bootstrap-routes.test.mjs
```

### Task 4: Per-Host Detail And One-Minute Polling

**Files:**
- Modify: `src/app/app.tsx`
- Modify: `src/components/inspector/agent/use-agent-telemetry.ts`
- Modify: `src/components/inspector/equipment/server-inspector-tabs.tsx`
- Modify: `src/components/inspector/equipment/nas-inspector-tabs.tsx`
- Modify: `src/components/inspector/equipment/pc-build-inspector-tabs.tsx`
- Modify: `src/components/inspector/network/server-network-tab.tsx`
- Test: `src/components/inspector/agent/use-agent-telemetry.test.tsx`
- Test: `src/test/inspector-panel.test.tsx`

**Interfaces:**
- Consumes: compact summary flags and full `AgentTelemetryRange.status`.
- Produces: shared selected-host detail with 60-second visible-page polling.

- [ ] **Step 1: Write failing cadence and visibility tests.**

Assert global and per-host polling use 60000 ms and do not run in the background.

- [ ] **Step 2: Use compact flags for dynamic tabs.**

Use boolean detail availability instead of global services/container arrays.

- [ ] **Step 3: Render detailed panels from the shared telemetry query.**

Merge compact and detailed status for the selected host and reuse one TanStack Query key across Agent, Services, Containers, Network, and storage panels.

- [ ] **Step 4: Run focused tests.**

```bash
bun run test -- src/components/inspector/agent/use-agent-telemetry.test.tsx src/test/inspector-panel.test.tsx
```

### Task 5: Documentation And Full Verification

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `src/release-notes.ts`

**Interfaces:**
- Documents: registry approval reliability and compact agent polling.

- [ ] **Step 1: Add consolidated unreleased notes.**

- [ ] **Step 2: Run complete verification.**

```bash
bun run lint
bun run test
bun run build
git diff --check
```

- [ ] **Step 3: Confirm request and payload invariants.**

Verify one click creates one POST, no immediate detail refetch occurs, compact status excludes heavy fields, and idle polling is once per minute.

- [ ] **Step 4: Commit implementation.**

```bash
git add CHANGELOG.md src server docs/superpowers/plans/2026-08-14-registry-agent-payload-efficiency.md
git commit -m "fix: streamline registry decisions and agent polling"
```

