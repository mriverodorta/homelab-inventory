# Cross-Platform Memory Pressure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Report accurate Linux and FreeBSD memory counters from the Agent and render one consistent used-versus-available pressure bar in the Systems workspace.

**Architecture:** The Agent extends its protocol-v1 memory map with optional raw OS counters. The application preserves those counters in latest telemetry state and resolves a bounded pressure percentage in a focused server helper; the compact Systems API and React component render only that result.

**Tech Stack:** Go Agent collectors, Bun server and SQLite latest-state storage, React/TypeScript, Tailwind CSS, Bun Test, Vitest, Testing Library.

## Global Constraints

- Existing protocol-v1 agents and servers remain compatible.
- Collection remains outbound-only and unprivileged.
- The Systems table renders only green pressure and gray available memory.
- Linux uses `MemAvailable`; FreeBSD follows OPNsense used-minus-ARC semantics.
- Missing counters are omitted, not fabricated.
- No telemetry schema migration is introduced.
- The utilization label track is exactly `4ch` with a minimal explicit gap.
- Do not bump either project version until deployment is requested.

---

### Task 1: Linux Raw Memory Counters

**Files:**
- Modify: `/Users/maikeldorta/Code/home-datacenter/ServerSpecsInventoryAgent/internal/collectors/linux/proc.go`
- Modify: `/Users/maikeldorta/Code/home-datacenter/ServerSpecsInventoryAgent/internal/collectors/linux/collector_test.go`

**Interfaces:**
- Consumes: Linux `/proc/meminfo` values in KiB.
- Produces: optional protocol-v1 memory keys `freeBytes`, `reclaimableBytes`, and `sharedBytes` alongside existing total, available, buffer, cache, swap, and pressure fields.

- [ ] Add a failing parser test with `MemFree`, `SReclaimable`, and `Shmem`, asserting every field is converted to bytes and `usedPercent` remains based only on `MemAvailable`.
- [ ] Run `go test ./internal/collectors/linux` and confirm the new assertions fail.
- [ ] Extend `parseMeminfo` to emit the three new raw counters without changing existing pressure semantics.
- [ ] Add malformed and missing optional-field coverage proving absent values are omitted rather than represented as fabricated zeros.
- [ ] Run `go test ./internal/collectors/linux` and confirm it passes.
- [ ] Commit the Agent change as `feat: report Linux memory pressure counters`.

### Task 2: FreeBSD And OPNsense Memory Pressure

**Files:**
- Modify: `/Users/maikeldorta/Code/home-datacenter/ServerSpecsInventoryAgent/internal/collectors/freebsd/collector.go`
- Modify: `/Users/maikeldorta/Code/home-datacenter/ServerSpecsInventoryAgent/internal/collectors/freebsd/collector_test.go`

**Interfaces:**
- Consumes: `hw.physmem`, VM page-size/count/class counters, and optional `kstat.zfs.misc.arcstats.size` from one unprivileged `sysctl` call.
- Produces: `pageSizeBytes`, `pageCount`, `activePages`, `inactivePages`, `cachePages`, `laundryPages`, `wiredPages`, `freePages`, optional `zfsArcBytes`, and bounded `usedBytes`/`usedPercent` after ARC subtraction.

- [ ] Extend the FreeBSD fixture with page count, active, laundry, and wired counters and assert the exact raw output.
- [ ] Add a failing OPNsense regression test using the SkyGate sample values and assert approximately `28.01%` pressure after ARC subtraction.
- [ ] Add a no-ZFS fixture proving absent ARC remains valid and does not create an ARC key.
- [ ] Run `go test ./internal/collectors/freebsd` and confirm the tests fail before implementation.
- [ ] Add the required sysctl keys and implement the bounded OPNsense pressure calculation without double-counting ARC.
- [ ] Reject incomplete required page counters through the existing capability state while preserving optional cache and ARC behavior.
- [ ] Run `go test ./internal/collectors/freebsd` and then `go test ./...`.
- [ ] Commit the Agent change as `feat: report FreeBSD memory pressure counters`.

### Task 3: Preserve And Interpret Memory Pressure In The App

**Files:**
- Create: `/Users/maikeldorta/Code/home-datacenter/ServerSpecsInventory/server/systems/memory-pressure.mjs`
- Create: `/Users/maikeldorta/Code/home-datacenter/ServerSpecsInventory/server/systems/memory-pressure.bun_spec.ts`
- Modify: `/Users/maikeldorta/Code/home-datacenter/ServerSpecsInventory/server/agents/telemetry-envelope.mjs`
- Modify: `/Users/maikeldorta/Code/home-datacenter/ServerSpecsInventory/server/agents/telemetry-envelope.test.mjs`
- Modify: `/Users/maikeldorta/Code/home-datacenter/ServerSpecsInventory/server/systems/read-service.mjs`
- Modify: `/Users/maikeldorta/Code/home-datacenter/ServerSpecsInventory/server/systems/read-service.bun_spec.ts`
- Modify: `/Users/maikeldorta/Code/home-datacenter/ServerSpecsInventory/src/types/systems.ts`

**Interfaces:**
- Produces: `memoryPressurePercent(memory): number | null`, returning a finite value from zero through 100.
- Preserves: raw optional counters in `host_runtime_state.memory_json`.
- Removes: `memoryBreakdown` from compact Systems initial/live response types.

- [ ] Write failing helper tests for Linux available-memory pressure, FreeBSD raw-counter pressure, FreeBSD ARC subtraction, legacy `usedPercent`, `usedBytes` fallback, and invalid data.
- [ ] Run `bun test server/systems/memory-pressure.bun_spec.ts` and confirm failure.
- [ ] Implement the focused pressure resolver with strict bounds and explicit OS-counter detection.
- [ ] Extend telemetry normalization to preserve the new optional raw counters while keeping nulls for absent values.
- [ ] Update normalization tests to prove round-trip preservation.
- [ ] Replace the read service's direct telemetry percentage with the pressure resolver and remove the composition projection.
- [ ] Update Systems service tests and types so initial and live responses contain only `memoryPercent`.
- [ ] Run the focused Bun tests and commit as `feat: normalize cross-platform memory pressure`.

### Task 4: Simplify And Align Systems Utilization Bars

**Files:**
- Modify: `/Users/maikeldorta/Code/home-datacenter/ServerSpecsInventory/src/components/workbook/systems/systems-utilization-bar.tsx`
- Modify: `/Users/maikeldorta/Code/home-datacenter/ServerSpecsInventory/src/components/workbook/systems/systems-table.tsx`
- Modify: `/Users/maikeldorta/Code/home-datacenter/ServerSpecsInventory/src/test/systems-utilization-bar.test.tsx`

**Interfaces:**
- Consumes: only `value` and `kind`.
- Renders: fixed `4ch` label, minimal gap, green/gray memory bar, existing CPU/storage tones and thresholds.

- [ ] Replace segmented-memory tests with one proving memory has exactly one green segment at the pressure width and a gray remainder.
- [ ] Add a layout assertion for `grid-cols-[4ch_minmax(0,1fr)]`, no horizontal padding, and the chosen minimal gap token.
- [ ] Run `bun run test -- src/test/systems-utilization-bar.test.tsx` and confirm failure.
- [ ] Remove memory composition code and the `memoryBreakdown` prop.
- [ ] Change the grid to an exact four-character track, `minmax(0,1fr)`, and a two-pixel-equivalent gap so the bar begins immediately after the reserved label.
- [ ] Remove `memoryBreakdown` plumbing from `MetricCell` and memory cells.
- [ ] Run the focused Vitest test and commit as `fix: clarify systems memory pressure`.

### Task 5: Release Notes And End-To-End Verification

**Files:**
- Modify: `/Users/maikeldorta/Code/home-datacenter/ServerSpecsInventory/CHANGELOG.md`
- Modify: `/Users/maikeldorta/Code/home-datacenter/ServerSpecsInventory/src/release-notes.ts`
- Modify: `/Users/maikeldorta/Code/home-datacenter/ServerSpecsInventoryAgent/README.md`

**Interfaces:**
- Documents: cross-platform memory pressure semantics and new optional raw counters.

- [ ] Update the app Unreleased changelog and structured release-note draft with the accurate pressure bar and spacing fix.
- [ ] Update Agent telemetry documentation with Linux and FreeBSD raw counters and unprivileged collection guarantees.
- [ ] Run Agent formatting, `go test ./...`, and `go vet ./...`.
- [ ] Run app `bun run lint`, `bun run test`, and `bun run build`.
- [ ] Start the local app with copied test data and verify CPU, RAM, and storage labels align in dense and comfortable Systems rows.
- [ ] Verify Linux memory uses a green pressure/gray available bar and an OPNsense fixture resolves to approximately 28% pressure.
- [ ] Confirm the Systems live payload no longer contains `memoryBreakdown`.
- [ ] Commit documentation and verification updates without changing either version.

