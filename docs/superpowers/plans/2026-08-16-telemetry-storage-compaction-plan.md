# Telemetry Storage Compaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace complete minute heartbeat snapshots with a backward-compatible delta protocol, typed latest-state storage, and exactly 30 CPU/memory minute slots while automatically compacting existing Docker installations.

**Architecture:** The application accepts legacy full heartbeats and new delta envelopes through one normalizer, resolves canonical agent/host IDs before telemetry persistence, and stores receipts, bounded host metrics, latest component state, and meaningful transitions. The agent persists acknowledged capability/state-family hashes, emits only changed records between six-hour reconciliations, and continues initiating every network request.

**Tech Stack:** Bun 1.3, `bun:sqlite`, Express, TypeScript/JavaScript, React 19, TanStack Query, Vitest, Bun test, Go 1.26, Ed25519 signed agent transport, gzip.

## Global Constraints

- Keep protocol major 1 compatible with currently deployed agents.
- Normal CPU/memory history is exactly 30 one-minute slots per host.
- Missing graph slots carry the preceding value while heartbeat receipt remains missed.
- Full reconciliation occurs on activation, agent restart, policy/capability change, revision gap, and every six hours.
- Do not persist disk-I/O or network telemetry.
- Do not persist per-core CPU telemetry.
- Persist every primary and foreign key as a positive safe integer.
- Demo mode must never enroll, report, reconcile, or contribute telemetry.
- Migration must be automatic, verified, rollback-capable, idempotent, and require no operator action.
- Do not bump versions, tag, push, or deploy during implementation.
- Update the unreleased structured release note and `CHANGELOG.md` for the user-visible storage and agent behavior change.

---

### Task 1: Define The Compact Application Protocol Boundary

**Files:**
- Create: `server/agents/telemetry-envelope.mjs`
- Create: `server/agents/telemetry-envelope.test.mjs`
- Modify: `server/agents/protocol-v1.mjs`
- Modify: `server/agents/protocol-v1.test.mjs`
- Modify: `server/agents/v1-routes.mjs`
- Test: `server/agents/v1-routes.test.mjs`

**Interfaces:**
- Produces: `normalizeTelemetryEnvelope(heartbeat, { agentId, hostItemId, receivedAt })`.
- Produces: `{ receipt, metricSample, latest, deltas, capabilities }` with explicit `mode: 'legacy-full' | 'delta'`.
- Consumes later: `TelemetryRepository.recordEnvelope(envelope)`.

- [ ] **Step 1: Write failing tests for legacy and delta normalization**

```js
expect(normalizeTelemetryEnvelope(legacy, identity).metricSample.cpu.percent).toBe(12.5)
expect(normalizeTelemetryEnvelope(delta, identity).deltas.containers).toEqual({
  revision: 4,
  full: false,
  changed: [{ runtime: 'docker', runtimeId: 'abc', state: 'running' }],
  removed: ['docker\0old'],
})
expect(normalizeTelemetryEnvelope(deltaWithNetwork, identity).latest).not.toHaveProperty('network')
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `bun test server/agents/telemetry-envelope.test.mjs server/agents/protocol-v1.test.mjs`

Expected: FAIL because compact delta fields are not accepted or normalized.

- [ ] **Step 3: Add backward-compatible optional protocol fields**

Accept these heartbeat fields in addition to legacy fields:

```js
{
  capabilitiesHash: '64-lowercase-hex',
  capabilities: undefined | { ... },
  state: {
    services: { revision, full, changed, removed },
    containers: { revision, full, changed, removed },
    filesystems: { revision, full, changed, removed },
    gpus: { revision, full, changed, removed },
    sensors: { revision, full, changed, removed },
    system: { revision, full, changed, removed },
    storageHealth: { revision, full, changed, removed }
  }
}
```

Omitted family means unchanged. Empty `changed` and `removed` are valid. `full: true` authorizes removal of absent entities.

- [ ] **Step 4: Implement one legacy-to-envelope adapter**

Legacy full heartbeat conversion must:

- strip CPU inventory and per-core fields;
- discard disk I/O and network;
- retain CPU aggregate and memory metrics;
- classify legacy services/containers as full snapshots;
- project filtered local filesystems, GPU identity, CPU/NVMe sensors, system, uptime, and load into latest state.

- [ ] **Step 5: Resolve canonical IDs before invoking persistence**

Change `heartbeatSink` input in `server/index.mjs` to include the canonical agent ID and host item ID resolved from the active agent binding. Reject persistence when either mapping is unavailable instead of writing nullable canonical references.

- [ ] **Step 6: Run protocol and route tests**

Run: `bun test server/agents/telemetry-envelope.test.mjs server/agents/protocol-v1.test.mjs server/agents/v1-routes.test.mjs`

Expected: PASS for both old complete heartbeats and compact deltas.

- [ ] **Step 7: Commit the protocol boundary**

```bash
git add server/agents server/index.mjs
git commit -m "feat: accept compact agent telemetry envelopes"
```

### Task 2: Introduce Telemetry Schema Version 3

**Files:**
- Modify: `server/telemetry/schema.mjs`
- Create: `server/telemetry/schema-v3.bun_spec.mjs`
- Create: `server/telemetry/entity-keys.mjs`
- Create: `server/telemetry/entity-keys.bun_spec.mjs`
- Modify: `server/telemetry/database.bun_spec.mjs`

**Interfaces:**
- Produces schema version 3 tables listed below.
- Produces stable key helpers: `serviceKey`, `containerKey`, `mountKey`, `deviceKey`, `gpuKey`, `sensorKey`.

- [ ] **Step 1: Write a failing schema contract test**

```js
expect(telemetryDatabaseStatus(database).schemaVersion).toBe(3)
expect(tableNames(database)).toEqual(expect.arrayContaining([
  'heartbeat_receipts', 'host_metric_samples', 'agent_capabilities',
  'host_system_facts', 'host_runtime_state', 'service_states',
  'container_states', 'storage_device_states', 'filesystem_mount_states',
  'gpu_states', 'sensor_states', 'storage_health_states', 'component_events',
]))
```

- [ ] **Step 2: Run the schema test and confirm failure**

Run: `bun test server/telemetry/schema-v3.bun_spec.mjs`

Expected: FAIL with schema version 2 and missing tables.

- [ ] **Step 3: Add strict typed v3 tables**

Use integer canonical IDs, integer millisecond timestamps, JSON checks only for bounded extension details, and these uniqueness rules:

```sql
UNIQUE(agent_id, sequence)
UNIQUE(host_item_id, minute_bucket_ms)
UNIQUE(host_item_id, service_manager, service_key)
UNIQUE(host_item_id, runtime, runtime_id)
UNIQUE(host_item_id, device_key)
UNIQUE(host_item_id, mount_key)
UNIQUE(host_item_id, gpu_key)
UNIQUE(host_item_id, sensor_key)
```

Add checks for percentages from 0 to 100 and positive relationship IDs.

- [ ] **Step 4: Add deterministic entity-key tests**

Verify keys ignore changing metrics and reject missing identities:

```js
expect(containerKey({ runtime: 'docker', runtimeId: 'abc', cpuPercent: 1 }))
  .toBe(containerKey({ runtime: 'docker', runtimeId: 'abc', cpuPercent: 99 }))
expect(() => serviceKey({ activeState: 'active' })).toThrow('service identity')
```

- [ ] **Step 5: Run telemetry schema tests**

Run: `bun test server/telemetry/schema-v3.bun_spec.mjs server/telemetry/entity-keys.bun_spec.mjs server/telemetry/database.bun_spec.mjs`

Expected: PASS.

- [ ] **Step 6: Commit the schema**

```bash
git add server/telemetry/schema.mjs server/telemetry/schema-v3.bun_spec.mjs server/telemetry/entity-keys.mjs server/telemetry/entity-keys.bun_spec.mjs server/telemetry/database.bun_spec.mjs
git commit -m "feat: add compact telemetry schema"
```

### Task 3: Implement Compact Telemetry Persistence

**Files:**
- Create: `server/telemetry/metric-window.mjs`
- Create: `server/telemetry/metric-window.bun_spec.mjs`
- Create: `server/telemetry/state-reconciler.mjs`
- Create: `server/telemetry/state-reconciler.bun_spec.mjs`
- Modify: `server/telemetry/repository.mjs`
- Modify: `server/telemetry/repository.bun_spec.mjs`
- Modify: `server/telemetry/retention.mjs`
- Modify: `server/telemetry/retention.bun_spec.mjs`

**Interfaces:**
- Consumes: compact envelope from Task 1.
- Produces: `recordEnvelope(envelope)` acknowledgement with accepted family revisions and reconciliation requests.
- Produces: `getTelemetryView(hostItemId, { now, minutes: 30 })`.

- [ ] **Step 1: Write failing 30-slot and reconciliation tests**

Cover:

```js
expect(repository.listMetricSamples(hostId)).toHaveLength(30)
expect(view.heartbeatBuckets).toHaveLength(30)
expect(view.metricBuckets[missingIndex]).toMatchObject({ received: false, cpuPercent: previous })
expect(countEvents(database, 'container')).toBe(1) // observed only; metric changes do not append
```

- [ ] **Step 2: Confirm tests fail**

Run: `bun test server/telemetry/metric-window.bun_spec.mjs server/telemetry/state-reconciler.bun_spec.mjs server/telemetry/repository.bun_spec.mjs`

Expected: FAIL because the repository still stores full JSON snapshots.

- [ ] **Step 3: Implement receipt and metric upserts**

Bucket with `Math.floor(receivedAtMs / 60_000) * 60_000`. Upsert one metric row per host and bucket, then delete rows outside the newest 30 buckets for that host in the same transaction.

- [ ] **Step 4: Implement latest-state upserts**

For each family:

- reject stale revisions without changing rows;
- request reconciliation on revision gaps;
- apply changed records and explicit removals transactionally;
- for full snapshots, remove currently persisted keys absent from the incoming key set;
- calculate lifecycle hashes from semantic state only;
- keep changing metrics in latest rows but out of lifecycle hashes.

- [ ] **Step 5: Materialize graph slots at query time**

Return 30 fixed minute buckets. Carry the preceding metric value across a missing bucket while leaving `received: false`. Do not carry backward before the first actual sample.

- [ ] **Step 6: Replace periodic bulk retention with bounded invariants**

Metric history is pruned inside each write. Transition retention runs at startup and hourly, draining expired rows in bounded loops until the cutoff is reached or a time budget expires. Latest-state tables are not age-pruned.

- [ ] **Step 7: Run telemetry tests**

Run: `bun test server/telemetry/*.bun_spec.mjs`

Expected: PASS with no full heartbeat payload written by the repository.

- [ ] **Step 8: Commit compact persistence**

```bash
git add server/telemetry
git commit -m "feat: persist bounded telemetry state"
```

### Task 4: Build The Automatic V2-To-V3 Compaction Migration

**Files:**
- Create: `server/telemetry/compact-migration.mjs`
- Create: `server/telemetry/compact-migration.bun_spec.mjs`
- Modify: `server/telemetry/database.mjs`
- Modify: `server/persistence/migration/cutover.ts`
- Modify: `server/persistence/migration/cutover.bun_spec.ts`
- Modify: `server/persistence/runtime.ts`
- Test fixture: derive a sanitized production-shape telemetry database during the test; do not commit live data.

**Interfaces:**
- Produces: `compactTelemetryDatabase({ sourcePath, targetPath, identityResolver, now })`.
- Produces verified manifest with source hash, source schema, target hash, target schema, counts, and activation state.

- [ ] **Step 1: Write failing migration tests**

Test a v2 database containing full payload history, metric-generated events, nullable post-cutover IDs, and duplicate legacy/latest files. Assert:

```js
expect(result.schemaVersion).toBe(3)
expect(count(target, 'host_metric_samples')).toBeLessThanOrEqual(30 * hostCount)
expect(tableNames(target)).not.toContain('telemetry_samples')
expect(nullCanonicalReferences(target)).toBe(0)
expect(metricOnlyEventCount(target)).toBe(0)
```

- [ ] **Step 2: Confirm the migration test fails**

Run: `bun test server/telemetry/compact-migration.bun_spec.mjs server/persistence/migration/cutover.bun_spec.ts`

Expected: FAIL because no compact migration exists.

- [ ] **Step 3: Implement streaming extraction**

Read v2 rows in primary-key pages without loading the database into memory. Resolve missing canonical IDs from active agent bindings and legacy aliases. Extract only:

- the newest 30 minute buckets per host;
- latest host/system/runtime/component state;
- meaningful transition events needed for active notification incidents and recovery.

- [ ] **Step 4: Implement atomic activation**

Checkpoint and hash the source, build beside it, run `foreign_key_check` where applicable and `quick_check`, rename source to rollback, activate target, reopen through the runtime, verify schema/count invariants, and remove rollback only after successful post-start verification.

- [ ] **Step 5: Implement idempotent obsolete-copy cleanup**

After activation only, remove the inactive legacy telemetry database and telemetry files inside superseded completed local migration snapshots. Never remove the current rollback file before post-start verification and never touch SkyBolt/SkyArk external backups.

- [ ] **Step 6: Add interruption and disk-space tests**

Inject failures before target validation, after source rename, and after target activation. Assert the next startup deterministically restores or accepts one valid database without duplicate migration.

- [ ] **Step 7: Run migration tests**

Run: `bun test server/telemetry/compact-migration.bun_spec.mjs server/persistence/migration/cutover.bun_spec.ts server/persistence/runtime.bun_spec.ts`

Expected: PASS.

- [ ] **Step 8: Commit automatic migration**

```bash
git add server/telemetry server/persistence
git commit -m "feat: migrate telemetry to compact storage"
```

### Task 5: Serve The Compact Telemetry API And Update The Inspector

**Files:**
- Modify: `server/agents/v1-routes.mjs`
- Modify: `server/agents/v1-routes.test.mjs`
- Modify: `src/types/agent.ts`
- Modify: `src/lib/agent-api.ts`
- Modify: `src/components/inspector/agent/use-agent-telemetry.ts`
- Modify: `src/components/inspector/agent/use-agent-telemetry.test.tsx`
- Modify: `src/components/inspector/agent/agent-heartbeat-timeline.tsx`
- Modify: `src/components/inspector/agent/agent-metrics-panel.tsx`
- Modify: `src/components/inspector/agent/agent-services-panel.tsx`
- Modify: `src/components/inspector/agent/agent-containers-panel.tsx`
- Modify: `src/components/inspector/agent/agent-storage-summary.tsx`
- Modify: `src/components/inspector/agent/agent-setup-panel.tsx`
- Test: relevant files under `src/test/`.

**Interfaces:**
- Consumes: `TelemetryRepository.getTelemetryView`.
- Produces: `AgentTelemetryView` with status, 30 heartbeat buckets, 30 metric buckets, and current-state collections.

- [ ] **Step 1: Write failing API payload tests**

Assert exactly 30 buckets, no `payload`, no `diskIo`, no `network`, and a response under a fixed fixture threshold:

```js
expect(body).not.toHaveProperty('samples')
expect(body.heartbeatBuckets).toHaveLength(30)
expect(body.metricBuckets).toHaveLength(30)
expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(100_000)
```

- [ ] **Step 2: Write failing UI contract tests**

Verify red missed slots coexist with carried graph values and current service/container rows render without historical samples.

- [ ] **Step 3: Run focused tests and confirm failure**

Run: `bun test server/agents/v1-routes.test.mjs && bun test src/components/inspector/agent/*.test.ts* src/test/notifications-ui.test.tsx`

- [ ] **Step 4: Replace the telemetry response and TypeScript types**

Remove full sample decoding from the UI. Keep the one-minute TanStack Query refresh and update only query consumers that depend on the changed view.

- [ ] **Step 5: Reconstruct the raw debugging view**

Build the modal JSON from latest typed state and include:

```json
{ "source": "reconstructed-latest-state", "observedAt": "..." }
```

Do not claim it is an original heartbeat.

- [ ] **Step 6: Run API and UI tests**

Run: `bun test server/agents/v1-routes.test.mjs && bunx vitest run src/components/inspector/agent src/test/notifications-ui.test.tsx`

Expected: PASS with compact response assertions.

- [ ] **Step 7: Commit API and UI changes**

```bash
git add server/agents src
git commit -m "feat: serve compact agent telemetry views"
```

### Task 6: Update Backup, Restore, Export, And Parity Contracts

**Files:**
- Modify: `server/telemetry/backup.mjs`
- Modify: `server/telemetry/backup-service.bun_spec.mjs`
- Modify: `server/backup/backup-sections.test.mjs`
- Modify: `server/backup/backup-service.test.mjs`
- Modify: `server/persistence/parity/report.ts`
- Modify: `scripts/local-release/remote-snapshot.mjs`
- Modify: `scripts/local-release/sanitize.mjs`
- Modify: corresponding Bun tests.

**Interfaces:**
- Produces telemetry backup section version 2 containing typed compact tables.
- Accepts legacy telemetry backup section version 1 at restore boundary and converts it through the same compaction adapter.

- [ ] **Step 1: Write failing round-trip tests**

Export compact telemetry, selectively restore it, and assert the 30-row bound, latest states, revisions, and transition events survive. Restore a legacy fixture and assert it compacts rather than recreating full payload history.

- [ ] **Step 2: Implement versioned backup adapters**

Do not expose private identity material in telemetry exports beyond existing registry-enrollment rules. Validate all numeric relationships against the restored core database before activation.

- [ ] **Step 3: Stop release snapshots from duplicating inactive legacy telemetry**

Snapshot only `/data/databases/telemetry.sqlite` after schema v3 activation. Continue accepting the legacy path when creating a pre-v3 staging snapshot.

- [ ] **Step 4: Run backup and local-release tests**

Run: `bun test server/telemetry/backup-service.bun_spec.mjs server/backup/*.test.mjs scripts/local-release/*.bun_spec.mjs server/persistence/parity`

Expected: PASS.

- [ ] **Step 5: Commit backup support**

```bash
git add server/telemetry server/backup server/persistence/parity scripts/local-release
git commit -m "feat: back up compact telemetry state"
```

### Task 7: Extend The Agent Protocol Models And Persistent Sync State

**Repository:** `/Users/maikeldorta/Code/home-datacenter/ServerSpecsInventoryAgent`

**Files:**
- Modify: `protocol/v1/models.go`
- Modify: `protocol/v1/models_test.go`
- Modify: `protocol/v1/heartbeat.schema.json`
- Modify: `protocol/v1/metrics.schema.json`
- Modify: `protocol/v1/bundle.go`
- Modify: `protocol/v1/bundle_test.go`
- Create: `internal/runtime/telemetry_state.go`
- Create: `internal/runtime/telemetry_state_test.go`
- Modify: `internal/transport/client.go`
- Modify: `internal/transport/client_test.go`

**Interfaces:**
- Produces Go `StateFamilyDelta[T]`, `HeartbeatState`, and `TelemetryAcknowledgement` models.
- Persists `telemetry-state.json` under the configured state directory with mode `0600` and atomic replacement.

- [ ] **Step 1: Write failing model and persistence tests**

```go
if got.CapabilitiesHash == "" || got.State.Containers.Revision != 4 { t.Fatal(got) }
if info.Mode().Perm() != 0o600 { t.Fatalf("mode %o", info.Mode().Perm()) }
```

- [ ] **Step 2: Add optional compact fields without changing protocol major**

Legacy heartbeat fields remain decodable. Compact fields use `omitempty`; validation distinguishes absent family, delta family, and full reconciliation family.

- [ ] **Step 3: Add canonical hashing and acknowledged state persistence**

Sort map keys and entity records before SHA-256 hashing. Persist only acknowledged capabilities hash, family revisions/hashes, last full reconciliation time, and monitoring-policy revision.

- [ ] **Step 4: Extend heartbeat response parsing**

Accept capabilities acknowledgement, family acknowledgements, and reconciliation requests while tolerating absent fields from older servers.

- [ ] **Step 5: Run Go protocol/runtime tests**

Run: `go test ./protocol/v1 ./internal/runtime ./internal/transport`

Expected: PASS.

- [ ] **Step 6: Commit agent protocol state**

```bash
git add protocol/v1 internal/runtime internal/transport
git commit -m "feat: add compact telemetry synchronization state"
```

### Task 8: Make Agent Collection Policy Purpose-Built

**Repository:** `/Users/maikeldorta/Code/home-datacenter/ServerSpecsInventoryAgent`

**Files:**
- Modify: `internal/collectors/linux/collector.go`
- Modify: `internal/collectors/linux/collector_test.go`
- Modify: `internal/collectors/linux/proc.go`
- Modify: `internal/collectors/linux/mounts.go`
- Modify: `internal/collectors/linux/mounts_test.go`
- Modify: `internal/collectors/freebsd/collector.go`
- Modify: `internal/collectors/freebsd/collector_test.go`
- Create: `internal/collectors/telemetry/sensors.go`
- Create: `internal/collectors/telemetry/sensors_test.go`
- Modify: `protocol/v1/contract.schema.json`
- Modify: `protocol/v1/models.go`

**Interfaces:**
- Produces aggregate CPU metrics without per-core arrays.
- Produces filtered local filesystem device/mount state.
- Produces one CPU average and one sensor per NVMe.
- Does not collect disk I/O or network when compact policy disables them.

- [ ] **Step 1: Write failing collector tests**

Verify:

- CPU aggregate fields remain and `cores` is absent;
- disk and network readers are not called when disabled;
- overlay, pseudo, and remote mounts are excluded;
- LVM and partition relationships remain;
- multiple CPU sensors become one average;
- NVMe sensors remain distinct.

- [ ] **Step 2: Add collection-policy switches**

Extend the versioned contract with explicit booleans for `diskIoEnabled` and `networkEnabled`, defaulting false for the compact contract while preserving safe defaults for cached legacy contracts.

- [ ] **Step 3: Refactor Linux and FreeBSD collectors**

Separate static facts, latest state, and historical metric collection. Do not invoke expensive disabled collectors. Keep capability discovery independent from minute telemetry collection.

- [ ] **Step 4: Run collector tests**

Run: `go test ./internal/collectors/... ./protocol/v1`

Expected: PASS on Linux fixtures and FreeBSD parsing fixtures.

- [ ] **Step 5: Commit collector changes**

```bash
git add internal/collectors protocol/v1
git commit -m "feat: collect purpose-built compact telemetry"
```

### Task 9: Implement Agent Deltas, Six-Hour Reconciliation, And Compact Buffering

**Repository:** `/Users/maikeldorta/Code/home-datacenter/ServerSpecsInventoryAgent`

**Files:**
- Create: `internal/runtime/state_delta.go`
- Create: `internal/runtime/state_delta_test.go`
- Modify: `internal/runtime/agent.go`
- Modify: `internal/runtime/agent_test.go`
- Modify: `internal/buffer/queue.go`
- Modify: `internal/buffer/queue_test.go`
- Modify: `internal/transport/client.go`

**Interfaces:**
- Consumes collector current state and persisted acknowledgements.
- Produces compact heartbeat deltas and six-hour full snapshots.
- Buffer keeps ordered minute metrics/transitions and collapses unacknowledged latest-state values by family/entity.

- [ ] **Step 1: Write failing delta tests**

Cover first full snapshot, unchanged minute, changed record, removal, six-hour timer, restart, policy change, capability change, and server-requested family reconciliation.

- [ ] **Step 2: Write failing offline-buffer tests**

Queue 60 disconnected minutes with unchanged services/containers. Assert 60 metric receipts remain but only one latest state per entity plus ordered lifecycle transitions is retained.

- [ ] **Step 3: Implement semantic hashes**

Service lifecycle hash excludes CPU and memory. Container lifecycle hash excludes CPU, memory, uptime, disk rates, and network rates. Latest-state hash may include those fields for upsert decisions.

- [ ] **Step 4: Implement acknowledgements and reconciliation scheduling**

Advance local acknowledged state only after successful response. Force all families full on process start and when six hours elapsed. Force requested families full on the next outbound heartbeat.

- [ ] **Step 5: Implement capability hash transport**

Send only `capabilitiesHash` after acknowledgement. Include full capabilities when local hash changes or server requests them.

- [ ] **Step 6: Run runtime and buffer tests**

Run: `go test ./internal/runtime ./internal/buffer ./internal/transport`

Expected: PASS.

- [ ] **Step 7: Commit delta runtime**

```bash
git add internal/runtime internal/buffer internal/transport
git commit -m "feat: deliver acknowledged telemetry deltas"
```

### Task 10: Cross-Repository Compatibility And Production-Shape Verification

**Files:**
- App: `server/agents/v1-routes.test.mjs`
- App: `server/telemetry/compact-migration.bun_spec.mjs`
- App: `scripts/check-telemetry-size.mjs`
- App: `scripts/check-telemetry-size.bun_spec.mjs`
- Agent: `internal/packaging/testfixture/server.go`
- Agent: `internal/packaging/packaging_test.go`
- Agent: `scripts/test-ubuntu-install.sh`

**Interfaces:**
- Produces a reproducible compact telemetry size/payload gate.
- Verifies old agent/new app and new agent/new app combinations.

- [ ] **Step 1: Add old-agent/new-app contract test**

Submit the existing full heartbeat fixture and assert compact typed state, no disk/network persistence, and a valid legacy-compatible response.

- [ ] **Step 2: Add new-agent/new-app contract test**

Run activation, first full reconciliation, unchanged heartbeat, changed container, missed revision, requested reconciliation, and capability resynchronization.

- [ ] **Step 3: Add production-shape size test**

Generate four hosts, 30 minute samples, 200 services, 128 containers, local storage state, GPUs, and sensors. Assert:

```text
telemetry database < 100 MiB
normal telemetry API response < 100 KiB
unchanged compact heartbeat < 16 KiB decompressed
component events unchanged after 1,000 metric-only updates
```

- [ ] **Step 4: Run complete agent verification**

Run in the agent repository:

```bash
go test ./...
go vet ./...
```

Expected: PASS.

- [ ] **Step 5: Run complete application verification**

Run in the application repository:

```bash
bun run lint
bun run test
bun run build
bun run security:container
```

Expected: PASS, with zero known container vulnerabilities at every severity.

- [ ] **Step 6: Commit integration gates in each repository**

Agent:

```bash
git add internal/packaging scripts
git commit -m "test: verify compact telemetry delivery"
```

Application:

```bash
git add server scripts
git commit -m "test: gate telemetry storage efficiency"
```

### Task 11: Documentation And Unreleased Notes

**Files:**
- Modify: `ServerSpecsInventory/CHANGELOG.md`
- Modify: `ServerSpecsInventory/src/release-notes.ts`.
- Modify: `ServerSpecsInventory/README.md`.
- Modify: `ServerSpecsInventory/DOCKERHUB.md`.
- Modify: `ServerSpecsInventoryAgent/README.md`.

**Interfaces:**
- Documents automatic migration, 30-minute history, latest-state semantics, six-hour reconciliation, and compatibility rollout.

- [ ] **Step 1: Update application documentation**

Describe that CPU/RAM retain 30 one-minute slots; service, container, storage, GPU, sensor, system, load, and uptime are latest state; disk-I/O and network history are not retained.

- [ ] **Step 2: Update agent documentation**

Describe capability hashing, deltas, six-hour full reconciliation, outbound-only acknowledgements, and offline-buffer behavior.

- [ ] **Step 3: Update unreleased notes**

Consolidate the user-visible migration, storage reduction, inspector payload improvement, and agent synchronization changes into one release-note group without bumping the version.

- [ ] **Step 4: Validate documentation and repository state**

Run:

```bash
bun run release-notes:check
git diff --check
git status --short
```

Expected: only intentional changes and pre-existing `.superpowers/` untracked content.

- [ ] **Step 5: Commit documentation separately**

Application:

```bash
git add CHANGELOG.md README.md DOCKERHUB.md src/release-notes.ts
git commit -m "docs: document compact agent telemetry"
```

Agent:

```bash
git add README.md
git commit -m "docs: explain compact telemetry synchronization"
```
