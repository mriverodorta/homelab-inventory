# Unified Canvas Zoom Range Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the editable Homelab Inventory Canvas and shared LabGD Canvas viewer use the same 10%–200% zoom range.

**Architecture:** Keep zoom limits explicit at the two React Flow rendering boundaries. Capture the props passed to React Flow in isolated component tests so either surface fails if its zoom contract drifts.

**Tech Stack:** React 19, TypeScript, React Flow, Vitest, Testing Library.

## Global Constraints

- Minimum Canvas zoom is exactly `0.1` (10%).
- Maximum Canvas zoom is exactly `2` (200%).
- Fit-to-view, saved viewport, placement, routing, selection, and persistence behavior remain unchanged.
- Do not introduce a shared cross-package configuration abstraction for two fixed call sites.
- Record the user-visible behavior in the structured unreleased release notes and `CHANGELOG.md` without bumping the application version.

---

### Task 1: Lock Both React Flow Zoom Contracts

**Files:**
- Modify: `src/test/canvas-viewport-surface.test.tsx`
- Create: `packages/viewer-react/test/canvas-viewer-zoom.test.tsx`

**Interfaces:**
- Consumes: `CanvasViewportSurface` and `SharedCanvasViewer` React Flow props.
- Produces: regression assertions that both components pass `minZoom: 0.1` and `maxZoom: 2`.

- [ ] **Step 1: Add the editable Canvas assertion**

Extend the active-surface test with:

```tsx
expect(flowProps.current).toMatchObject({
  minZoom: 0.1,
  maxZoom: 2,
})
```

- [ ] **Step 2: Add an isolated shared-viewer zoom test**

Create a test that mocks only the React Flow boundary, captures its props, renders an empty `SharedCanvasViewer`, and asserts:

```tsx
expect(flowProps.current).toMatchObject({
  minZoom: 0.1,
  maxZoom: 2,
})
```

Use an empty `SharedCanvasModel` with `publicViewId`, empty `items`, `nodes`, and `connections`, and a viewport at zoom `1`. Retain the actual `@xyflow/react` exports other than the mocked `ReactFlow` and `Background` components.

- [ ] **Step 3: Run the focused tests and confirm the editable Canvas assertion fails**

Run:

```bash
NODE_OPTIONS=--no-experimental-webstorage bunx vitest run src/test/canvas-viewport-surface.test.tsx packages/viewer-react/test/canvas-viewer-zoom.test.tsx
```

Expected: the editable Canvas test reports `minZoom` as `0.25` or `maxZoom` as `1.8`; the shared-viewer assertion passes.

### Task 2: Standardize the Limits and Document the Change

**Files:**
- Modify: `src/components/canvas/canvas-viewport-surface.tsx:128-129`
- Modify: `src/release-notes.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the zoom contract asserted in Task 1.
- Produces: editable and shared Canvas surfaces constrained to 10%–200%.

- [ ] **Step 1: Update the editable Canvas React Flow props**

Replace the current limits with:

```tsx
minZoom={0.1}
maxZoom={2}
```

Do not alter any viewport, fit-view, pan, touch, wheel, selection, or warm-surface props.

- [ ] **Step 2: Update unreleased documentation**

Add this structured highlight:

```text
Editable and shared Canvas views now use the same 10%–200% zoom range, making large layouts easier to review without changing saved viewport or fit-to-view behavior.
```

Add the same user-facing change under `CHANGELOG.md` → `Unreleased` → `Changed`.

- [ ] **Step 3: Run focused verification**

Run:

```bash
NODE_OPTIONS=--no-experimental-webstorage bunx vitest run src/test/canvas-viewport-surface.test.tsx packages/viewer-react/test/canvas-viewer-zoom.test.tsx
```

Expected: all focused tests pass.

- [ ] **Step 4: Run repository verification**

Run:

```bash
bun run lint
bun run test
bun run build
```

Expected: lint completes with no new warnings, all tests pass, and the production build succeeds.

- [ ] **Step 5: Commit the implementation**

```bash
git add src/components/canvas/canvas-viewport-surface.tsx \
  src/test/canvas-viewport-surface.test.tsx \
  packages/viewer-react/test/canvas-viewer-zoom.test.tsx \
  src/release-notes.ts CHANGELOG.md
git commit -m "feat: standardize canvas zoom range"
```
