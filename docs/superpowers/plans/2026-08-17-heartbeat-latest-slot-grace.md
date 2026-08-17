# Heartbeat Latest-Slot Grace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the newest heartbeat chip green while the latest successful Agent report is within the configured online grace period, and add missed slots only after a report is genuinely overdue.

**Architecture:** `TelemetryRepository.getTelemetryView` remains the canonical producer of the aligned 30-slot heartbeat and metric timeline. The Agent telemetry route passes the negotiated heartbeat interval and online grace period into that method. React renders the returned truth without final-slot overrides.

**Tech Stack:** Bun, `bun:sqlite`, Express, Vitest, React, TypeScript

## Global Constraints

- Keep exactly 30 heartbeat and metric slots.
- Use the negotiated Agent heartbeat interval and the same online grace period used by Agent status.
- Preserve historical missed slots and last-known metric carry-forward.
- Do not add server-to-Agent communication.
- Do not change telemetry schema or persisted data.
- Update unreleased structured release notes and `CHANGELOG.md` for this user-visible fix.

---

### Task 1: Cadence-aware telemetry window

**Files:**
- Modify: `server/telemetry/repository.mjs`
- Test: `server/telemetry/repository.bun_spec.mjs`

**Interfaces:**
- Consumes: `getTelemetryView(hostType, hostId, { now, minutes, heartbeatIntervalMs, onlineMaxAgeMs })`
- Produces: `{ buckets, latest }`, where `buckets` remain `{ at, received, metrics }[]`

- [ ] **Step 1: Add failing repository tests**

Add cases that store samples at `16:40:52` and `16:41:52`, then assert:

```js
const online = repository.getTelemetryView('server', 1, {
  now: Date.parse('2026-08-17T16:42:30.000Z'),
  heartbeatIntervalMs: 60_000,
  onlineMaxAgeMs: 90_000,
})
expect(online.buckets.at(-1)).toMatchObject({
  at: '2026-08-17T16:41:00.000Z',
  received: true,
})
```

Also assert that `now = 16:43:23` creates the first red overdue slot, historical gaps stay red, and missed slots retain the previous metrics.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
bun x vitest run server/telemetry/repository.bun_spec.mjs
```

Expected: the minute-boundary case fails because the final bucket is the speculative `16:42` slot.

- [ ] **Step 3: Implement cadence-aware anchoring**

Normalize the optional durations and calculate overdue slots from the latest receipt:

```js
const interval = positiveDuration(heartbeatIntervalMs, 60_000)
const grace = positiveDuration(onlineMaxAgeMs, 90_000)
const latestAt = latest ? Math.floor(Date.parse(latest.receivedAt) / interval) * interval : null
const overdue = latest && now - Date.parse(latest.receivedAt) > grace
  ? Math.ceil((now - Date.parse(latest.receivedAt) - grace) / interval)
  : 0
const end = latestAt === null
  ? Math.floor(now / interval) * interval
  : latestAt + (overdue * interval)
```

Build the same bounded window ending at `end`. Continue carrying `previous` metrics through missing buckets.

- [ ] **Step 4: Run repository tests**

Run:

```bash
bun x vitest run server/telemetry/repository.bun_spec.mjs
```

Expected: all repository tests pass.

### Task 2: Route timing synchronization

**Files:**
- Modify: `server/agents/v1-routes.mjs`
- Test: `server/agents/v1-routes.test.mjs`

**Interfaces:**
- Consumes: `timing.heartbeatIntervalMs` and `timing.onlineMaxAgeMs` from `agentStatusTiming()`
- Produces: one `getTelemetryView` call with `{ now, minutes: 30, heartbeatIntervalMs, onlineMaxAgeMs }`

- [ ] **Step 1: Strengthen the route test**

Assert the mocked repository receives the server clock and negotiated timing:

```js
expect(getTelemetryView).toHaveBeenCalledWith('server', 1, expect.objectContaining({
  minutes: 30,
  heartbeatIntervalMs: 60_000,
  onlineMaxAgeMs: 90_000,
}))
```

- [ ] **Step 2: Run the route test and verify failure**

Run:

```bash
bun x vitest run server/agents/v1-routes.test.mjs
```

Expected: the mock call lacks heartbeat timing options.

- [ ] **Step 3: Pass timing to the repository**

Change the telemetry route call to:

```js
const telemetryView = telemetryRepository.getTelemetryView?.(host.hostType, host.hostId, {
  now: serverTime.getTime(),
  minutes: 30,
  heartbeatIntervalMs: timing.heartbeatIntervalMs,
  onlineMaxAgeMs: timing.onlineMaxAgeMs,
})
```

- [ ] **Step 4: Run route and repository tests together**

Run:

```bash
bun x vitest run server/agents/v1-routes.test.mjs server/telemetry/repository.bun_spec.mjs
```

Expected: both suites pass.

### Task 3: User-visible regression coverage and release documentation

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `src/release-notes.ts`

**Interfaces:**
- Consumes: corrected backend heartbeat timeline
- Produces: unreleased documentation describing the fix

- [ ] **Step 1: Record the regression fix**

Add an Unreleased changelog entry and structured release-note item explaining that online Agents no longer show a speculative red latest heartbeat after a wall-clock minute boundary.

- [ ] **Step 2: Run focused verification**

Run:

```bash
bun x vitest run server/telemetry/repository.bun_spec.mjs server/agents/v1-routes.test.mjs src/components/inspector/agent/agent-heartbeat-model.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 3: Run repository checks**

Run:

```bash
bun run lint
bun run test
bun run build
```

Expected: all checks pass; only documented pre-existing lint warnings may remain.

- [ ] **Step 4: Commit implementation**

```bash
git add server/telemetry/repository.mjs server/telemetry/repository.bun_spec.mjs server/agents/v1-routes.mjs server/agents/v1-routes.test.mjs CHANGELOG.md src/release-notes.ts
git commit -m "fix: honor heartbeat grace in latest timeline slot"
```

