# Systems Utilization Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Animate Systems CPU, memory, and storage bar changes and whole-number labels when authoritative values arrive through SSE.

**Architecture:** Keep transport and query state unchanged. Add a focused presentation hook beside the Systems meter that interpolates the displayed percentage with `requestAnimationFrame`, while the shared meter uses an efficient CSS width transition toward the authoritative target.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Vitest, Testing Library

## Global Constraints

- Initial values render immediately and do not animate from zero.
- Subsequent values animate for 600 milliseconds with ease-out timing.
- The bar and whole-number percentage progress together.
- A replacement target starts from the currently displayed value and never queues stale transitions.
- Values are clamped to 0–100; non-finite values normalize safely.
- Reduced-motion mode updates immediately.
- No backend, telemetry, SSE, persistence, or query-cache contract changes.
- Update structured unreleased release notes and `CHANGELOG.md`.

---

### Task 1: Animated Utilization Presentation

**Files:**
- Create: `src/components/workbook/systems/use-animated-utilization.ts`
- Modify: `src/components/workbook/systems/systems-utilization-bar.tsx`
- Test: `src/test/systems-utilization-bar.test.tsx`

**Interfaces:**
- Consumes: authoritative percentage `value: number` from `SystemsUtilizationBar`.
- Produces: `useAnimatedUtilization(value: number): { displayed: number; target: number; reducedMotion: boolean }`.
- `target` is the finite, clamped authoritative value used by the CSS width transition.
- `displayed` is the interpolated value used by the whole-number label, accessibility label, and storage tone.

- [ ] **Step 1: Extend the component tests with controlled animation frames**

Add tests that mock `requestAnimationFrame`, `cancelAnimationFrame`, and `matchMedia`, then prove:

```tsx
const view = render(<SystemsUtilizationBar value={20} kind="cpu" />)
expect(screen.getByText('20%')).toBeInTheDocument()
expect(fill()).toHaveStyle({ width: '20%' })

view.rerender(<SystemsUtilizationBar value={80} kind="cpu" />)
expect(fill()).toHaveStyle({ width: '80%' })
advanceAnimation(300)
expect(Number.parseInt(screen.getByText(/%$/).textContent!, 10)).toBeGreaterThan(20)
advanceAnimation(600)
expect(screen.getByText('80%')).toBeInTheDocument()
```

Cover decreasing values, replacement targets, clamping, reduced motion, unchanged values, storage tone synchronization, and unmount cancellation.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
bunx vitest run src/test/systems-utilization-bar.test.tsx
```

Expected: the new transition assertions fail because the current meter immediately replaces its label and has no animation lifecycle.

- [ ] **Step 3: Implement the focused interpolation hook**

Create `use-animated-utilization.ts` with:

```ts
export const SYSTEMS_UTILIZATION_TRANSITION_MS = 600

export function normalizeUtilization(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 100) : 0
}

export function useAnimatedUtilization(value: number): {
  displayed: number
  target: number
  reducedMotion: boolean
}
```

The hook must:

- initialize `displayed` and its ref from the normalized first value;
- subscribe to `(prefers-reduced-motion: reduce)` safely when `matchMedia` exists;
- cancel the active frame before starting a replacement transition;
- interpolate from `displayedRef.current` with an ease-out function for 600 milliseconds;
- update immediately for reduced motion or an unchanged normalized target;
- cancel frames and media-query listeners during cleanup.

- [ ] **Step 4: Connect the shared meter to the hook**

Update `SystemsUtilizationBar` so:

```tsx
const { displayed, target, reducedMotion } = useAnimatedUtilization(value)
const rounded = Math.round(displayed)
```

Use `target` for fill width. Add a 600-millisecond CSS width transition and ease-out timing unless reduced motion is enabled. Use `displayed` for storage color thresholds, the visible percentage, and `aria-label`. Preserve all current sizing, markers, colors, and memory attributes.

- [ ] **Step 5: Run the focused tests**

Run:

```bash
bunx vitest run src/test/systems-utilization-bar.test.tsx
```

Expected: all Systems utilization tests pass.

- [ ] **Step 6: Commit the presentation change**

```bash
git add src/components/workbook/systems/use-animated-utilization.ts \
  src/components/workbook/systems/systems-utilization-bar.tsx \
  src/test/systems-utilization-bar.test.tsx
git commit -m "feat: animate systems utilization changes"
```

### Task 2: Release Documentation And Verification

**Files:**
- Modify: `src/release-notes.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the completed animated Systems meter behavior from Task 1.
- Produces: user-visible unreleased notes describing smooth SSE-driven CPU, memory, and storage transitions.

- [ ] **Step 1: Add unreleased release notes**

Add this fix to `UNRELEASED_RELEASE_NOTES.fixes`:

```ts
'Systems CPU, memory, and storage meters now animate SSE-driven utilization changes with synchronized whole-number percentages while respecting reduced-motion preferences.'
```

Add the equivalent bullet under `CHANGELOG.md` → `Unreleased` → `Fixed`.

- [ ] **Step 2: Run focused and adjacent tests**

Run:

```bash
bunx vitest run \
  src/test/systems-utilization-bar.test.tsx \
  src/components/workbook/systems/systems-table-model.test.ts \
  src/hooks/use-systems.test.tsx
```

Expected: all selected tests pass.

- [ ] **Step 3: Run project validation**

Run:

```bash
bun run lint
bun run test
bun run build
```

Expected: all commands pass; only established lint warnings may remain.

- [ ] **Step 4: Review the final diff**

Verify:

- no interval polling or new network request was introduced;
- the initial meter render remains immediate;
- animation state is isolated from TanStack Query and the SSE provider;
- release notes describe only the shipped behavior;
- `.superpowers/` remains untouched.

- [ ] **Step 5: Commit release documentation**

```bash
git add src/release-notes.ts CHANGELOG.md
git commit -m "docs: note systems utilization transitions"
```
