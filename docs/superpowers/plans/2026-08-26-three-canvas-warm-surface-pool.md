# Three-Canvas Warm Surface Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retain the three most recently used rendered Canvas surfaces so warmed Canvas and Systems round trips become immediate, then quantify the bounded browser-memory cost against the released engine-only cache.

**Architecture:** Keep the global application shell and drag provider mounted, and add a Canvas-only surface pool keyed by the existing immutable `CanvasRuntimeKey`. The pool snapshots inactive `WorkbenchCanvas` props, retains each React Flow/controller instance in a hidden inert full-size layer, and synchronizes surface eviction with the existing runtime manager. Initial startup and cold/evicted canvases retain scoped loading states, while warm navigation never returns the global loader.

**Tech Stack:** React 19, TypeScript, TanStack Query, React Flow, dnd-kit, Vitest/Testing Library, Bun, Docker, isolated Chromium/Playwright.

## Global Constraints

- Retain at most three Canvas surfaces and three matching engine runtimes after work settles.
- Never use `display: none` for retained React Flow surfaces.
- Inactive surfaces must be visually hidden, inert, `aria-hidden`, unfocusable, and unable to register the active Canvas drop target.
- Systems hides retained canvases without disposing them and performs no Canvas routing, geometry, or mutation work.
- A warm switch must not fetch a workspace or engine snapshot, create a worker, reroute cables, or display any global, engine, or lazy loading fallback.
- The active and busy runtimes are never evicted; surface and runtime disposal occur together exactly once.
- No server schema or persisted-data migration is introduced.
- Use one identical sanitized production snapshot for baseline and candidate measurements.
- Do not bump the version or deploy during this implementation.
- Remove task-created containers, images, browser profiles, traces, screenshots, build output, and caches after verification; preserve Docker volumes.

---

### Task 1: Establish The Released Baseline

**Files:**
- Create temporarily: `/private/tmp/hli-warm-surface-benchmark/data/`
- Create temporarily: `/private/tmp/hli-warm-surface-benchmark/benchmark.mjs`
- Record temporarily: `/private/tmp/hli-warm-surface-benchmark/baseline.json`

**Interfaces:**
- Consumes: published `mriverodorta/homelab-inventory:latest` release `0.16.2` and the current sanitized snapshot in `~/Library/Application Support/Homelab Inventory Release/data/current`.
- Produces: a fixed benchmark dataset and baseline JSON with switch durations, loading-label observations, DOM count, JS heap metrics, Chromium RSS, container RSS, worker count, and EventSource count.

- [ ] **Step 1: Copy the current sanitized snapshot into a fixed benchmark directory**

```bash
mkdir -p /private/tmp/hli-warm-surface-benchmark/data
rsync -a --delete "$HOME/Library/Application Support/Homelab Inventory Release/data/current/" /private/tmp/hli-warm-surface-benchmark/data/
```

- [ ] **Step 2: Start released 0.16.2 on port 8799**

```bash
docker run --detach --name hli-warm-surface-baseline --platform linux/arm64 \
  --publish 127.0.0.1:8799:8798 \
  --mount type=bind,source=/private/tmp/hli-warm-surface-benchmark/data,target=/data \
  --env APP_MODE=staging --env NODE_ENV=production --env PORT=8798 \
  --env DATA_DIR=/data --env SEED_EMPTY_DATA=false \
  --env UPDATE_CHECK_ENABLED=false --env REGISTRY_REFRESH_INTERVAL_MS=0 \
  mriverodorta/homelab-inventory:latest
```

- [ ] **Step 3: Create and run a task-scoped Playwright benchmark**

Open `http://127.0.0.1:8799`, warm the first three Canvas tabs, then perform 20 cyclic switches. Observe these labels continuously:

```js
const loadingLabels = [
  'Loading workspace',
  'Loading workspace engine',
  'Preparing workspace interactions',
  'Loading workspace canvas',
]
```

Use Chromium CDP `Performance.getMetrics`, the spawned Chromium process tree, `document.getElementsByTagName('*').length`, and `docker stats --no-stream`. Run twice and retain the second settled sample in `baseline.json`.

```bash
bun /private/tmp/hli-warm-surface-benchmark/benchmark.mjs baseline
bun /private/tmp/hli-warm-surface-benchmark/benchmark.mjs baseline
docker rm --force hli-warm-surface-baseline
```

Expected: warmed switches still reproduce loading labels and approximately three-second latency.

---

### Task 2: Add A Stable Retained Canvas Surface Pool

**Files:**
- Create: `src/app/canvas-surface-pool.tsx`
- Create: `src/app/canvas-surface-pool.test.tsx`
- Modify: `src/components/workbench-canvas-contract.ts`
- Modify: `src/components/canvas/workbench-canvas.tsx`

**Interfaces:**
- Consumes: active `CanvasRuntimeKey`, active `WorkbenchCanvasProps`, and retained runtime keys.
- Produces:

```ts
export interface CanvasSurfacePoolProps {
  activeRuntimeKey: string | null
  activeReady: boolean
  retainedRuntimeKeys: readonly string[]
  canvas: WorkbenchCanvasProps
  renderCanvas?: React.ComponentType<WorkbenchCanvasProps>
}
```

- [ ] **Step 1: Write failing pool tests**

Warm A, B, and C, switch A -> B -> C -> A, and assert each mocked surface mounts once. Assert inactive wrappers have `aria-hidden="true"`, `inert`, `visibility: hidden`, and no pointer events; the active wrapper receives `interactionEnabled: true`. Removing A from retained keys must unmount A exactly once.

- [ ] **Step 2: Verify the tests fail**

```bash
bunx vitest run src/app/canvas-surface-pool.test.tsx
```

- [ ] **Step 3: Implement the full-size retained pool**

Cache props and controllers by immutable runtime key. Render the active key with live props when ready and retained inactive keys with their last complete props. A cold active key with no snapshot renders a workspace-local loader. Use relative stacking plus absolute full-size layers, never `display: none`.

Before hiding a layer, blur any focused descendant. Wrap `onViewportReady` so controllers are stored per runtime and replayed to the active callback when the runtime becomes visible again.

- [ ] **Step 4: Disable inactive Canvas interaction**

Extend `WorkbenchCanvasProps` with:

```ts
interactionEnabled?: boolean
runtimeKey?: string
```

Inactive canvases disable node dragging and use a disabled runtime-specific dnd-kit droppable ID instead of active ID `canvas`. Omitted `interactionEnabled` remains backward-compatible as active.

- [ ] **Step 5: Run focused tests and commit**

```bash
bunx vitest run src/app/canvas-surface-pool.test.tsx src/components/canvas/workbench-canvas.test.tsx
git add src/app/canvas-surface-pool.tsx src/app/canvas-surface-pool.test.tsx src/components/workbench-canvas-contract.ts src/components/canvas/workbench-canvas.tsx
git commit -m "feat: retain warm canvas surfaces"
```

---

### Task 3: Keep The Application Shell Mounted During Navigation

**Files:**
- Modify: `src/app/app.tsx`
- Modify: `src/app/app-workspace-surface.tsx`
- Modify: `src/app/app-workspace-surface.test.tsx`
- Modify: `src/test/app-persistence.test.tsx`
- Create: `src/test/warm-canvas-surface-navigation.test.tsx`

**Interfaces:**
- Consumes: `CanvasSurfacePool` and `getCanvasRuntimeKeys()`.
- Produces: initial-only global loading and stable Canvas/System workspace hosting.

- [ ] **Step 1: Add failing navigation tests**

After two canvases are ready, navigate Canvas -> Current -> Canvas and Canvas -> Systems -> Canvas. Assert no global/lazy loading labels, one mount per Canvas runtime, and independent selection, inspector, viewport controller, and history state.

```ts
expect(screen.queryByText('Loading workspace')).not.toBeInTheDocument()
expect(screen.queryByText('Preparing workspace interactions')).not.toBeInTheDocument()
expect(screen.queryByText('Loading workspace canvas')).not.toBeInTheDocument()
expect(canvasMounts.get(runtimeA)).toBe(1)
expect(canvasMounts.get(runtimeB)).toBe(1)
```

- [ ] **Step 2: Verify navigation tests fail**

```bash
bunx vitest run src/test/warm-canvas-surface-navigation.test.tsx src/app/app-workspace-surface.test.tsx src/test/app-persistence.test.tsx
```

- [ ] **Step 3: Separate initial startup from transition readiness**

Keep full-page `LoadingScreen` only before any workbook/project has hydrated. After shell mount, a route/project mismatch leaves the shell mounted and passes `activeReady: false`. The existing layout-effect restoration updates a warm target before paint; cold targets use the pool-local loader.

- [ ] **Step 4: Render Canvas and Systems through a stable host**

Always mount `CanvasSurfacePool`. Systems overlays the retained pool while active. Canvas inspector and overlays render only for a ready active Canvas; Systems inspector renders only for Systems.

```tsx
<CanvasSurfacePool
  activeRuntimeKey={canvasWorkspaceActive ? activeWorkspaceKey : null}
  activeReady={projectMatchesActiveWorkspace && canvasWorkspaceActive}
  retainedRuntimeKeys={getCanvasRuntimeKeys()}
  canvas={canvas}
/>
```

- [ ] **Step 5: Run runtime/navigation tests and commit**

```bash
bunx vitest run src/test/warm-canvas-surface-navigation.test.tsx src/app/app-workspace-surface.test.tsx src/test/canvas-runtime-manager.test.ts src/test/domain-engine-gate.test.tsx src/test/app-persistence.test.tsx
git add src/app/app.tsx src/app/app-workspace-surface.tsx src/app/app-workspace-surface.test.tsx src/test/app-persistence.test.tsx src/test/warm-canvas-surface-navigation.test.tsx
git commit -m "fix: switch warm canvases without remounting"
```

---

### Task 4: Stabilize Lazy Identity And Inactive Side Effects

**Files:**
- Modify: `src/components/lazy-surface.ts`
- Modify: `src/components/lazy-surface-view.tsx`
- Modify: `src/components/lazy-surface.test.tsx`
- Modify: `src/components/canvas/use-cable-routing-controller.ts`
- Modify: `src/test/use-cable-routing-controller.test.tsx`

**Interfaces:**
- Consumes: retained surfaces and `interactionEnabled`.
- Produces: one lazy identity per factory and no new inactive routing work.

- [ ] **Step 1: Add failing lazy and inactive-routing tests**

Assert the original `React.lazy` identity survives parent remounts after load; only Retry after a load failure creates a replacement. Assert an inactive Canvas does not request route canonicalization or report new routing activity.

- [ ] **Step 2: Verify failure, implement, and rerun**

Move initial `lazy(loader)` creation into `createLazySurface`, passing that stable component to `LazySurfaceView`. Construct a replacement only in Retry. Thread `interactionEnabled` through routing work so unchanged hidden surfaces cannot start a new cycle.

```bash
bunx vitest run src/components/lazy-surface.test.tsx src/test/use-cable-routing-controller.test.tsx
```

- [ ] **Step 3: Commit**

```bash
git add src/components/lazy-surface.ts src/components/lazy-surface-view.tsx src/components/lazy-surface.test.tsx src/components/canvas/use-cable-routing-controller.ts src/test/use-cable-routing-controller.test.tsx
git commit -m "fix: keep retained canvas work inactive"
```

---

### Task 5: Verify The Candidate And Compare Memory

**Files:**
- Modify: `src/release-notes.ts`
- Modify: `CHANGELOG.md`
- Record temporarily: `/private/tmp/hli-warm-surface-benchmark/candidate.json`
- Record temporarily: `/private/tmp/hli-warm-surface-benchmark/comparison.json`

**Interfaces:**
- Consumes: baseline evidence, fixed dataset, and completed candidate.
- Produces: automated verification, local ARM64 staging proof, quantified latency/memory evidence, and clean local storage.

- [ ] **Step 1: Record the unreleased correction and run repository checks**

```bash
bun run release-notes:check
bun run lint
bun run test
bun run build
```

- [ ] **Step 2: Build and run the final ARM64 candidate locally**

Build the final Dockerfile for `linux/arm64` as `homelab-inventory-warm-surface:test`. Run it on port 8799 against the exact Task 1 dataset and identical staging environment. Do not publish.

- [ ] **Step 3: Run the identical candidate benchmark twice**

```bash
bun /private/tmp/hli-warm-surface-benchmark/benchmark.mjs candidate
bun /private/tmp/hli-warm-surface-benchmark/benchmark.mjs candidate
```

Expected after three canvases are warm: 20 switches show zero loading labels, p95 is below 250 ms, mounted identities remain stable, no workspace/engine fetch or routing occurs, and no more than three surfaces/workers/SSE streams remain.

- [ ] **Step 4: Produce the comparison**

Write `comparison.json` with baseline/candidate and deltas for p50/p95 latency, Chromium RSS, JS heap, DOM nodes, container RSS, workers, and EventSources. Report unsupported metrics as unavailable.

- [ ] **Step 5: Run the container security gate**

```bash
bun run security:container
```

Expected: amd64 and arm64 images boot; Scout and Trivy report zero findings at every severity.

- [ ] **Step 6: Clean every task artifact and commit docs**

Remove test containers/images, browser profiles, `/private/tmp/hli-warm-surface-benchmark`, generated `dist`, Rust `target`, candidate archives, scanner data, and task build cache. Preserve every Docker volume and the current sanitized rsync base.

```bash
git diff --check
git status --short
docker system df
du -sh "$HOME/Library/Application Support/Homelab Inventory Release" .
git add src/release-notes.ts CHANGELOG.md
git commit -m "docs: record immediate warm canvas switching"
```
