# Three-Canvas Warm Surface Pool Design

## Problem

Release 0.16.2 retains up to three route-scoped domain-engine runtimes, workers,
SSE streams, project projections, topology results, and canvas view-state
snapshots. It does not retain the React canvas surface.

When navigation changes the active workspace, the route updates before the
shared `project` state is restored. The application sees that the previous
project does not match the new route and returns the global `LoadingScreen`.
That unmounts the app shell, drag context, React Flow canvas, controller,
inspector, and lazy canvas boundaries. Recreating those boundaries produces the
visible sequence:

```text
blank -> Preparing workspace interactions -> Loading workspace canvas
```

Production verification after both Canvas and Current were warm measured about
3.03 seconds in each direction. The engine cache is functioning, but engine-only
retention cannot provide an immediate visual tab switch.

## Approved Behavior

- Keep at most three complete Canvas surfaces warm in one browser tab.
- Each retained surface is paired one-to-one with its existing immutable canvas
  runtime key.
- After a Canvas has loaded once, revisiting it reveals the existing rendered
  surface without the global loader, lazy-surface fallback, React Flow remount,
  worker initialization, workspace fetch, topology recomputation, or cable
  rerouting.
- The active surface is visible and interactive. Inactive retained surfaces are
  full-sized, visually hidden, noninteractive, inaccessible to assistive
  technology, and excluded from focus navigation without being unmounted.
- Systems remains a separate workspace surface. Opening Systems hides retained
  canvases but does not dispose them. Returning to a warm Canvas reveals it
  immediately.
- The surface pool and engine runtime manager use the same capacity-three LRU
  ownership. Eviction disposes both halves exactly once.
- A busy active or inactive runtime is never evicted. The pool may temporarily
  exceed three entries until an eligible entry exists.
- Initial visits and revisits after LRU eviction keep the existing cold-loading
  behavior.

## Architecture

### Global shell

`AppShell`, workbook tabs, project controls, global dialogs, and global
inventory presentation remain mounted once. A workspace switch must never
replace the global application with `LoadingScreen` after initial startup.

Initial workbook/project startup can still use the global loader. A cold
workspace activation after startup renders a loading layer in that workspace's
surface slot while other retained surfaces remain mounted.

### Surface pool

Introduce a Canvas-only surface pool keyed by `CanvasRuntimeKey`:

```ts
type CanvasSurfaceEntry = {
  runtimeKey: CanvasRuntimeKey
  scope: CanvasRuntimeScope
  workspace: WorkspaceSummary
  project: ProjectState | null
  phase: 'cold' | 'loading' | 'ready' | 'failed'
  lastAccessed: number
}
```

The entry boundary owns all React-local Canvas state that must survive a tab
switch:

- project projection and project ref;
- canvas controller and React Flow instance;
- selection, connection selection, and active trace;
- inspector state derived from selection;
- undo/redo and metadata history;
- drag and pending-connection state;
- viewport and canvas-local toolbar preferences;
- topology and routing controllers;
- workspace-specific persistence queue state.

Global data and dialogs remain outside the entry. Inventory catalog data may be
shared, but assignments, placements, cables, history, selection, controllers,
and persistence queues may not cross runtime keys.

### Visibility

All retained Canvas surfaces remain in one stable, full-size stacking context.
Do not use `display: none`, because React Flow must retain valid dimensions.

The active surface uses normal visibility. An inactive surface uses an
equivalent of:

```text
position: absolute; inset: 0;
visibility: hidden;
pointer-events: none;
```

It also receives `aria-hidden="true"` and `inert`. Focus is moved out of a
surface before it becomes inactive. Hidden surfaces must not intercept drag,
keyboard, wheel, pointer, or inspector actions.

### Activation

Activation is atomic:

1. Settle source persistence if needed.
2. Resolve or create the destination engine runtime and surface entry.
3. Mark its LRU access.
4. If ready, switch the active surface key in one React commit.
5. If cold, activate its local loader without unmounting other retained entries.
6. Evict the least-recently-used inactive, non-busy surface/runtime pair when
   capacity is exceeded.

The active route and selected surface key must change together. A temporary
route/project mismatch must not invoke the global loader or dispose the source
surface.

### Inactive updates

The existing scoped SSE stream may update an inactive runtime's query
projection. An inactive surface records that newer projection and reconciles
before becoming editable. It does not route cables or run geometry side effects
while hidden unless the incoming mutation specifically changes topology and the
runtime manager determines that background reconciliation is required.

### Lazy modules

Canvas and drag-workspace lazy component identities must be created once per
module, not inside a component instance that recreates `React.lazy(loader)` on
every remount. Cold first loads retain retry and error handling. A warm surface
never re-enters a lazy fallback.

## Memory Policy And Benchmark

The optimization intentionally exchanges bounded browser memory for switch
latency. The limit remains three canvases.

Use the same sanitized copy of live production data for both measurements:

1. Run the released 0.16.2 baseline container locally.
2. Wait for application startup and visit the same three Canvas tabs once.
3. Record container memory, browser process memory where available, active
   workers/EventSources, DOM node count, and JS heap metrics supported by the
   test browser.
4. Repeat at idle after a settling interval.
5. Build the patched candidate from the same snapshot and repeat the exact
   sequence and settling interval.
6. Report absolute memory, increase, and percentage increase. Do not compare a
   cold one-canvas baseline against a three-canvas warm candidate.

Container memory is expected to change little because React/WASM execution is
browser-side. Browser memory is the meaningful comparison. If browser process
memory is unavailable, report the available JS heap, DOM, worker, and surface
counts without presenting them as total browser RSS.

The pool remains fixed at three unless the measured increase reveals an
unacceptable regression. No automatic memory-pressure API is introduced in
this patch.

## Performance Acceptance

After Canvas A, B, and C have each reached ready state:

- 20 repeated switches among them render no global loading screen, engine
  loading overlay, `Preparing workspace interactions`, or `Loading workspace
  canvas` fallback.
- Warm interaction-to-visible-content latency is below 250 ms at p95 on the
  local development machine.
- No workspace-project or engine-snapshot request occurs.
- No worker is created and no unchanged topology or cable routing is recomputed.
- The React Flow surface/controller identity for each retained Canvas remains
  stable across switches.
- Each Canvas retains its own viewport, selection, inspector, undo/redo history,
  assignments, placements, and cables.
- Systems round trips retain the same guarantees.
- Opening Canvas D evicts exactly one eligible LRU pair. Returning to that
  evicted Canvas performs one normal cold activation.
- At rest there are no more than three retained Canvas surfaces, workers, or
  scoped Canvas SSE streams.

## Safety And Failure Behavior

- A failed destination remains isolated in its own surface slot and shows its
  retry UI without replacing or exposing another Canvas.
- Account changes clear all surfaces and runtimes before another account can
  render.
- Successful project/workspace deletion disposes the exact affected entries;
  failed deletion preserves them.
- Demo expiration and permission loss clear affected retained surfaces.
- No route, current project, URL-derived identifier, or array position may be
  used to resolve an inactive surface's relationships.
- No server schema or persisted-data migration is required.

## Testing

Add unit and integration coverage for:

- stable mounted identities across warm switches;
- no global or lazy loading fallback on warm activation;
- hidden/inert/noninteractive inactive surfaces;
- focus leaving a surface before deactivation;
- isolated project, history, selection, controller, viewport, persistence, and
  topology state;
- Systems hiding rather than disposing retained Canvas surfaces;
- synchronized surface/runtime LRU eviction and busy protection;
- cold and failure paths;
- account, permission, project, workspace, and provider cleanup;
- Strict Mode mount/cleanup behavior;
- no routing, geometry, drag, or mutation side effects from inactive surfaces.

Local Docker/browser verification uses the sanitized live snapshot and records
baseline and candidate latency plus memory evidence. The test container,
candidate images, build outputs, screenshots, traces, and caches are removed
after verification. Docker volumes are preserved.

## Release Notes

This is a user-visible correction to the unreleased warm Canvas optimization.
Update the structured unreleased release-note draft and `CHANGELOG.md`. Do not
bump the version or deploy until explicitly requested.

## Out Of Scope

- More than three retained Canvas surfaces.
- User-configurable capacity.
- Warm surfaces for rack, network, services, or future workspace types.
- Persisting browser runtimes across reloads.
- Background preloading canvases the user has never opened.
- Changes to compatibility, routing semantics, server persistence, or database
  schemas.
