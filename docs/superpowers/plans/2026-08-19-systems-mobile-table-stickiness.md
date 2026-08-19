# Systems Mobile Table Stickiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Systems Type and Name columns pinned on desktop while allowing the complete table to scroll normally on mobile.

**Architecture:** Replace unconditional inline sticky positioning with Tailwind's `md:` responsive sticky classes. Retain inline horizontal offsets as deterministic desktop geometry, and verify the behavior through the existing Systems workspace component test.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, TanStack Table, Vitest, Testing Library

## Global Constraints

- Type and Name remain sticky at viewport widths of 768 pixels and above.
- Below 768 pixels, Type and Name participate in normal table flow.
- Do not add viewport listeners, media-query hooks, React state, or a mobile-only table implementation.
- Preserve column widths, ordering, visibility, resizing, virtualization, row selection, keyboard behavior, and inspector behavior.
- Keep the existing untracked `.superpowers/` directory untouched.

---

### Task 1: Responsive Identity-Column Pinning

**Files:**
- Modify: `src/components/workbook/systems/systems-table.tsx:161-281`
- Test: `src/components/workbook/systems-workspace.test.tsx`

**Interfaces:**
- Consumes: `SystemsColumnKey`, the resolved `widths` map, and existing header/body cell class composition.
- Produces: `stickyOffsetStyle(key, widths)` for desktop offsets and responsive `md:sticky md:z-[2]` classes for Type and Name header/body cells.

- [ ] **Step 1: Write the failing responsive-pinning test**

Add a Systems workspace test that renders the current table and asserts:

```tsx
it('pins identity columns only at the desktop breakpoint', () => {
  renderWorkspace()
  const nameCell = screen.getByText('HP EliteDesk 800 G6').closest('[role="cell"]')
  const row = nameCell?.closest('[role="row"]')
  const typeCell = row?.querySelectorAll('[role="cell"]')[0]
  const typeHeader = screen.getByRole('columnheader', { name: /Sort by Type/ })
  const nameHeader = screen.getByRole('columnheader', { name: /Name/ })
  const manufacturerCell = screen.getByText('HP', { exact: true }).closest('[role="cell"]')

  expect(typeCell).toHaveClass('md:sticky', 'md:z-[2]')
  expect(typeHeader).toHaveClass('md:sticky', 'md:z-[2]')
  expect(nameCell).toHaveClass('md:sticky', 'md:z-[2]')
  expect(nameHeader).toHaveClass('md:sticky', 'md:z-[2]')
  expect(typeCell).not.toHaveStyle({ position: 'sticky' })
  expect(nameCell).not.toHaveStyle({ position: 'sticky' })
  expect(manufacturerCell).not.toHaveClass('md:sticky')
})
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
bun run test src/components/workbook/systems-workspace.test.tsx
```

Expected: FAIL because Type and Name still receive unconditional inline `position: sticky` and do not have `md:sticky` classes.

- [ ] **Step 3: Implement CSS-driven responsive pinning**

In `systems-table.tsx`, replace `stickyStyle` with offset-only and pin-detection helpers:

```tsx
function isPinnedIdentityColumn(key: SystemsColumnKey) {
  return key === 'type' || key === 'name'
}

function stickyOffsetStyle(key: SystemsColumnKey, widths: Record<SystemsColumnKey, number>): CSSProperties | undefined {
  if (key === 'type') return { left: 0 }
  if (key === 'name') return { left: widths.type }
  return undefined
}
```

For both body cells and header cells, compose `md:sticky md:z-[2]` only when `isPinnedIdentityColumn(key)` is true, and use `stickyOffsetStyle(key, widths)` for the inline style. Do not add a base `sticky` class or inline `position` value.

- [ ] **Step 4: Run the targeted test and verify it passes**

Run:

```bash
bun run test src/components/workbook/systems-workspace.test.tsx
```

Expected: PASS with the new responsive-pinning assertion and all existing Systems workspace behavior intact.

- [ ] **Step 5: Commit the responsive implementation**

```bash
git add src/components/workbook/systems/systems-table.tsx src/components/workbook/systems-workspace.test.tsx
git commit -m "fix: release systems columns on mobile"
```

### Task 2: Release Notes And Verification

**Files:**
- Modify: `src/release-notes.ts:480-484`
- Modify: `CHANGELOG.md:7`

**Interfaces:**
- Consumes: the existing `UNRELEASED_RELEASE_NOTES` structured draft and `CHANGELOG.md` Unreleased section.
- Produces: one user-visible fix entry describing mobile Systems-table horizontal access.

- [ ] **Step 1: Update unreleased release notes**

Add this structured fix:

```ts
fixes: [
  'Systems Type and Name columns now scroll with the table on mobile while remaining pinned on desktop, keeping operational columns accessible on narrow screens.',
],
```

Add the equivalent bullet under `CHANGELOG.md` > `Unreleased` > `Fixed`.

- [ ] **Step 2: Run formatting and targeted verification**

Run:

```bash
bun run lint
bun run test src/components/workbook/systems-workspace.test.tsx
```

Expected: lint completes with no new warnings or errors, and the targeted suite passes.

- [ ] **Step 3: Run the complete automated verification**

Run:

```bash
bun run test
bun run build
```

Expected: all tests and the production build pass.

- [ ] **Step 4: Verify mobile and desktop behavior in the browser**

Run the application locally and inspect the Systems table at `390x844` and `1440x900`:

- At `390x844`, horizontally scrolling moves Type and Name offscreen with the remaining columns and does not create overlap.
- At `1440x900`, Type remains pinned at zero and Name remains pinned after the Type column.
- Header and body stay horizontally aligned.
- Row selection backgrounds remain opaque and coherent.

- [ ] **Step 5: Commit release notes**

```bash
git add src/release-notes.ts CHANGELOG.md
git commit -m "docs: note responsive systems table"
```
