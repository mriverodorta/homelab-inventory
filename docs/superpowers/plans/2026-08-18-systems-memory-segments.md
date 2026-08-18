# Systems Memory Segments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an htop-inspired latest-memory breakdown to Systems rows while preserving the existing green/gray fallback for incomplete Agent data.

**Architecture:** Extend the existing bounded telemetry projection with parsed latest-state memory counters, pass a nullable validated breakdown through the Systems read service and TypeScript API contract, and let the memory utilization component choose segmented or fallback rendering. Reuse current SQLite state and SSE invalidation; do not add persistence or polling.

**Tech Stack:** Bun, bun:sqlite, Hono server routes, React, TypeScript, Tailwind CSS, Bun test, Vitest, Testing Library.

## Global Constraints

- Use only the latest `host_runtime_state.memory_json` data.
- Keep the current `memoryPercent` headline and 30-minute history semantics.
- Render segments only when total, available, cache, and buffer counters are finite and non-negative.
- Never fabricate shared memory.
- Keep FreeBSD, OPNsense, legacy, stale, and offline hosts on the current green/gray bar.
- Add no database migration, polling loop, or Agent protocol change.

---

### Task 1: Expose the latest memory breakdown

**Files:**
- Modify: `server/telemetry/repository.mjs`
- Modify: `server/telemetry/repository.bun_spec.mjs`
- Modify: `server/systems/read-service.mjs`
- Modify: `server/systems/read-service.bun_spec.ts`

**Interfaces:**
- Produces: `memoryBreakdown: { totalBytes, availableBytes, cachedBytes, buffersBytes, sharedBytes } | null` in Systems initial and live rows.

- [ ] **Step 1: Write repository and read-service tests**

Add fixtures with `memory_json` containing Linux counters, incomplete FreeBSD counters, and stale telemetry. Assert complete online data is projected and incomplete/stale data is null.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `bun test server/telemetry/repository.bun_spec.mjs server/systems/read-service.bun_spec.ts`

Expected: FAIL because `memoryBreakdown` is absent.

- [ ] **Step 3: Implement the bounded projection**

Select `runtime.memory_json`, parse it once per host, validate finite non-negative fields in the read service, and attach the nullable object to both initial and live projections.

- [ ] **Step 4: Run focused tests**

Run: `bun test server/telemetry/repository.bun_spec.mjs server/systems/read-service.bun_spec.ts`

Expected: PASS.

### Task 2: Render segmented and fallback bars

**Files:**
- Modify: `src/types/systems.ts`
- Modify: `src/components/workbook/systems/systems-table.tsx`
- Modify: `src/components/workbook/systems/systems-utilization-bar.tsx`
- Modify: `src/test/systems-utilization-bar.test.tsx`
- Modify: affected Systems fixtures in `src/components/workbook/systems-workspace.test.tsx` and `src/components/workbook/systems/systems-table-model.test.ts`

**Interfaces:**
- Consumes: nullable `SystemsMemoryBreakdown`.
- Produces: `SystemsUtilizationBar` with optional `memoryBreakdown` and deterministic segment rendering.

- [ ] **Step 1: Write component regression tests**

Assert Linux data renders green, blue, and orange segments with clamped widths and descriptive accessible text. Assert null and incomplete data render only the existing green segment and gray track.

- [ ] **Step 2: Run the component test and verify failure**

Run: `bunx vitest run src/test/systems-utilization-bar.test.tsx`

Expected: FAIL because the component has no breakdown input.

- [ ] **Step 3: Implement the UI contract and rendering**

Add the shared TypeScript type, pass it only for memory cells, calculate bounded segments, preserve the `4ch` label track and 25/50/75 markers, and expose category percentages in the accessible label.

- [ ] **Step 4: Run focused frontend tests**

Run: `bunx vitest run src/test/systems-utilization-bar.test.tsx src/components/workbook/systems-workspace.test.tsx src/components/workbook/systems/systems-table-model.test.ts`

Expected: PASS.

### Task 3: Document and verify the release

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `src/release-notes.ts`

**Interfaces:**
- Documents the user-visible Systems memory visualization change in Unreleased notes.

- [ ] **Step 1: Add release notes**

Describe segmented Linux memory bars and the automatic green/gray fallback for Agents without detailed memory counters.

- [ ] **Step 2: Run complete verification**

Run:

```bash
bun run lint
bun run test
bun run build
```

Expected: all commands pass, with only previously accepted lint warnings.

- [ ] **Step 3: Run the Impeccable detector**

Run:

```bash
node /Users/maikeldorta/.agents/skills/impeccable/scripts/detect.mjs --json \
  src/components/workbook/systems/systems-utilization-bar.tsx
```

Expected: no actionable layout or accessibility findings.
