# Systems Utilization Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Left-align Systems-table utilization percentages with their hardware labels while keeping every utilization bar at one stable horizontal position.

**Architecture:** Keep formatting and layout owned by `SystemsUtilizationBar`. Replace its rem-sized, right-aligned flex label with a fixed four-character CSS-grid track and verify the rendered contract directly with a focused component test.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Vitest, Testing Library

## Global Constraints

- Display rounded whole-number percentages.
- Zero-pad values below ten as `00%` through `09%`.
- Reserve exactly `4ch` for every percentage, including `100%`.
- Left-align the percentage with the hardware label above it.
- Preserve existing colors, thresholds, segment markers, accessibility text, and bar minimum width.
- Do not bump the application version during ordinary implementation work.

---

### Task 1: Stabilize utilization percentage and bar alignment

**Files:**
- Create: `src/test/systems-utilization-bar.test.tsx`
- Modify: `src/components/workbook/systems/systems-utilization-bar.tsx`
- Modify: `CHANGELOG.md`
- Modify: `src/release-notes.ts`

**Interfaces:**
- Consumes: `SystemsUtilizationBar({ value, kind })`, where `value` is a number and `kind` is `cpu`, `memory`, or `storage`.
- Produces: The same component API with a fixed `4ch` percentage track and a flexible utilization-bar track.

- [ ] **Step 1: Write the failing component test**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SystemsUtilizationBar } from '@/components/workbook/systems/systems-utilization-bar'

describe('SystemsUtilizationBar', () => {
  it.each([
    [2, '02%'],
    [20, '20%'],
    [100, '100%'],
  ])('reserves a stable four-character label track for %s percent', (value, label) => {
    render(<SystemsUtilizationBar value={value} kind="cpu" />)
    const percentage = screen.getByText(label)
    expect(percentage).toHaveClass('w-[4ch]', 'text-left')
    expect(percentage.parentElement).toHaveClass('grid-cols-[4ch_minmax(4rem,1fr)]')
  })
})
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `bun run test -- src/test/systems-utilization-bar.test.tsx`

Expected: FAIL because the current component uses `w-[2.5rem]`, `text-right`, and a flex container.

- [ ] **Step 3: Implement the fixed grid layout**

Replace the component's outer and label classes with:

```tsx
<div className="grid min-w-0 grid-cols-[4ch_minmax(4rem,1fr)] items-center gap-1.5" ...>
  <span className="w-[4ch] shrink-0 text-left text-[10px] font-semibold leading-none tabular-nums text-[#665f57]">
    {label}
  </span>
```

Keep the bar element, tone selection, width calculation, segment markers, and accessible label unchanged.

- [ ] **Step 4: Run the focused test and frontend checks**

Run:

```bash
bun run test -- src/test/systems-utilization-bar.test.tsx
bun run lint
bun run build
```

Expected: focused test passes; lint has no new warnings; production build succeeds.

- [ ] **Step 5: Verify the Systems table visually**

Open the local Systems workspace and confirm:

- `02%`, `20%`, and `100%` begin at the hardware-label left edge.
- The bar begins at the same horizontal position for all three values.
- CPU, RAM, and storage columns do not introduce horizontal cell scrollbars.
- Storage colors still change at 80% and 90%.

- [ ] **Step 6: Record the user-visible fix**

Add a concise item to `CHANGELOG.md` under `Unreleased` and to the structured unreleased release-note draft in `src/release-notes.ts`, describing stable left-aligned Systems utilization labels.

- [ ] **Step 7: Commit the implementation**

```bash
git add src/components/workbook/systems/systems-utilization-bar.tsx src/test/systems-utilization-bar.test.tsx CHANGELOG.md src/release-notes.ts
git commit -m "fix: align systems utilization metrics"
```
