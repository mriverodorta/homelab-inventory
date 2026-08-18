# Application-Wide SSE Live Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every periodic browser status query with one visibility-scoped SSE connection while preserving authoritative REST snapshots and adding fixed-width Systems utilization percentages.

**Architecture:** Add a transport-independent server event bus and an authenticated SSE adapter with bounded, authorized topics. Add one React provider that owns the EventSource and lets hooks subscribe to topics; domain producers emit after committed writes, and consumers either patch compact cache state or invalidate only visible larger resources.

**Tech Stack:** Bun, Express, React 19, TypeScript, TanStack Query, native `EventSource`, Vitest, Bun test.

> **Amendment:** The data-bearing follow-up in
> `2026-08-18-data-bearing-sse-updates.md` supersedes the invalidation-only
> handling described below for Systems rows and selected Agent telemetry.
> Normal heartbeats now patch client caches directly from bounded SSE payloads;
> REST is reserved for initial snapshots and explicit recovery.

## Global Constraints

- Keep Homelab Inventory Agent outbound-only; the application never opens an Agent connection.
- Keep the project-engine SSE protocol separate from application status events.
- Remove browser polling for Systems, Agent status/telemetry/hardware, notifications, update status, and demo sessions.
- Do not replace server maintenance schedules, Agent heartbeats, request timeouts, or client-only interaction timers.
- Do not fall back to interval polling when SSE is unavailable.
- REST remains authoritative for initial load, manual refresh, and reconnect/gap recovery.
- Preserve authentication-disabled, local-auth, OIDC, hybrid, demo, and staging modes.
- Update the unreleased structured notes and `CHANGELOG.md`; do not bump the version.

---

### Task 1: Server Event Bus And SSE Transport

**Files:**
- Create: `server/live-events/event-bus.mjs`
- Create: `server/live-events/topics.mjs`
- Create: `server/live-events/sse-hub.mjs`
- Create: `server/live-events/routes.mjs`
- Test: `server/live-events/event-bus.test.mjs`
- Test: `server/live-events/routes.test.mjs`
- Modify: `server/auth/api-permissions.mjs`
- Modify: `server/auth/api-permissions.test.mjs`
- Modify: `server/index.mjs`

**Interfaces:**
- Produces: `new ApplicationLiveEventBus({ generationId?, now? })` with `publish({ topics, kind, payload })`, `subscribe(listener)`, `snapshot()` and `close()`.
- Produces: `new ApplicationSseHub({ bus, heartbeatMs, maxClients, maxTopicsPerClient })` with `connect(request, response, topics)` and `closeAll()`.
- Produces: `registerApplicationEventRoutes(app, { withStore, hub, authorization, demo })`.
- Produces: strict topic parser for `systems:<id>`, `agents:fleet`, `agent-telemetry:<type>:<id>`, `agent-hardware:<type>:<id>`, `notifications:summary`, `notifications:incidents`, `updates:status`, and `demo:session`.

- [ ] **Step 1: Write failing event-bus tests**

Cover monotonic sequence, immutable envelopes, multi-topic delivery, subscriber cleanup, generation identity, and subscriber exception isolation.

- [ ] **Step 2: Run the event-bus test**

Run: `bunx vitest run server/live-events/event-bus.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the event bus and strict topic parser**

Use a single process sequence and emit envelopes shaped as:

```js
{
  version: 1,
  generationId,
  sequence,
  topics: ['systems:1'],
  kind: 'systems.host-updated',
  occurredAt,
  payload,
}
```

Reject malformed IDs, unsupported host types, duplicate/excessive topics, and payloads over the configured byte limit.

- [ ] **Step 4: Write failing SSE route tests**

Cover headers, `stream-ready`, `app-event`, comment heartbeat, topic filtering, disconnect cleanup, capacity rejection, malformed topics, and topic-specific permission denial.

- [ ] **Step 5: Implement the SSE hub and route**

Use Express streaming headers, `X-Accel-Buffering: no`, `retry: 3000`, comment heartbeats, and same-origin cookie authentication. Classify `GET /api/events` as `workspace.view`, then perform stricter per-topic authorization inside the route.

- [ ] **Step 6: Register lifecycle shutdown**

Instantiate one bus/hub in `server/index.mjs`, register the route after auth middleware, and close the hub during graceful shutdown.

- [ ] **Step 7: Run focused tests and commit**

Run:

```bash
bunx vitest run server/live-events server/auth/api-permissions.test.mjs server/engine/sse-hub.test.mjs
git add server/live-events server/auth/api-permissions.mjs server/auth/api-permissions.test.mjs server/index.mjs
git commit -m "feat: add application live event stream"
```

### Task 2: React EventSource Provider

**Files:**
- Create: `src/live-events/model.ts`
- Create: `src/live-events/application-live-events-context.ts`
- Create: `src/live-events/application-live-events-provider.tsx`
- Create: `src/live-events/use-live-event-topic.ts`
- Test: `src/live-events/application-live-events-provider.test.tsx`
- Modify: `src/main.tsx`

**Interfaces:**
- Produces: `ApplicationLiveEvent` and `ApplicationLiveTopic` types.
- Produces: `useLiveEventTopic({ topic, enabled, onEvent, onResync })`.
- Provider normalizes all mounted topic registrations into one EventSource URL.

- [ ] **Step 1: Write failing provider lifecycle tests**

Prove one stream for multiple topics, replacement on normalized topic change, cleanup in Strict Mode, hidden-document close, visible reconnect, dispatch by topic, duplicate-sequence suppression, and one resync on ready/gap/generation change.

- [ ] **Step 2: Run the provider test**

Run: `bunx vitest run src/live-events/application-live-events-provider.test.tsx`

- [ ] **Step 3: Implement typed registration and EventSource ownership**

Keep listeners in refs, serialize sorted topics once, close the previous source before opening another, and queue a microtask to coalesce registrations mounted in one render.

- [ ] **Step 4: Mount the provider inside authentication and query providers**

Place it inside `AuthGate` and outside workspace components so one app stream serves every visible surface.

- [ ] **Step 5: Run focused tests and commit**

```bash
bunx vitest run src/live-events src/test/domain-engine-gate.test.tsx
git add src/live-events src/main.tsx
git commit -m "feat: add application live event client"
```

### Task 3: Agent Lifecycle Events

**Files:**
- Create: `server/agents/lifecycle-scheduler.mjs`
- Test: `server/agents/lifecycle-scheduler.test.mjs`
- Modify: `server/agents/v1-routes.mjs`
- Modify: `server/agents/v1-routes.test.mjs`
- Modify: `server/agent-routes.mjs`
- Modify: `server/index.mjs`

**Interfaces:**
- Produces: `new AgentLifecycleScheduler({ listHosts, stateForHost, onTransition, now, setTimeoutFn, clearTimeoutFn })` with `start()`, `heartbeat(host)`, `registrationChanged(host)`, and `stop()`.
- Agent routes accept `onAgentChanged(event)` and call it only after persistence succeeds.

- [ ] **Step 1: Write failing scheduler tests**

Use fake time to prove one nearest-deadline timer, startup reconstruction, online-to-stale-to-offline transitions, heartbeat rearming, idempotency, clock movement, and stop cleanup.

- [ ] **Step 2: Implement the scheduler**

Maintain a deadline min-heap or sorted map and arm one timeout. Compute state from the established Agent timing thresholds; never scan all hosts on an interval.

- [ ] **Step 3: Write route commit-order tests**

Prove successful activation, heartbeat, hardware snapshot, unlink, and clear-status actions emit once, while authentication, telemetry persistence, or status persistence failures emit nothing.

- [ ] **Step 4: Add producer callbacks after committed writes**

Publish host identity and change kind from routes. In `server/index.mjs`, map them to `agents:fleet`, matching Systems project topics, selected-host telemetry, and selected-host hardware topics.

- [ ] **Step 5: Run focused tests and commit**

```bash
bunx vitest run server/agents/lifecycle-scheduler.test.mjs server/agents/v1-routes.test.mjs server/agent-routes.test.mjs
git add server/agents server/agent-routes.mjs server/index.mjs
git commit -m "feat: emit committed agent lifecycle events"
```

### Task 4: Systems And Fleet Status Without Polling

**Files:**
- Modify: `server/systems/read-service.mjs`
- Modify: `server/systems/read-service.bun_spec.ts`
- Modify: `src/types/systems.ts`
- Modify: `src/hooks/use-systems.ts`
- Modify: `src/hooks/use-systems.test.tsx`
- Modify: `src/hooks/use-agent-status.ts`
- Modify: `src/hooks/use-agent-status.test.tsx`
- Modify: `src/components/workbook/systems-workspace.tsx`
- Modify: `src/components/workbook/systems/systems-utilization-bar.tsx`
- Modify: `src/components/workbook/systems/systems-table.tsx`
- Modify: `src/components/workbook/systems-workspace.test.tsx`
- Modify: `src/components/workbook/systems/systems-table.test.tsx`

**Interfaces:**
- Produces: a sparse `SystemsHostLive` projection with omitted unchanged fields and explicit null clearing.
- Consumes: `systems:<projectId>` and `agents:fleet` topics.

- [ ] **Step 1: Write failing sparse-payload and cache-merge tests**

Prove unregistered null rows are omitted, Agent update commands do not repeat, the 23-host fixture stays under 1.5 KB, host deltas preserve unrelated rows, and null clears prior state.

- [ ] **Step 2: Implement sparse server projection and client merge**

Keep the initial Systems query authoritative. Replace the 30-second live query with topic events and a cache keyed by numeric `itemId`; resync uses one conditional `/systems/live` request.

- [ ] **Step 3: Remove Agent fleet polling**

Replace the 60-second `refetchInterval` with `agents:fleet` event handling and one resync query. Preserve bootstrap consumption and mutation cache updates.

- [ ] **Step 4: Add fixed-width utilization labels**

Render the rounded/clamped label before the bar using `tabular-nums` and a stable width. Format `0..9` with a leading zero and render `100%` without truncation.

- [ ] **Step 5: Run focused tests and commit**

```bash
bunx vitest run src/hooks/use-systems.test.tsx src/hooks/use-agent-status.test.tsx src/components/workbook server/systems/read-service.bun_spec.ts
git add server/systems src/types/systems.ts src/hooks src/components/workbook
git commit -m "feat: stream systems and agent fleet updates"
```

### Task 5: Selected Agent Telemetry And Hardware Evidence

**Files:**
- Modify: `src/components/inspector/agent/use-agent-telemetry.ts`
- Modify: `src/components/inspector/agent/use-agent-telemetry.test.tsx`
- Modify: `src/components/inspector/agent/agent-hardware-evidence.tsx`
- Add/modify hardware evidence tests

**Interfaces:**
- Consumes: `agent-telemetry:<hostType>:<hostId>` and `agent-hardware:<hostType>:<hostId>`.
- Uses query invalidation only while the relevant inspector consumer is mounted and enabled.

- [ ] **Step 1: Write failing event-driven query tests**

Prove no intervals exist, unrelated host events do nothing, matching events coalesce into one refresh, hidden/unmounted inspectors do not request, and ready/gap performs one resync.

- [ ] **Step 2: Replace both polling intervals with topic subscriptions**

Keep one initial REST query. Invalidate the exact host query after its committed event; use a short microtask/debounce coalescer rather than a repeating timer.

- [ ] **Step 3: Run focused tests and commit**

```bash
bunx vitest run src/components/inspector/agent
git add src/components/inspector/agent
git commit -m "feat: stream selected agent evidence"
```

### Task 6: Notifications Without Polling

**Files:**
- Modify: `server/notifications/store.mjs`
- Modify: `server/notifications/runtime.mjs`
- Modify: `server/notifications/routes.mjs`
- Modify: notification server tests
- Modify: `src/hooks/use-notifications.ts`
- Modify: notification client tests
- Modify: `src/app/app.tsx`
- Modify: `src/components/notifications/notification-center.tsx`

**Interfaces:**
- Produces: `notifications:summary` compact payload `{ active, unacknowledged, exhaustedDeliveries }`.
- Produces: `notifications:incidents` and configuration invalidation events after writes.

- [ ] **Step 1: Write failing notification event tests**

Prove incident open/recover/acknowledge/retry and config changes publish only after commit, summary payload contains no config/secrets, and unchanged evaluations do not emit.

- [ ] **Step 2: Add notification producer integration**

Publish from store/runtime transition boundaries. Do not place contact points, rules, credentials, or host policy in summary events.

- [ ] **Step 3: Remove snapshot and incident polling**

The Canvas notification control subscribes only when visible. Settings and host controls load full config on demand and invalidate on config events. Notification Center loads pages on open and invalidates only while open.

- [ ] **Step 4: Run focused tests and commit**

```bash
bunx vitest run server/notifications src/hooks/use-notifications.test.tsx src/components/notifications
git add server/notifications src/hooks/use-notifications.ts src/app/app.tsx src/components/notifications
git commit -m "feat: stream notification state"
```

### Task 7: Update And Demo Session Events

**Files:**
- Modify: `server/update-scheduler.mjs`
- Modify: `server/update-scheduler.test.mjs`
- Modify: `server/update-routes.mjs`
- Modify: `server/index.mjs`
- Modify: `src/app/use-release-update-controller.ts`
- Modify: update client tests
- Modify: `server/demo/session-manager.mjs`
- Modify: `server/demo/session-manager.test.mjs`
- Modify: demo routes in `server/index.mjs`
- Modify: `src/app/use-demo-session-lifecycle.ts`
- Modify: demo client tests

**Interfaces:**
- Produces: `updates:status` public status after persisted server checks and skip changes.
- Produces: `demo:session` status after extend, expire, and cleanup.

- [ ] **Step 1: Write failing producer and hook tests**

Prove update events occur only when public status changes, manual checks update immediately, demo extension converges across tabs, local countdown remains, and no periodic client requests remain.

- [ ] **Step 2: Publish server update and demo changes**

Add callbacks to scheduler/routes/manager after successful persistence. Use complete compact public status payloads.

- [ ] **Step 3: Remove browser schedules and subscribe to topics**

Keep initial bootstrap data. Disable interval/focus/mount/network revalidation for these event-managed queries and perform one resync after stream ready/gap.

- [ ] **Step 4: Run focused tests and commit**

```bash
bunx vitest run server/update-scheduler.test.mjs server/update-routes.test.mjs server/demo/session-manager.test.mjs src/app
git add server/update-* server/demo server/index.mjs src/app
git commit -m "feat: stream update and demo session state"
```

### Task 8: Polling Regression Guard, Documentation, And Release Notes

**Files:**
- Create: `src/test/no-server-polling.test.ts`
- Modify: `src/release-notes.ts`
- Modify: `CHANGELOG.md`
- Modify: architecture/operations docs describing Agent and SSE traffic

**Interfaces:**
- Produces: a static test that rejects `refetchInterval`, server-fetching `setInterval`, and newly allowlisted periodic browser requests in application source.

- [ ] **Step 1: Write and run the static regression test**

The test scans non-test files under `src` and fails on `refetchInterval` or a periodic callback that invokes API-loading functions. It explicitly allows client-only countdown and interaction timers.

- [ ] **Step 2: Remove obsolete constants, helpers, and polling test language**

Delete `SYSTEMS_LIVE_REFRESH_INTERVAL_MS`, `AGENT_STATUS_REFRESH_INTERVAL_MS`, `AGENT_TELEMETRY_REFRESH_INTERVAL_MS`, hardware refresh intervals, and browser update-status refetch calculations when no longer referenced.

- [ ] **Step 3: Update user and operator documentation**

Document one application SSE connection, the separate engine stream, reverse-proxy buffering requirements, Agent outbound-only behavior, stream capacity, reconnect resync, and degraded-live-state behavior.

- [ ] **Step 4: Update unreleased notes and changelog**

Describe lower idle traffic, event-driven Agent/Systems/notification updates, reconnect reliability, and utilization percentage labels. Do not bump the version.

- [ ] **Step 5: Commit**

```bash
git add src/test/no-server-polling.test.ts src/release-notes.ts CHANGELOG.md docs
git commit -m "docs: document event-driven live updates"
```

### Task 9: Full Verification

**Files:**
- No planned source files; any regression fix must name its exact files in the
  resulting scoped commit.

- [ ] **Step 1: Run focused no-polling and stream suites**

```bash
bunx vitest run server/live-events server/agents server/notifications src/live-events src/hooks src/app src/components/inspector/agent src/components/workbook
```

- [ ] **Step 2: Run required repository validation**

```bash
bun run lint
bun run test
bun run build
bun run security:container
```

- [ ] **Step 3: Run local production-shaped E2E**

Verify:

- an idle visible browser makes no repeating application API GETs;
- the app has one application SSE stream plus the engine stream only where needed;
- Systems updates after a heartbeat;
- stopped Agent changes to stale/offline without a browser request;
- selected telemetry and hardware update only while open;
- Systems does not request notifications;
- Notification Center updates while open;
- update and demo state converge;
- network disconnect/reconnect causes one resync;
- reverse-proxy-equivalent buffering does not delay frames;
- Systems labels show `03%`, `15%`, `99%`, and `100%` without shifting.

- [ ] **Step 4: Confirm data and release invariants**

Confirm no schema/version bump, no inventory/project/cable mutation, no private data in Git, and only `.superpowers/` remains unrelated/untracked.

- [ ] **Step 5: Commit any final regression fixes**

Use a scoped fix commit and rerun the affected focused tests plus lint/build.
