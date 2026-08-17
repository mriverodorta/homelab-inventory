# Systems Workspace Operational Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the initial Systems workspace with a dense, project-scoped operational table backed by compact SQLite read models and active-tab-only live polling.

**Architecture:** Add a purpose-built Systems service that performs bounded bulk reads across the core and telemetry SQLite databases, then expose separate initial and live project endpoints with authorization and ETag support. The React workspace will own only presentation and browser-local table preferences, while the workbook shell will expose sidebars by workspace capability instead of rendering the Canvas inventory drawer globally.

**Tech Stack:** Bun, Express, bun:sqlite, TypeScript, React, TanStack Query, Vitest, Testing Library, Lucide, shadcn/ui.

## Global Constraints

- Keep the exact eight columns: `Type | Name | Manufacturer / Model | CPU | RAM | Storage | Agent | Registry`.
- Type and Registry columns use intrinsic width; Agent is content-sized; content columns share remaining width.
- Cells never scroll independently. The table viewport may scroll horizontally on narrow screens.
- CPU and RAM show only the latest utilization value, not metric history.
- Storage prefers an agent-inferred boot drive and otherwise uses the first assigned storage item.
- Poll every 30 seconds only while Systems is active, the document is visible, and the browser is online.
- Persist sidebar state per user, project, and workspace; persist Systems table preferences per user and project.
- Preserve current inventory, assignments, placements, cables, telemetry, registry links, and database schemas.
- Do not bump the application version, tag, push, or deploy during implementation.
- Update the structured unreleased release-note draft and `CHANGELOG.md` because this is user-visible.

---

### Task 1: Workspace-Aware Sidebar Ownership

**Files:**
- Create: `src/lib/browser-preference-scope.ts`
- Create: `src/lib/browser-preference-scope.test.ts`
- Modify: `src/lib/ui-preferences.ts`
- Modify: `src/app/use-workspace-preferences.ts`
- Modify: `src/app/app.tsx`
- Modify: `src/app/app-inventory-panels.tsx`
- Test: `src/test/inventory-sidebar.test.tsx`

**Interfaces:**
- Produces: `browserPreferenceScope(accountId: number | null, projectId: number, workspaceId?: number): string`.
- Produces: workspace-scoped inventory visibility and width accessors that accept the generated scope.
- Consumes: `useAuth().status.account?.id`, active project ID, active workspace ID, and workspace type.

- [ ] **Step 1: Add failing preference-scope tests**

Cover authenticated and authentication-disabled identities plus independent Canvas workspaces:

```ts
expect(browserPreferenceScope(7, 2, 11)).toBe('account:7:project:2:workspace:11')
expect(browserPreferenceScope(null, 2, 11)).toBe('device:anonymous:project:2:workspace:11')
```

Verify opening Canvas 11, switching to Systems, and returning to Canvas 11 preserves its open state and width, while Canvas 12 retains independent values.

- [ ] **Step 2: Run focused tests and verify the current global preference collision**

```bash
bunx vitest run src/lib/browser-preference-scope.test.ts src/test/inventory-sidebar.test.tsx
```

Expected: scoped preference symbols are missing and the current global keys cannot preserve independent workspace values.

- [ ] **Step 3: Implement scoped browser preference keys**

Use a stable suffix rather than storing account names or emails:

```ts
export function browserPreferenceScope(
  accountId: number | null,
  projectId: number,
  workspaceId?: number,
) {
  const actor = accountId ? `account:${accountId}` : 'device:anonymous'
  return [actor, `project:${projectId}`, workspaceId ? `workspace:${workspaceId}` : null]
    .filter(Boolean)
    .join(':')
}
```

Keep legacy global values as the fallback only for default project Canvas workspace 2, then persist future changes under the scoped key.

- [ ] **Step 4: Gate inventory panels by workspace capability**

Derive:

```ts
const inventorySidebarAvailable = workbookController.activeWorkspace?.type === 'canvas'
```

Do not render desktop or mobile inventory panels when false. Compute `projectControlOffset` from the effective visibility (`available && savedOpen`) without writing `false` into Canvas preferences.

- [ ] **Step 5: Verify scoped restoration and full-width Systems**

```bash
bunx vitest run src/lib/browser-preference-scope.test.ts src/test/inventory-sidebar.test.tsx src/test/app-persistence.test.tsx
```

Expected: Canvas state restores per workspace and Systems exposes neither inventory panel nor inventory toggle.

- [ ] **Step 6: Commit the sidebar boundary**

```bash
git add src/lib/browser-preference-scope.ts src/lib/browser-preference-scope.test.ts src/lib/ui-preferences.ts src/app/use-workspace-preferences.ts src/app/app.tsx src/app/app-inventory-panels.tsx src/test/inventory-sidebar.test.tsx
git commit -m "feat: scope workspace sidebars"
```

### Task 2: Shared Compute-Host Presentation Model

**Files:**
- Create: `src/lib/compute-host-presentation.ts`
- Create: `src/lib/compute-host-presentation.test.ts`
- Modify: `src/components/inventory-sidebar.tsx`
- Modify: `src/components/workbook/systems-workspace.tsx`

**Interfaces:**
- Produces: `resolveComputeHostPresentation(host): { iconKey: 'server' | 'monitor-cog' | 'database'; label: string }`.
- Consumes: host `type`, `hardwareClass`, and `usageRole`.

- [ ] **Step 1: Add the complete icon policy as failing tests**

```ts
expect(resolveComputeHostPresentation({ type: 'nas' }).iconKey).toBe('database')
expect(resolveComputeHostPresentation({ type: 'pcBuild', hardwareClass: 'workstation' }).iconKey).toBe('monitor-cog')
expect(resolveComputeHostPresentation({ type: 'pcBuild', usageRole: 'server' }).iconKey).toBe('server')
expect(resolveComputeHostPresentation({ type: 'server' }).iconKey).toBe('server')
```

- [ ] **Step 2: Run the resolver test and verify failure**

```bash
bunx vitest run src/lib/compute-host-presentation.test.ts
```

- [ ] **Step 3: Implement the pure resolver and one icon renderer**

Keep decision logic outside TSX and map the three keys to Lucide `Server`, `MonitorCog`, and `Database` in the presentation component.

- [ ] **Step 4: Replace local host-type icon decisions**

Use the resolver on the Systems table and Inventory sidebar entries that represent compute hosts. Do not change icons for non-host inventory types.

- [ ] **Step 5: Verify all resolver states**

```bash
bunx vitest run src/lib/compute-host-presentation.test.ts src/test/inventory-sidebar.test.tsx src/components/workbook/systems-workspace.test.tsx
```

- [ ] **Step 6: Commit the shared policy**

```bash
git add src/lib/compute-host-presentation.ts src/lib/compute-host-presentation.test.ts src/components/inventory-sidebar.tsx src/components/workbook/systems-workspace.tsx src/test/inventory-sidebar.test.tsx src/components/workbook/systems-workspace.test.tsx
git commit -m "refactor: centralize compute host icons"
```

### Task 3: Systems Core Read Model

**Files:**
- Create: `server/systems/model.ts`
- Create: `server/systems/read-service.ts`
- Create: `server/systems/read-service.bun_spec.ts`
- Modify: `server/telemetry/repository.mjs`
- Test: `server/telemetry/repository.bun_spec.mjs`

**Interfaces:**
- Produces: `SystemsReadService.initial(projectId): SystemsInitialResponse`.
- Produces: `SystemsReadService.live(projectId, latestAgentVersion): SystemsLiveResponse`.
- Produces: `TelemetryRepository.getLatestSystemsMetrics(hostItemIds)` returning one compact row per requested canonical host item ID.
- Consumes: core SQLite database, telemetry repository/database, and current time.

- [ ] **Step 1: Define the transport model**

Use numeric host IDs plus canonical host type at the API boundary:

```ts
export type SystemsHostRef = Readonly<{ type: 'server' | 'nas' | 'pcBuild'; id: number }>
export type SystemsLiveRow = SystemsHostRef & Readonly<{
  state: 'online' | 'stale' | 'offline' | 'unknown'
  version: string
  sequence: number
  cpuPercent: number | null
  memoryPercent: number | null
  storagePercent: number | null
}>
```

The initial row additionally includes `iconKey`, `name`, `assignedCount`, manufacturer/model, CPU/RAM/storage labels, agent registration/version/update metadata, registry linkage, and current utilization.

- [ ] **Step 2: Add failing read-model fixtures**

Build one project with server, NAS, PC, unrelated loose component, two identical CPUs, mixed-speed RAM, assigned storage, active/detached registry links, registered/unregistered agents, and telemetry. Assert:

```ts
expect(rows).toHaveLength(3)
expect(server.cpu.label).toBe('2x Intel Xeon Gold 6230')
expect(server.memory.label).toBe('32 GB DDR4 2666 MT/s')
expect(server.registry.linked).toBe(true)
expect(server.metrics).toEqual({ cpuPercent: 18.2, memoryPercent: 43.1, storagePercent: 84 })
```

Also cover boot-drive mapping and first-assigned storage fallback.

- [ ] **Step 3: Run focused backend tests and verify failure**

```bash
bun test server/systems/read-service.bun_spec.ts server/telemetry/repository.bun_spec.mjs
```

- [ ] **Step 4: Implement bounded bulk reads**

The service performs one core query for project-visible compute hosts, one aggregate query for assignments/components, one registry-link query, one active-agent query, and one telemetry bulk query. Bind every `IN (...)` value once per bounded collection; never invoke another HTTP route or loop over hosts with individual SQL reads.

Storage selection order is:

```text
agent boot-device identity matched to assigned storage -> first assigned storage -> no storage label
```

RAM speed uses the minimum assigned positive speed. Multi-socket identical CPUs collapse by normalized manufacturer and model.

- [ ] **Step 5: Add payload and query-count assertions**

Assert representative initial output is below 512 raw JSON bytes per system and live output below 256 bytes per registered host excluding the envelope. Instrument the test database query wrapper and assert a constant upper bound as host count grows from 3 to 100.

- [ ] **Step 6: Verify service behavior**

```bash
bun test server/systems/read-service.bun_spec.ts server/telemetry/repository.bun_spec.mjs
```

- [ ] **Step 7: Commit the backend read model**

```bash
git add server/systems server/telemetry/repository.mjs server/telemetry/repository.bun_spec.mjs
git commit -m "feat: add compact systems read model"
```

### Task 4: Authenticated Systems Endpoints And ETags

**Files:**
- Create: `server/systems/routes.mjs`
- Create: `server/systems/routes.test.mjs`
- Modify: `server/index.mjs`
- Modify: `server/auth/api-permissions.mjs`
- Modify: `server/auth/api-permissions.test.mjs`

**Interfaces:**
- Produces: `GET /api/projects/:projectId/systems`.
- Produces: `GET /api/projects/:projectId/systems/live`.
- Consumes: `SystemsReadService`, `withStore`, `telemetryRepository`, `agentReleaseService`, and `authorizationService`.

- [ ] **Step 1: Add failing authorization and route tests**

Assert both routes classify as protected `project.view` operations and perform a secondary `agents.view` authorization check before returning telemetry. They reject malformed project IDs, do not expose archived/missing projects, and cannot return another project’s hosts through identifier substitution.

- [ ] **Step 2: Add failing conditional-request tests**

```js
const first = await fetch(`${url}/api/projects/1/systems/live`)
const etag = first.headers.get('etag')
const unchanged = await fetch(`${url}/api/projects/1/systems/live`, {
  headers: { 'if-none-match': etag },
})
expect(unchanged.status).toBe(304)
expect(await unchanged.text()).toBe('')
```

Changing a sequence, state input, metric, registration, or current release version must change the ETag.

- [ ] **Step 3: Run route tests and verify missing policies/routes**

```bash
bunx vitest run server/systems/routes.test.mjs server/auth/api-permissions.test.mjs
```

- [ ] **Step 4: Register the endpoints**

Instantiate the service per request with the request’s resolved store so demo sessions remain isolated. The global API guard requires `project.view`; when authentication is enabled, the route then calls `authorizationService.authorize(request.authentication.account.id, 'agents.view')` and returns HTTP 403 when denied. Generate the live ETag from canonical JSON of only response-relevant fields and quote the SHA-256 digest. Return 304 before serializing the body when `If-None-Match` matches.

- [ ] **Step 5: Verify routes and authorization**

```bash
bunx vitest run server/systems/routes.test.mjs server/auth/api-permissions.test.mjs server/project-routes.test.mjs
```

- [ ] **Step 6: Commit the route contract**

```bash
git add server/systems/routes.mjs server/systems/routes.test.mjs server/index.mjs server/auth/api-permissions.mjs server/auth/api-permissions.test.mjs
git commit -m "feat: expose systems workspace read endpoints"
```

### Task 5: Client API, Polling, And Browser Preferences

**Files:**
- Create: `src/types/systems.ts`
- Create: `src/lib/systems-api.ts`
- Create: `src/lib/systems-api.test.ts`
- Create: `src/hooks/use-systems-workspace.ts`
- Create: `src/hooks/use-systems-workspace.test.tsx`
- Create: `src/lib/systems-preferences.ts`
- Create: `src/lib/systems-preferences.test.ts`

**Interfaces:**
- Produces: `loadSystems(projectId, signal)` and `loadSystemsLive(projectId, etag, signal)`.
- Produces: `useSystemsWorkspace({ projectId, active, preferenceScope })`.
- Produces: versioned browser preference `{ query, types, agent, registry, sortKey, sortDirection }`.

- [ ] **Step 1: Add failing API tests**

Verify project IDs are in paths, abort signals are forwarded, 304 returns `{ unchanged: true, etag }`, and non-2xx JSON errors surface their message.

- [ ] **Step 2: Add failing polling lifecycle tests**

Using fake timers, assert no request outside Systems, one live refresh after 30 seconds while active, pause while `document.visibilityState === 'hidden'`, pause while offline, resume once conditions recover, and cancellation on project change.

- [ ] **Step 3: Add failing preference tests**

Verify independent project keys, malformed-storage fallback, dynamic type pruning, clear-to-default behavior, and preservation of valid sort/filter values.

- [ ] **Step 4: Implement API and preference modules**

Use a versioned key:

```ts
`homelab-inventory:systems:v1:${preferenceScope}`
```

Never store host data or telemetry in local storage.

- [ ] **Step 5: Implement active-only TanStack Query flow**

Initial query key:

```ts
['systems', projectId, 'initial']
```

Live query key:

```ts
['systems', projectId, 'live']
```

Use `enabled: active`, `refetchInterval: active && visible && online ? 30_000 : false`, and merge only live fields by `type:id`. Preserve last valid data on background failure and expose `liveDelayed` after repeated failure.

- [ ] **Step 6: Verify client behavior**

```bash
bunx vitest run src/lib/systems-api.test.ts src/lib/systems-preferences.test.ts src/hooks/use-systems-workspace.test.tsx
```

- [ ] **Step 7: Commit the client data layer**

```bash
git add src/types/systems.ts src/lib/systems-api.ts src/lib/systems-api.test.ts src/lib/systems-preferences.ts src/lib/systems-preferences.test.ts src/hooks/use-systems-workspace.ts src/hooks/use-systems-workspace.test.tsx
git commit -m "feat: add systems workspace live queries"
```

### Task 6: Dense Systems Table UI

**Files:**
- Create: `src/components/workbook/systems/system-status-icon.tsx`
- Create: `src/components/workbook/systems/system-utilization-bar.tsx`
- Create: `src/components/workbook/systems/system-filters.tsx`
- Create: `src/components/workbook/systems/system-row.tsx`
- Create: `src/components/workbook/systems/systems-table.tsx`
- Create: `src/components/workbook/systems/systems-table-model.ts`
- Create: `src/components/workbook/systems/systems-table-model.test.ts`
- Modify: `src/components/workbook/systems-workspace.tsx`
- Modify: `src/components/workbook/systems-workspace.test.tsx`
- Modify: `src/app/app-workspace-surface.tsx`
- Modify: `src/app/create-workspace-surface-props.ts`
- Modify: `src/app/app.tsx`

**Interfaces:**
- Consumes: `useSystemsWorkspace`, `resolveComputeHostPresentation`, and `onSelectItem(type + ':' + id)`.
- Produces: dense responsive table, dynamic filters, all-column sorting, keyboard row activation, and update-command copying.

- [ ] **Step 1: Add pure model tests for search/filter/sort**

Cover search across all visible labels, dynamic type options from unfiltered data, multi-type selection, agent and registry filters, Name ascending default, all column sorts, and utilization-null-last in both directions.

- [ ] **Step 2: Add failing UI interaction tests**

Assert exact column headers, intrinsic marker classes, absence of action column, row click/Enter/Space selection, nested update button propagation prevention, clipboard success/failure toast, accessible icon labels, table-level overflow, no cell overflow class, skeletons, initial retry, and `Live data delayed` recovery.

- [ ] **Step 3: Run focused UI tests and verify failure**

```bash
bunx vitest run src/components/workbook/systems-workspace.test.tsx src/components/workbook/systems/systems-table-model.test.ts
```

- [ ] **Step 4: Implement the pure table model**

Keep filtering and sorting outside TSX. Use semantic sort values: resolved type label, lowercase name/manufacturer/model, utilization for CPU/RAM/Storage, state rank for Agent, and linked boolean for Registry.

- [ ] **Step 5: Implement the dense components**

Use shadcn controls and Lucide icons. The utilization bar is exactly one text-line high, has fixed layout, CSS tick divisions at 25/50/75 percent, and a restrained width transition. Storage colors change at 80 and 90 percent. Missing telemetry omits the entire bar line.

The row uses `tabIndex={0}` and keyboard handling:

```ts
if (event.key === 'Enter' || event.key === ' ') {
  event.preventDefault()
  onSelect()
}
```

- [ ] **Step 6: Wire inspector Escape behavior**

Reuse the inspector close callback. Add Escape handling at the inspector layer only when no dialog/overlay owns the event; do not close the inspector from text inputs or while a modal is open.

- [ ] **Step 7: Verify UI behavior**

```bash
bunx vitest run src/components/workbook/systems-workspace.test.tsx src/components/workbook/systems/systems-table-model.test.ts src/test/inspector-panel.test.tsx
```

- [ ] **Step 8: Commit the operational table**

```bash
git add src/components/workbook/systems src/components/workbook/systems-workspace.tsx src/components/workbook/systems-workspace.test.tsx src/app/app-workspace-surface.tsx src/app/create-workspace-surface-props.ts src/app/app.tsx src/test/inspector-panel.test.tsx
git commit -m "feat: build systems operational table"
```

### Task 7: Release Documentation And Full Verification

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `src/release-notes.ts`

**Interfaces:**
- Consumes: completed sidebar, endpoint, polling, and table behavior.
- Produces: release-ready documentation and verified source tree without version changes.

- [ ] **Step 1: Add consolidated unreleased documentation**

Describe the Systems operational table, compact live telemetry refresh, dynamic filters, agent update state, registry state, full-row inspector navigation, and Canvas-only inventory sidebar in one user-facing feature group.

- [ ] **Step 2: Run focused test groups**

```bash
bunx vitest run src/components/workbook src/hooks/use-systems-workspace.test.tsx src/lib/systems-api.test.ts src/lib/systems-preferences.test.ts src/test/inventory-sidebar.test.tsx src/test/inspector-panel.test.tsx
bun test server/systems/read-service.bun_spec.ts server/telemetry/repository.bun_spec.mjs
bunx vitest run server/systems/routes.test.mjs server/auth/api-permissions.test.mjs
```

- [ ] **Step 3: Run standard project checks**

```bash
bun run lint
bun run test
bun run build
```

- [ ] **Step 4: Review source safety and diff quality**

```bash
git diff --check
git status --short
git diff --stat
rg -n "inv\.hkloud\.org|10\.10\.|100\." src server docs CHANGELOG.md
```

Confirm no private runtime data, credentials, screenshots, or `.superpowers/` artifacts are staged.

- [ ] **Step 5: Commit the completed feature**

```bash
git add CHANGELOG.md src/release-notes.ts
git commit -m "docs: document systems operational workspace"
```
