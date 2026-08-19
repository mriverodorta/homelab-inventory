# Workspace Engine Tab Reactivation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make repeated Systems and Canvas tab transitions start a fresh, correctly gated domain-engine session without losing the selected item or inspector and without surfacing false engine-not-ready errors.

**Architecture:** The provider assigns every enabled lifetime a monotonically increasing session ID and exposes the fresh client's real state atomically. The gate and TanStack Query caches scope readiness and engine-owned data to that session, while a focused application hook recenters a preserved selection once after the returning Canvas session is ready.

**Tech Stack:** React 19, TypeScript, TanStack Query, Vitest, Testing Library, Web Workers, Rust/WASM domain engine.

## Global Constraints

- Keep the domain engine disabled and release its worker, WASM snapshot, engine event stream, and routing state while Systems is active.
- Preserve selected item, selected connection, open inspector, project data, and workspace state across tab changes.
- Do not expose engine commands or queries until the current activation session is genuinely ready.
- Center a preserved item once after readiness only when the existing automatic selection-centering preference is enabled.
- Do not change routing, persistence, topology semantics, or the engine loading interface.
- Leave the existing untracked `.superpowers/` directory untouched.
- Update the structured unreleased release notes and `CHANGELOG.md`; do not bump the version.

---

### Task 1: Session-Aware Domain Engine Provider

**Files:**
- Modify: `src/engine/react-context.ts`
- Modify: `src/hooks/use-domain-engine.ts`
- Modify: `src/components/domain-engine-provider.tsx`
- Test: `src/test/domain-engine-gate.test.tsx`

**Interfaces:**
- Produces: `DomainEngineContextValue.session: number`, where zero means no activation has started and each disabled-to-enabled transition increments the value.
- Produces: optional `clientFactory?: () => DomainEngineClient` provider seam for repeated-lifecycle tests; production defaults to `new DomainEngineClient()`.
- Preserves: `setEnabled(enabled: boolean): void`, `retry(): Promise<void>`, and the existing provided-client test seam.

- [ ] **Step 1: Write failing provider lifecycle tests**

Extend the stub client so tests can control state transitions, then assert the observed context sequence for a disabled-to-enabled transition begins with the new session's actual idle/loading state rather than `ready`. Add a repeated Canvas-to-Systems-to-Canvas test using two factory clients:

```tsx
expect(observed.at(-1)).toMatchObject({ enabled: false, session: 1, phase: 'idle' })
fireEvent.click(screen.getByRole('button', { name: 'Open Canvas' }))
expect(observed.at(-1)).toMatchObject({ enabled: true, session: 2, phase: 'loading' })
await waitFor(() => expect(secondClient.start).toHaveBeenCalledOnce())
expect(firstClient.dispose).toHaveBeenCalledOnce()
expect(secondClient.dispose).not.toHaveBeenCalled()
```

Also use fake timers to prove an old session's delayed disposal callback cannot dispose the current client after a rapid disable and re-enable.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
bunx vitest run src/test/domain-engine-gate.test.tsx
```

Expected: failures because the context has no `session`, disabled state is synthetic `ready`, and the provider cannot inject distinct clients per activation.

- [ ] **Step 3: Implement atomic activation sessions**

Add the session field to the context and disabled fallback. In the provider, centralize client creation and update the activation transition in one callback:

```tsx
const nextClient = providedClient ?? clientFactory()
setClient(nextClient)
setState(nextClient.status())
setSyncEvent(null)
setSession((current) => current + 1)
setActive(true)
```

On disable, set `{ phase: 'idle', revision: null }`, clear synchronization state, and set `active` false before effect cleanup schedules disposal for that exact client. Keep event-source creation conditional on the current session being active and ready.

- [ ] **Step 4: Run the provider tests and typecheck affected context values**

Run:

```bash
bunx vitest run src/test/domain-engine-gate.test.tsx src/test/topology-query.test.tsx
bunx tsc -b --pretty false
```

Expected: provider tests pass; TypeScript reports any test context values that still need an explicit `session`.

- [ ] **Step 5: Commit the provider lifecycle**

```bash
git add src/engine/react-context.ts src/hooks/use-domain-engine.ts src/components/domain-engine-provider.tsx src/test/domain-engine-gate.test.tsx src/test/topology-query.test.tsx
git commit -m "fix: isolate workspace engine activation sessions"
```

### Task 2: Per-Session Readiness And Query Caches

**Files:**
- Modify: `src/components/domain-engine-gate.tsx`
- Modify: `src/hooks/use-topology-query.ts`
- Test: `src/test/domain-engine-gate.test.tsx`
- Test: `src/test/topology-query.test.tsx`

**Interfaces:**
- Consumes: `DomainEngineContextValue.session` from Task 1.
- Produces: readiness memory keyed to the current session.
- Produces: topology and compatible-endpoint query keys containing the engine session.

- [ ] **Step 1: Write failing gate and cache-isolation tests**

Add a gate test that starts disabled with a mounted stateful child, enables a loading session, and verifies the child remains mounted behind the loading status. Then rerender a context from ready session 1 to loading session 2 and verify session 1 cannot bypass the loading overlay.

Add a topology test that changes only `session` and client, then proves all four topology reads execute against the second client instead of returning the infinite-stale result from session 1:

```tsx
session = 2
client = secondClient
rerender()
await waitFor(() => expect(secondQueryConsistent).toHaveBeenCalledTimes(4))
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
bunx vitest run src/test/domain-engine-gate.test.tsx src/test/topology-query.test.tsx
```

Expected: the gate remembers readiness globally and topology data remains cached across sessions.

- [ ] **Step 3: Implement session-scoped gating**

Replace the global ready boolean with a ready-session ref and a mounted-application ref:

```tsx
if (!enabled) {
  applicationMountedRef.current = true
  return children
}
if (state.phase === 'ready') readySessionRef.current = session
const currentSessionWasReady = readySessionRef.current === session
```

Keep mounted children under the existing loading overlay during a new session's startup. Allow nonblocking rebuilds only when `currentSessionWasReady` is true. Keep failed and unsupported recovery behavior unchanged.

- [ ] **Step 4: Isolate engine query data by session**

Insert `domainEngine.session` into both query keys. Include `session` in the internal topology and compatible-endpoint query payloads so `placeholderData` may retain data only when it belongs to the same session:

```tsx
placeholderData: (previousData) => (
  previousData?.session === domainEngine.session ? previousData : undefined
)
```

Do not alter topology fingerprints or ordinary same-session invalidation behavior.

- [ ] **Step 5: Run the focused tests and commit**

Run:

```bash
bunx vitest run src/test/domain-engine-gate.test.tsx src/test/topology-query.test.tsx
```

Expected: all focused tests pass.

```bash
git add src/components/domain-engine-gate.tsx src/hooks/use-topology-query.ts src/test/domain-engine-gate.test.tsx src/test/topology-query.test.tsx
git commit -m "fix: gate canvas data by engine session"
```

### Task 3: Restore Preserved Selection After Canvas Readiness

**Files:**
- Create: `src/app/use-canvas-engine-reactivation.ts`
- Modify: `src/app/app.tsx`
- Test: `src/test/canvas-engine-reactivation.test.tsx`

**Interfaces:**
- Consumes: `{ canvasWorkspaceActive, engineEnabled, enginePhase, engineSession, selectedItemId, autoCenterOnSelect, focusCanvasItem }`.
- Produces: one post-readiness focus request per activation session; no persisted state.

- [ ] **Step 1: Write failing hook tests**

Use `renderHook` with a mocked focus callback. Cover a loading-to-ready transition, repeated rerenders in one session, a second session, disabled centering, and connection-only selection:

```tsx
rerender({ phase: 'ready', session: 1, selectedItemId: 'server:7', autoCenter: true })
expect(focusCanvasItem).toHaveBeenCalledOnce()
rerender({ phase: 'ready', session: 1, selectedItemId: 'server:7', autoCenter: true })
expect(focusCanvasItem).toHaveBeenCalledOnce()
rerender({ phase: 'ready', session: 2, selectedItemId: 'server:7', autoCenter: true })
expect(focusCanvasItem).toHaveBeenCalledTimes(2)
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
bunx vitest run src/test/canvas-engine-reactivation.test.tsx
```

Expected: failure because the hook does not exist.

- [ ] **Step 3: Implement the focused reactivation hook**

Track the last handled session in a ref. When Canvas is active, the engine is enabled, the current phase is ready, and the session is positive, mark that session handled. Call `focusCanvasItem(selectedItemId)` only when a selected item exists and auto-centering is enabled. Marking the session before calling focus prevents repeated effects from issuing duplicate requests.

- [ ] **Step 4: Integrate after the selection controller is created**

Call the hook in `app.tsx` after extracting `selectedItemId` and `focusCanvasItem`. Pass the current engine session and state. Keep workspace selection, inspector state, and the existing `focusCanvasItem` component-to-host resolution unchanged.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
bunx vitest run src/test/canvas-engine-reactivation.test.tsx src/test/domain-engine-gate.test.tsx src/test/topology-query.test.tsx
```

Expected: all focused lifecycle tests pass.

```bash
git add src/app/use-canvas-engine-reactivation.ts src/app/app.tsx src/test/canvas-engine-reactivation.test.tsx
git commit -m "fix: restore canvas selection after engine startup"
```

### Task 4: Release Notes And Complete Verification

**Files:**
- Modify: `src/release-notes.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Documents: one user-visible fix; no version change.

- [ ] **Step 1: Record the unreleased fix**

Add this structured fix and matching changelog entry:

```text
Switching between Systems and Canvas now starts a fresh workspace engine session without losing the selected item or Inspector, reusing stale topology, or showing false engine-not-ready warnings; automatic selection centering resumes after the new session is ready.
```

- [ ] **Step 2: Run release-note and static checks**

Run:

```bash
bun run release-notes:check
bun run lint
```

Expected: zero errors; existing accepted warnings may remain.

- [ ] **Step 3: Run the complete automated suite**

Run:

```bash
bun run test
bun run build
```

Expected: all Vitest, Bun, WASM, and build checks pass.

- [ ] **Step 4: Start local development and verify in the browser**

Start the existing local development stack on an available port. In a desktop browser:

1. Select a system in Systems and leave its Inspector open.
2. Switch to Canvas and verify the Inspector and selected item remain open.
3. Verify the selected equipment centers only when the preference is enabled.
4. Return to Systems, close and reopen the Inspector, and repeat the transition at least five times.
5. Repeat with selection centering disabled.
6. Confirm there is no `Workspace engine is not ready` warning, no console error, and no engine event stream while remaining on Systems.
7. Confirm Canvas topology and cables appear after each fresh session becomes ready.

- [ ] **Step 5: Review changes and commit documentation**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Verify `.superpowers/` remains the only unrelated untracked path.

```bash
git add src/release-notes.ts CHANGELOG.md
git commit -m "docs: note workspace engine reactivation fix"
```
