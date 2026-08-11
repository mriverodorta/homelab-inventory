# Multi-Project Workbooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the existing relational project and workspace model, migrate the current installation into `Default Project`, and add an Excel-style workbook interface with global and project-bound inventory.

**Architecture:** The SQLite core database remains authoritative. Project/workspace repositories expose numeric-ID commands and coarse read models; existing `ProjectState` is retained as the Canvas workspace compatibility projection while APIs become explicitly scoped by project and workspace. The frontend keeps one active route `/projects/:projectId/workspaces/:workspaceId`, a fixed Systems workspace, and a bottom workbook strip, with browser-only last-active preferences.

**Tech Stack:** Bun 1.3.14, SQLite 3.53.0, `bun:sqlite`, Drizzle ORM 0.45.2, React 19, TanStack Query 5, native History API, dnd-kit, Lucide React, Vitest, Bun test, distroless Docker.

## Global Constraints

- Work only on the local `sqlite-migration` branch; do not push, tag, deploy, or bump the application version.
- Preserve project `1`, Systems workspace `1`, and Canvas workspace `2` for migrated installations.
- Preserve every existing item, assignment, placement, cable, bend, route cache, Registry link, Agent binding, user, role, notification, and setting.
- Keep the Systems workspace fixed first with immutable name, icon, color, and type.
- Every project must retain at least one Canvas workspace; new projects create Systems and Canvas atomically and default to Canvas.
- Project names are unique among active projects; projects have no colors.
- Workspace colors and icons come from curated code-defined allowlists.
- Global inventory access defaults to enabled, but global library items appear in a project only through membership.
- Cross-project duplication creates an unassigned project-bound item, clears serial and Agent identity, and copies no assignments, placements, connections, Registry links, or telemetry.
- Browser last-active workspace preferences are local-only, not backed up or synchronized.
- Rack, VLAN, project duplication, and project ACLs are not implemented in this milestone.
- All primary and foreign keys remain positive safe integers; runtime `type:id` keys stay at API/view boundaries only.
- Update Unreleased changelog and structured release notes for user-visible behavior; do not finalize a release.
- Run `bun run lint`, `bun run test`, `bun run build`, and `bun run security:container` before declaring completion.

---

### Task 1: Complete Project And Workspace Repository Commands

**Files:**
- Modify: `server/persistence/core/repositories/project-repository.ts`
- Modify: `server/persistence/core/repositories/repositories.bun_spec.ts`
- Create: `server/persistence/core/projects/project-contract.ts`
- Create: `server/persistence/core/projects/project-contract.bun_spec.ts`

**Interfaces:**
- Produces: `ProjectSummary`, `WorkspaceSummary`, `ProjectWorkbook`, `updateWorkspace`, `reorderWorkspaces`, `archiveWorkspace`, `restoreProject`, `deleteArchivedProject`, and `getWorkbook`.
- Consumes: existing `projects`, `projectPreferences`, `workspaces`, and `canvasWorkspaces` tables.

- [ ] **Step 1: Write failing project invariant tests**

```ts
expect(repository.getWorkbook(1)).toMatchObject({
  project: { id: 1, name: 'Default Project' },
  defaultWorkspaceId: 2,
  workspaces: [
    { id: 1, type: 'systems', sortOrder: 0 },
    { id: 2, type: 'canvas', sortOrder: 1 },
  ],
})

expect(() => repository.archiveWorkspace(1, 1)).toThrow('Systems')
expect(() => repository.archiveWorkspace(1, onlyCanvasId)).toThrow('at least one Canvas')
```

Cover curated icon/color validation, contiguous sort order, cross-project default rejection, archived project restoration, and dependency-aware permanent deletion.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `bun test server/persistence/core/projects/*.bun_spec.ts server/persistence/core/repositories/repositories.bun_spec.ts`

Expected: FAIL because the commands and public contracts are missing.

- [ ] **Step 3: Add stable contracts and allowlists**

```ts
export const WORKSPACE_ICON_KEYS = ['network', 'layout-grid', 'boxes', 'route', 'chart-no-axes-column'] as const
export const WORKSPACE_COLOR_KEYS = ['blue', 'green', 'amber', 'red', 'violet', 'cyan', 'pink', 'gray'] as const

export type ProjectWorkbook = Readonly<{
  project: ProjectSummary
  defaultWorkspaceId: number
  workspaces: readonly WorkspaceSummary[]
}>
```

Project icons use their own curated keys and never expose arbitrary Lucide component names from persisted input.

- [ ] **Step 4: Implement transactional workspace lifecycle**

Renaming and styling increment only the workspace revision. Reordering writes one contiguous sequence after Systems and bumps affected workspace revisions. Archiving a workspace selects a valid fallback default in the same transaction. Permanent project deletion is allowed only after archive and returns exact dependency counts before execution.

- [ ] **Step 5: Run focused tests**

Run: `bun test server/persistence/core/projects/*.bun_spec.ts server/persistence/core/repositories/repositories.bun_spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/persistence/core/projects server/persistence/core/repositories
git commit -m "feat: complete project workbook repository"
```

---

### Task 2: Add Project And Workspace APIs

**Files:**
- Create: `server/workspace-routes.mjs`
- Create: `server/workspace-routes.test.mjs`
- Modify: `server/project-routes.mjs`
- Modify: `server/project-routes.test.mjs`
- Modify: `server/index.mjs`
- Modify: `server/auth/api-permissions.mjs`
- Modify: `server/persistence/sqlite-store.ts`
- Modify: `Dockerfile`

**Interfaces:**
- Produces: `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:projectId`, `GET /api/projects/:projectId/workbook`, workspace create/update/reorder/archive routes, and `GET/PUT /api/projects/:projectId/workspaces/:workspaceId`.
- Consumes: Task 1 repository contracts and existing `ProjectState` compatibility projection.

- [ ] **Step 1: Write failing route tests**

```js
expect(await getJson('/api/projects')).toEqual({
  projects: [expect.objectContaining({ id: 1, name: 'Default Project' })],
})

expect(await getJson('/api/projects/1/workspaces/2')).toMatchObject({
  id: 'default',
  metadata: { projectId: 1, workspaceId: 2 },
})
```

Test malformed IDs, cross-project workspace access, duplicate names, immutable Systems metadata, stale revisions, and archive safety errors.

- [ ] **Step 2: Run route tests and verify failure**

Run: `bunx vitest run server/project-routes.test.mjs server/workspace-routes.test.mjs`

Expected: FAIL because scoped routes are absent.

- [ ] **Step 3: Expose scoped store methods**

```ts
listProjects()
getProjectWorkbook(projectId: number)
getWorkspace(projectId: number, workspaceId: number): ProjectState
setWorkspace(projectId: number, workspaceId: number, submitted: ProjectState): ProjectState
```

Store methods build scoped read models on demand; they must not mutate the singleton store's default project/workspace IDs.

- [ ] **Step 4: Register APIs and authorization mappings**

Use existing project view/manage permissions while passing `{ projectId }` as optional authorization scope. Keep `/api/project` as a temporary alias for project `1`, workspace `2` until frontend and Agent callers are migrated.

- [ ] **Step 5: Update distroless runtime allowlist and run tests**

Run: `bunx vitest run server/project-routes.test.mjs server/workspace-routes.test.mjs && bun scripts/verify-wasm-runtime.mjs .`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/workspace-routes.mjs server/workspace-routes.test.mjs server/project-routes.mjs server/project-routes.test.mjs server/index.mjs server/auth/api-permissions.mjs server/persistence/sqlite-store.ts Dockerfile
git commit -m "feat: add project-scoped workspace APIs"
```

---

### Task 3: Activate Global And Project-Bound Inventory Scope

**Files:**
- Create: `server/persistence/core/inventory/inventory-scope-service.ts`
- Create: `server/persistence/core/inventory/inventory-scope-service.bun_spec.ts`
- Modify: `server/persistence/core/repositories/inventory-repository.ts`
- Modify: `server/inventory-routes.mjs`
- Modify: `server/inventory-routes.test.mjs`
- Modify: `server/db/inventory-input.mjs`
- Modify: `src/types/inventory.ts`

**Interfaces:**
- Produces: `setInventoryScope`, `addGlobalMembership`, `removeGlobalMembership`, `duplicateToProject`, and project-scoped inventory create/update APIs.
- Consumes: project membership and inventory ownership constraints already present in SQLite.

- [ ] **Step 1: Write failing scope tests**

```ts
expect(service.setScope(itemId, { scope: 'global' })).toMatchObject({ id: itemId, scope: 'global' })
expect(() => service.setScope(globalId, { scope: 'project', projectId: 2 }))
  .toThrow('exactly one project membership')

const duplicate = service.duplicateToProject(globalId, 2)
expect(duplicate).toMatchObject({ scope: 'project', ownerProjectId: 2, serialNumber: null })
```

Assert that duplicates have no Registry links, Agent bindings, assignments, placements, connections, or telemetry and receive fresh canonical and legacy alias IDs.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `bun test server/persistence/core/inventory/inventory-scope-service.bun_spec.ts`

Expected: FAIL because scope services are absent.

- [ ] **Step 3: Implement scope transitions and membership guards**

Project-bound to global preserves the canonical item ID. Global to project-bound requires exactly one membership. Disabling `includesGlobalInventory` is blocked while the project has global memberships or topology references.

- [ ] **Step 4: Add APIs**

```text
POST /api/inventory/items/:type/:id/scope
POST /api/projects/:projectId/inventory/:type/:id/membership
DELETE /api/projects/:projectId/inventory/:type/:id/membership
POST /api/projects/:projectId/inventory/:type/:id/duplicate
```

All responses return the affected project/workspace read model and targeted item identity.

- [ ] **Step 5: Run tests**

Run: `bun test server/persistence/core/inventory/inventory-scope-service.bun_spec.ts && bunx vitest run server/inventory-routes.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/persistence/core/inventory server/persistence/core/repositories/inventory-repository.ts server/inventory-routes.mjs server/inventory-routes.test.mjs server/db/inventory-input.mjs src/types/inventory.ts
git commit -m "feat: add project-aware inventory scope"
```

---

### Task 4: Expand Bootstrap And Add Route-State Client

**Files:**
- Modify: `server/bootstrap-routes.mjs`
- Modify: `server/bootstrap-routes.test.mjs`
- Modify: `src/lib/bootstrap-contract.ts`
- Create: `src/lib/workbook-api.ts`
- Create: `src/lib/workbook-api.test.ts`
- Create: `src/lib/workspace-route.ts`
- Create: `src/lib/workspace-route.test.ts`
- Modify: `src/lib/db.ts`

**Interfaces:**
- Produces: `ApplicationBootstrap.projects`, `ApplicationBootstrap.activeProjectPreference`, `parseWorkspaceRoute`, `navigateWorkspace`, `subscribeWorkspaceRoute`, and typed project/workspace mutations.
- Consumes: scoped APIs from Tasks 2-3.

- [ ] **Step 1: Write failing bootstrap and routing tests**

```ts
expect(parseWorkspaceRoute('/projects/2/workspaces/7')).toEqual({ projectId: 2, workspaceId: 7 })
expect(parseWorkspaceRoute('/projects/no/workspaces/7')).toBeNull()

expect(bootstrap.projects[0]).toMatchObject({ id: 1, defaultWorkspaceId: 2 })
```

Test browser Back/Forward subscription, route replacement for invalid IDs, and fallback order of browser last-active, project default, initial Canvas, then Systems.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `bunx vitest run src/lib/workbook-api.test.ts src/lib/workspace-route.test.ts server/bootstrap-routes.test.mjs`

Expected: FAIL because route-state and project bootstrap contracts are absent.

- [ ] **Step 3: Add lightweight bootstrap metadata**

Bootstrap contains project summaries and workspace metadata only; the selected workspace payload remains one separate scoped query so project switching does not inflate every startup response.

- [ ] **Step 4: Implement URL state with native History API**

Only validated positive IDs enter application state. `pushState` is used for user navigation, `replaceState` for invalid-route correction, and `popstate` for Back/Forward. No workspace payload is stored in browser history.

- [ ] **Step 5: Run focused tests**

Run: `bunx vitest run src/lib/workbook-api.test.ts src/lib/workspace-route.test.ts server/bootstrap-routes.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/bootstrap-routes.mjs server/bootstrap-routes.test.mjs src/lib/bootstrap-contract.ts src/lib/workbook-api.ts src/lib/workbook-api.test.ts src/lib/workspace-route.ts src/lib/workspace-route.test.ts src/lib/db.ts
git commit -m "feat: add workbook bootstrap and routing"
```

---

### Task 5: Add Project Switcher And Project Management

**Files:**
- Create: `src/components/workbook/project-switcher.tsx`
- Create: `src/components/workbook/project-switcher.test.tsx`
- Create: `src/components/workbook/project-dialog.tsx`
- Create: `src/components/workbook/project-settings.tsx`
- Create: `src/components/workbook/project-icon.tsx`
- Modify: `src/app/app.tsx`
- Modify: `src/app/app-shell.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Produces: compact top-header project switcher and create/edit/archive project dialogs.
- Consumes: project bootstrap/query mutations and route-state functions from Task 4.

- [ ] **Step 1: Write failing component tests**

```tsx
expect(screen.getByRole('button', { name: /Default Project/i })).toBeVisible()
await user.click(screen.getByRole('menuitem', { name: /New Project/i }))
expect(screen.getByRole('dialog', { name: /Create project/i })).toBeVisible()
```

Test unique-name errors, global-items default enabled, no project color selector, and navigation to the new project's Canvas after successful creation.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `bunx vitest run src/components/workbook/project-switcher.test.tsx`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Build project controls with existing shadcn primitives**

Use compact icon-and-name trigger, searchable project list, explicit create command, and confirmation dialogs for archive/delete. Keep project management quiet and work-focused; do not place it in a marketing-style card.

- [ ] **Step 4: Integrate active project state**

Required Canvas saves settle before project navigation. A failed save keeps the old route and project. Successful navigation clears selection/history only after the next workspace payload is available.

- [ ] **Step 5: Run focused tests**

Run: `bunx vitest run src/components/workbook/project-switcher.test.tsx src/test/app-persistence.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/workbook src/app/app.tsx src/app/app-shell.tsx src/index.css
git commit -m "feat: add project switcher and lifecycle UI"
```

---

### Task 6: Add Systems Workspace

**Files:**
- Create: `src/components/workbook/systems-workspace.tsx`
- Create: `src/components/workbook/systems-workspace.test.tsx`
- Create: `src/components/workbook/systems-table-columns.tsx`
- Create: `src/components/workbook/use-systems-query.ts`
- Modify: `src/app/app-workspace-surface.tsx`
- Modify: `src/components/lazy-app-surfaces.tsx`

**Interfaces:**
- Produces: project-member compute-host table for `server`, `nas`, and `pcBuild` physical classes including desktop/workstation records represented through server inventory.
- Consumes: active project/workspace metadata and project-scoped inventory read model.

- [ ] **Step 1: Write failing Systems tests**

```tsx
expect(screen.getByRole('heading', { name: 'Systems' })).toBeVisible()
expect(screen.getByText('HP EliteDesk 800 G6')).toBeVisible()
expect(screen.queryByText('Unassigned global CPU')).not.toBeInTheDocument()
```

Test search, type/status filters, empty project state, archived exclusion, responsive columns, and opening the existing inspector from a row.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `bunx vitest run src/components/workbook/systems-workspace.test.tsx`

Expected: FAIL because Systems has no surface.

- [ ] **Step 3: Implement a dense table workspace**

Columns are Name, Physical class, Usage role, Manufacturer/Model, Agent state, Registry state, and project assignment summary. Use unframed full-width layout and existing badges/icons. Do not implement rack placement or telemetry charts here.

- [ ] **Step 4: Lazy-load Systems and switch surfaces by workspace type**

Canvas controllers mount only for Canvas workspaces. Systems does not initialize React Flow, routing WASM queries, or Canvas autosave.

- [ ] **Step 5: Run focused tests**

Run: `bunx vitest run src/components/workbook/systems-workspace.test.tsx src/test/app-persistence.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/workbook src/app/app-workspace-surface.tsx src/components/lazy-app-surfaces.tsx
git commit -m "feat: add Systems workspace"
```

---

### Task 7: Add Bottom Workbook Tabs

**Files:**
- Create: `src/components/workbook/workbook-tab-strip.tsx`
- Create: `src/components/workbook/workbook-tab-strip.test.tsx`
- Create: `src/components/workbook/workspace-dialog.tsx`
- Create: `src/components/workbook/workspace-icon.tsx`
- Create: `src/components/workbook/workspace-style.ts`
- Modify: `src/app/app-shell.tsx`
- Modify: `src/app/app-workspace-surface.tsx`
- Modify: `src/components/canvas/workbench-canvas.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Produces: fixed Systems tab, reorderable Canvas tabs, create/rename/style/archive commands, and the final viewport bottom edge.
- Consumes: Task 4 routing and Task 2 workspace APIs.

- [ ] **Step 1: Write failing tab-strip tests**

```tsx
expect(screen.getAllByRole('tab')[0]).toHaveTextContent('Systems')
expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-disabled', 'true')
expect(screen.getByRole('tab', { name: 'Canvas' })).toHaveAttribute('aria-selected', 'true')
```

Test keyboard access, controlled colors/icons, rename, drag reorder, one-Canvas deletion guard, tab overflow, and no status footer beneath the strip.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `bunx vitest run src/components/workbook/workbook-tab-strip.test.tsx`

Expected: FAIL because the strip does not exist.

- [ ] **Step 3: Build stable-dimension tab controls**

The strip is `flex-none` at the viewport bottom. Tabs attach to the strip's top edge while the selected color edge touches the browser bottom, matching the approved Excel-style direction. Labels truncate only after allowing a practical minimum width; full names remain in tooltips.

- [ ] **Step 4: Integrate Canvas toolbar offset and navigation safety**

The floating toolbar bottom aligns immediately above the strip. Workspace navigation settles pending saves; a failed save leaves the current tab selected. Reordering persists only after drag end and does not remount the current Canvas.

- [ ] **Step 5: Run focused tests**

Run: `bunx vitest run src/components/workbook/workbook-tab-strip.test.tsx src/test/app-persistence.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/workbook src/app/app-shell.tsx src/app/app-workspace-surface.tsx src/components/canvas/workbench-canvas.tsx src/index.css
git commit -m "feat: add workbook workspace tabs"
```

---

### Task 8: Add Defaults, Last-Active Preference, And Workspace-Scoped Settings

**Files:**
- Create: `src/lib/workspace-preference.ts`
- Create: `src/lib/workspace-preference.test.ts`
- Create: `src/components/settings/project-settings.tsx`
- Modify: `src/app/use-workspace-preferences.ts`
- Modify: `src/components/settings-dialog.tsx`
- Modify: `server/persistence/core/repositories/project-repository.ts`
- Modify: `server/workspace-routes.mjs`

**Interfaces:**
- Produces: browser-wide `useLastActiveWorkspace`, per-project last workspace map, per-project default workspace setting, and workspace-scoped Canvas settings.
- Consumes: workbook metadata and scoped routes.

- [ ] **Step 1: Write failing preference tests**

```ts
expect(resolveOpeningWorkspace({ useLastActive: true, lastActive: 7, defaultId: 2, workspaces })).toBe(7)
expect(resolveOpeningWorkspace({ useLastActive: false, lastActive: 7, defaultId: 2, workspaces })).toBe(2)
```

Cover missing/archived workspaces, malformed local storage, project switching, and fallback to first Canvas then Systems.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `bunx vitest run src/lib/workspace-preference.test.ts`

Expected: FAIL because the resolver is absent.

- [ ] **Step 3: Implement browser and project settings**

Store one versioned browser payload under `homelab-inventory.workbook-preferences`. Project settings persist default workspace and global inventory access. Canvas snapping, collision, cable visibility, and viewport use `canvas_workspaces.settings_json` and workspace revision rather than application-wide metadata.

- [ ] **Step 4: Run tests**

Run: `bunx vitest run src/lib/workspace-preference.test.ts src/test/workspace-preferences.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workspace-preference* src/components/settings/project-settings.tsx src/app/use-workspace-preferences.ts src/components/settings-dialog.tsx server/persistence/core/repositories/project-repository.ts server/workspace-routes.mjs
git commit -m "feat: add project workspace defaults"
```

---

### Task 9: Upgrade Backup, Restore, Demo, And Migration Verification

**Files:**
- Modify: `server/backup/sqlite-section-exporter.ts`
- Modify: `server/backup/sqlite-restore-staging.ts`
- Modify: `server/backup/backup-sections.mjs`
- Modify: `shared/backup/contract.mjs`
- Modify: `server/demo/session-manager.mjs`
- Modify: `server/persistence/migration/core-importer.ts`
- Modify: `server/persistence/migration/core-verifier.ts`
- Create: `server/persistence/parity/multi-project-recovery.bun_spec.ts`
- Modify: backup and demo tests adjacent to each file.

**Interfaces:**
- Produces: logical `projects`, `workspaceLayouts`, membership, and project topology sections with dependency-aware selective restore.
- Consumes: stable numeric project/workspace IDs and current backup format 2 staging.

- [ ] **Step 1: Write failing round-trip and recovery tests**

Create two projects, three Canvas workspaces, one global item with two memberships, one project-bound duplicate, independent placements, and independent cables. Export complete data, restore only project/workspace sections into staging, and assert exact IDs and foreign keys.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `bun test server/persistence/parity/multi-project-recovery.bun_spec.ts server/backup/*.bun_spec.{js,mjs,ts}`

Expected: FAIL because current logical export projects only the default workspace.

- [ ] **Step 3: Implement logical multi-project export and restore**

Selective restore rejects workspace layout without projects/memberships when references would break. Registry enrollment remains installation-level. Browser last-active preferences are never archived. Route cache is optional per workspace and may be omitted safely.

- [ ] **Step 4: Verify migration and demo behavior**

Legacy migration must always create IDs `1`, `1`, and `2`, project-bound memberships, and Canvas default. Demo sessions clone the project/workspace model into session isolation and cannot read or mutate another session's project records.

- [ ] **Step 5: Run focused tests**

Run: `bun test server/persistence/parity/multi-project-recovery.bun_spec.ts server/backup/*.bun_spec.{js,mjs,ts} server/demo/*.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/backup shared/backup server/demo server/persistence/migration server/persistence/parity
git commit -m "feat: preserve multi-project backup and recovery"
```

---

### Task 10: End-To-End Verification And Documentation

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `src/release-notes.ts`
- Modify: `README.md`
- Modify: `DOCKERHUB.md`
- Modify: `docs/DATA.md`
- Modify: `docs/SQLITE_MIGRATION.md`
- Create: `docs/PROJECTS_AND_WORKSPACES.md`
- Add or modify focused browser/API tests under `src/test` and `server`.

**Interfaces:**
- Produces: documented migration and verified project/workbook behavior.
- Consumes: all prior tasks.

- [ ] **Step 1: Add end-to-end tests**

Verify initial migration, project creation, Systems/Canvas switching, direct URL refresh, Back/Forward, Canvas save before navigation, global membership, cross-project duplication, workspace reorder, project default, browser last-active, backup/restore, and demo isolation.

- [ ] **Step 2: Run correctness and performance checks**

Run:

```bash
bun run db:migrations:check
bun run lint
bun run test
bun run build
```

Expected: PASS, with only previously accepted lint warnings.

Confirm normal authenticated startup remains within auth + bootstrap + selected-workspace requests before background polling and that switching Systems does not initialize Canvas routing.

- [ ] **Step 3: Update user documentation**

Document project switching, Systems, Canvas tabs, scope semantics, defaults, backup behavior, migration of existing users to `Default Project`, and deferred rack/project-ACL features. Keep Docker Hub concise and aligned with README.

- [ ] **Step 4: Run container security preflight**

Run: `bun run security:container`

Expected: final distroless images build and boot on `linux/amd64` and `linux/arm64`; Docker Scout and Trivy report zero vulnerabilities at every severity.

- [ ] **Step 5: Review safety and commit**

Run:

```bash
git diff --check
git status --short
git ls-files | rg '(^|/)data/|(^|/)\.env($|\.)|installation-ed25519|installation-credentials|\.sqlite(-wal|-shm)?$'
```

Confirm no runtime data, credentials, private screenshots, or database files are staged.

```bash
git add CHANGELOG.md src/release-notes.ts README.md DOCKERHUB.md docs src server shared Dockerfile package.json bun.lock
git commit -m "docs: explain multi-project workbooks"
```

---

## Execution

The user selected Inline Execution. Execute Tasks 1-10 in order, use focused tests before each commit, and stop only for a genuine data-safety ambiguity or failing invariant that cannot be resolved from the approved design.
