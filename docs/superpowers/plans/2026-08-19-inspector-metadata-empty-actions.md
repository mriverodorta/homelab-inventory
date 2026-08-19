# Inspector Metadata Empty Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add permission-aware empty-state actions in the inspector Metadata tab that open the existing Settings dialog on the matching Inventory metadata subtab.

**Architecture:** `App` owns a typed, revisioned Settings destination and passes it to both the Settings dialog and inspector surface. The inspector exposes only a narrow metadata-settings callback through its existing context. Settings category and metadata-subtab components reconcile the requested destination while the form remains presentation-only.

**Tech Stack:** React 19, TypeScript, TanStack Query, shadcn/ui Dialog/Tabs/Button, Lucide icons, Vitest, Testing Library.

## Global Constraints

- Remove `Installation-defined data that stays outside Registry catalog content.` from the inspector.
- Show `New tag` when no active tags are available.
- Show `New custom field` whenever no field applies to the selected item type, even if other installation fields exist.
- Show creation actions only with `inventory.metadata.manage`.
- Open the existing Settings dialog on Inventory metadata and the requested subtab.
- Preserve the selected item and open inspector while Settings is open.
- Do not modify shared shadcn component source.
- Do not bump the application version.
- Leave `.superpowers/` untouched.

---

### Task 1: Controlled Settings Destination

**Files:**
- Modify: `src/components/settings-dialog.tsx`
- Modify: `src/components/settings/inventory-metadata/inventory-metadata-settings.tsx`
- Modify: `src/app/create-settings-dialog-props.ts`
- Modify: `src/app/app.tsx`
- Test: `src/test/settings-dialog.test.tsx`
- Test: `src/test/inventory-metadata-settings.test.tsx`

**Interfaces:**
- Produces: `InventoryMetadataSettingsTab = 'fields' | 'tags'`.
- Produces: `SettingsDestination` with `requestId`, `category`, and optional `inventoryMetadataTab`.
- Produces: `SettingsDialogProps.destination?: SettingsDestination | null`.
- Consumes later: `openInventoryMetadataSettings(tab: InventoryMetadataSettingsTab)` from `App`.

- [ ] **Step 1: Write failing Settings destination tests**

Add coverage proving a destination selects the Inventory metadata category and
Tags subtab, then a newer request selects Custom fields. Verify ordinary
Settings rendering still starts with General when no destination is supplied.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
bun run test -- src/test/settings-dialog.test.tsx src/test/inventory-metadata-settings.test.tsx
```

Expected: failure because destination props and controlled metadata tabs do not
exist.

- [ ] **Step 3: Implement controlled destination state**

Add these public contracts:

```ts
export type InventoryMetadataSettingsTab = 'fields' | 'tags'

export type SettingsDestination = Readonly<{
  requestId: number
  category: SettingsCategory
  inventoryMetadataTab?: InventoryMetadataSettingsTab
}>
```

`SettingsDialog` must reconcile `category` when an open destination request
changes. `InventoryMetadataSettings` must use controlled Tabs state and
reconcile `requestedTab` when `requestId` changes.

In `App`, add a monotonically increasing request counter and:

```ts
function openInventoryMetadataSettings(tab: InventoryMetadataSettingsTab) {
  const requestId = ++settingsRequestIdRef.current
  setSettingsDestination({ requestId, category: 'inventory-metadata', inventoryMetadataTab: tab })
  setSettingsOpen(true)
}
```

Clear the destination when Settings closes. Pass the destination through
`createSettingsDialogProps` without embedding inspector knowledge in Settings.

- [ ] **Step 4: Run focused tests**

Run the Task 1 command. Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings-dialog.tsx src/components/settings/inventory-metadata/inventory-metadata-settings.tsx src/app/create-settings-dialog-props.ts src/app/app.tsx src/test/settings-dialog.test.tsx src/test/inventory-metadata-settings.test.tsx
git commit -m "feat: target inventory metadata settings"
```

---

### Task 2: Inspector Empty-State Actions

**Files:**
- Modify: `src/components/inspector/inspector-contract.ts`
- Modify: `src/components/inspector/inspector-inventory-metadata-context.ts`
- Modify: `src/components/inspector/inspector-panel.tsx`
- Modify: `src/app/create-workspace-surface-props.ts`
- Modify: `src/app/app.tsx`
- Modify: `src/components/inventory-metadata/inventory-item-metadata-editor.tsx`
- Modify: `src/components/inventory-metadata/inventory-metadata-form.tsx`
- Create: `src/components/inventory-metadata/inventory-metadata-form.test.tsx`
- Modify: `src/test/inspector-metadata-tab.test.tsx`

**Interfaces:**
- Consumes: `openInventoryMetadataSettings(tab)` from Task 1.
- Produces: `InspectorPanelProps.onOpenInventoryMetadataSettings?: (tab: InventoryMetadataSettingsTab) => void`.
- Produces: optional `onOpenSettings` callback in `InspectorInventoryMetadataContext`.
- Produces: optional `onCreateTag` and `onCreateField` presentation callbacks in `InventoryMetadataForm`.

- [ ] **Step 1: Write failing form and inspector tests**

Cover:

```text
empty tags + callback        -> New tag is visible and callable
empty applicable fields     -> New custom field is visible and callable
callbacks omitted           -> informative empty states, no action buttons
populated metadata          -> existing controls remain visible, no empty action
Custom fields heading       -> removed Registry sentence is absent
inspector permission denied -> settings callback is not exposed
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
bun run test -- src/components/inventory-metadata/inventory-metadata-form.test.tsx src/test/inspector-metadata-tab.test.tsx
```

Expected: failure because creation callbacks and Settings navigation do not
exist.

- [ ] **Step 3: Implement permission-aware inspector wiring**

Add `onOpenInventoryMetadataSettings` to the inspector contract and pass it
through `createWorkspaceSurfaceProps`. In `InspectorPanel`, gate the context
callback with:

```ts
const canManageMetadata = usePermission('inventory.metadata.manage')
```

The context callback must be undefined without permission. Keep
`InventoryItemMetadataEditor` unaware of application state; it forwards the
optional callback as form actions.

- [ ] **Step 4: Implement shadcn empty actions**

Use the existing `Button` and Lucide `Plus` icon inside each dashed empty-state
region. Preserve the existing messages and add:

```text
New tag
New custom field
```

Remove the requested explanatory sentence. Use a wrapping vertical layout that
fits the narrow inspector without horizontal scrolling.

- [ ] **Step 5: Run focused tests**

Run the Task 2 command. Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/inspector/inspector-contract.ts src/components/inspector/inspector-inventory-metadata-context.ts src/components/inspector/inspector-panel.tsx src/app/create-workspace-surface-props.ts src/app/app.tsx src/components/inventory-metadata/inventory-item-metadata-editor.tsx src/components/inventory-metadata/inventory-metadata-form.tsx src/components/inventory-metadata/inventory-metadata-form.test.tsx src/test/inspector-metadata-tab.test.tsx
git commit -m "feat: add inspector metadata creation shortcuts"
```

---

### Task 3: Release Notes And Verification

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `src/release-notes.ts`

**Interfaces:**
- Consumes: completed Settings destination and inspector empty actions.
- Produces: verified unreleased user-facing change.

- [ ] **Step 1: Add unreleased release notes**

Document that empty Tags and Custom fields sections now link directly to their
matching Settings tabs. Do not bump the version.

- [ ] **Step 2: Run complete verification**

Run:

```bash
bun run lint
bun run test
bun run build
bun run db:migrations:check
```

Expected: all checks pass; only established lint warnings may remain.

- [ ] **Step 3: Commit release notes**

```bash
git add CHANGELOG.md src/release-notes.ts
git commit -m "docs: note metadata creation shortcuts"
```

- [ ] **Step 4: Rebuild the local ARM64 candidate**

Build the current commit into a local-only candidate image and recreate the
existing staging container on port `7899` using its copied dataset. Do not push
or publish an image.

- [ ] **Step 5: Run browser verification**

Using the in-app browser:

1. select an item with no applicable custom fields;
2. open Inspector -> Metadata;
3. verify the removed sentence is absent;
4. select `New custom field` and confirm Settings opens on Inventory metadata ->
   Custom fields;
5. close Settings and confirm the same inspector remains selected;
6. verify `New tag` opens Inventory metadata -> Tags when no active tags exist;
7. repeat at a narrow viewport and confirm no horizontal overflow; and
8. confirm no console or application errors.

- [ ] **Step 6: Restore copied candidate data and audit Git state**

Restore the candidate copy after any temporary metadata setup, verify the
candidate remains healthy, and confirm only `.superpowers/` remains untracked.
