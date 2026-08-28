# Warm Canvas Paint Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent parked warm Canvas workspaces from painting over the active Canvas while preserving mounted state, dimensions, viewport state, and instant tab switching.

**Architecture:** Strengthen the existing `CanvasSurfaceLayer` boundary with non-overridable ancestor opacity and explicit stacking order. Keep the existing visibility, pointer-event, inert, accessibility, and parked-runtime controls as defense in depth; do not change persistence or Canvas runtime ownership.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Vitest, Testing Library, Vite.

## Global Constraints

- Keep retained Canvas surfaces mounted and measurable.
- Exactly one Canvas surface may paint or receive input.
- Do not change inventory data, assignments, placements, cables, route caches, or persistence.
- Production verification on `inv.hkloud.org` must remain read-only.
- Update the structured unreleased release notes and `CHANGELOG.md` for this user-visible fix.

---

### Task 1: Lock the paint-isolation regression

**Files:**
- Modify: `src/app/canvas-surface-pool.test.tsx`

**Interfaces:**
- Consumes: `CanvasSurfacePool` and existing `data-canvas-runtime-surface` test boundary.
- Produces: Regression assertions for active and parked layer paint, stacking, input, inert, and accessibility states.

- [ ] **Step 1: Extend the retained-surface test with a descendant that declares visible**

Render this descendant from the test Canvas:

```tsx
<div data-testid={`explicitly-visible-${runtimeKey}`} style={{ visibility: 'visible' }} />
```

- [ ] **Step 2: Add failing layer-state assertions**

```tsx
expect(active).toHaveClass('visible', 'opacity-100', 'pointer-events-auto', 'z-10')
expect(inactive).toHaveClass('invisible', 'opacity-0', 'pointer-events-none', 'z-0')
expect(inactive).toHaveAttribute('aria-hidden', 'true')
expect(inactive).toHaveAttribute('inert')
```

- [ ] **Step 3: Run the focused test and confirm failure**

Run: `bun run test -- src/app/canvas-surface-pool.test.tsx`

Expected: the new opacity and stacking assertions fail against the current visibility-only implementation.

---

### Task 2: Isolate parked Canvas painting

**Files:**
- Modify: `src/app/canvas-surface-layer.tsx`
- Modify: `src/app/canvas-surface-pool.test.tsx`

**Interfaces:**
- Consumes: `active: boolean` on `CanvasSurfaceLayerProps`.
- Produces: An active layer with `opacity-100 z-10` and a parked layer with `opacity-0 z-0`.

- [ ] **Step 1: Add non-overridable paint and stacking classes**

```tsx
className={cn(
  'absolute inset-0 flex min-h-0 min-w-0',
  active
    ? 'visible z-10 opacity-100 pointer-events-auto'
    : 'invisible z-0 opacity-0 pointer-events-none',
)}
```

- [ ] **Step 2: Run the focused surface tests**

Run: `bun run test -- src/app/canvas-surface-pool.test.tsx src/test/canvas-viewport-surface.test.tsx src/test/domain-engine-gate.test.tsx`

Expected: all focused warm-surface, parked-runtime, and engine-retention tests pass.

- [ ] **Step 3: Confirm repeated transitions retain one active layer**

Extend or retain the existing A/B/C rerender sequence and assert every parked layer has `opacity-0`, `z-0`, `inert`, and disabled interaction while the active layer has `opacity-100`, `z-10`, and enabled interaction.

---

### Task 3: Document and verify the fix

**Files:**
- Modify: `src/release-notes.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the existing unreleased release-note draft and changelog format.
- Produces: Human-readable unreleased fix notes without a version bump.

- [ ] **Step 1: Add the user-visible fix notes**

Record that parked warm canvases can no longer paint over the selected Canvas when switching workspaces.

- [ ] **Step 2: Run repository verification**

Run:

```bash
bun run lint
bun run test
bun run build
```

Expected: lint completes with only existing warnings, and all tests and the production build pass.

- [ ] **Step 3: Verify production reproduction remains read-only**

On `inv.hkloud.org`, switch repeatedly between the existing Canvas and Current tabs. Confirm the current release reproduces the cause by showing visible descendants inside an `aria-hidden` parked layer, without changing inventory data.

- [ ] **Step 4: Verify the fixed candidate before deployment**

Run the fixed application locally against sanitized production data and repeat the same Canvas transitions. Assert exactly one layer has `opacity: 1`, the others have `opacity: 0`, no loading screen appears for warm returns, and no console errors occur.

- [ ] **Step 5: Commit the implementation**

```bash
git add src/app/canvas-surface-layer.tsx src/app/canvas-surface-pool.test.tsx src/release-notes.ts CHANGELOG.md
git commit -m "fix: isolate parked canvas rendering"
```
