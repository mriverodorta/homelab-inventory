# Telemetry Storage Compaction Design

Date: 2026-08-16
Status: Approved
Scope: Homelab Inventory application and Homelab Inventory Agent

## Summary

Replace minute-by-minute complete heartbeat snapshots with a compact telemetry model that separates:

- fixed 30-minute CPU and memory history;
- lightweight heartbeat receipts;
- latest host and component state;
- meaningful lifecycle and health transitions;
- infrequently changing agent capabilities;
- manual hardware inventory evidence.

The application must migrate existing telemetry automatically when an updated Docker image starts. Existing agents remain compatible while updated agents adopt delta delivery and six-hour reconciliation.

## Current Findings

The live canonical telemetry database is approximately 4 GB. Telemetry-related files, including retained sources and migration snapshots, occupy approximately 32 GB.

The active database contains about 28,500 complete heartbeat payloads. Each Skywatch heartbeat is approximately 119 KB:

- services: approximately 52 KB for 194 records;
- metrics: approximately 44 KB;
- containers: approximately 22 KB for 29 records;
- capabilities: approximately 1 KB;
- transport metadata: less than 1 KB.

The current component hash includes changing container and service resource metrics. This creates roughly 100,000 false `changed` events per day. Retention can delete no more than 20,000 events per day and therefore cannot converge.

Post-cutover samples also expose a canonical identity defect: newer samples can be stored without `host_item_id`, preventing normalized projection rows from being created.

## Design Principles

1. Persist history only when a current product feature consumes history.
2. Persist current state once per stable entity and update it in place.
3. Persist events only for meaningful lifecycle, health, or configuration transitions.
4. Keep transport envelopes separate from domain state.
5. Use canonical numeric agent and host IDs for every persisted relationship.
6. Treat omission as unchanged and explicit removals as deletion.
7. Preserve outbound-only agent communication.
8. Keep old agents compatible during the transition.
9. Make migration automatic, verified, rollback-capable, and idempotent.

## Agent Transport Contract

### Minute Heartbeat

Every minute the agent sends:

- protocol and agent version;
- heartbeat sequence;
- collection timestamp;
- dropped-sample count;
- monitoring-policy revision;
- capabilities hash;
- aggregate CPU percentages;
- memory usage;
- changed or removed component deltas;
- changed latest-state values for filesystems, GPUs, sensors, system facts, load, and uptime.

The normal minute heartbeat does not include:

- complete capabilities;
- per-core CPU data;
- disk I/O;
- network interface metrics;
- unchanged service snapshots;
- unchanged container snapshots;
- unchanged filesystem, GPU, sensor, or system snapshots.

### Capability Synchronization

The agent calculates a canonical hash over its complete capability document.

The complete document is sent:

- during activation;
- when local capabilities change;
- when an agent update changes capabilities;
- when the server reports the hash as unknown.

Normal heartbeats send only the hash. The server acknowledges its recognized hash. The agent persists an acknowledged hash only after a successful response. If the server restores older state, it can request the full capability document in the response to the agent's next outbound request.

### Component Deltas

Each state family has an independent monotonic revision:

- services;
- containers;
- filesystems;
- GPUs;
- sensors;
- system facts;
- storage health.

A delta contains changed records and explicit stable keys for removed records. Omitted records are unchanged.

The server applies one family delta transactionally. A revision gap causes the server to request reconciliation for that family. It does not reject or reset unrelated families.

### Full Reconciliation

The agent sends a full current snapshot:

- during activation;
- after agent restart;
- after monitoring-policy changes;
- after capability changes;
- when requested because of a revision gap;
- every six hours.

The server reconciles missing entities as removed only when processing a declared full snapshot.

### Heartbeat Response

The response acknowledges:

- heartbeat sequence;
- capabilities hash;
- accepted revision for every state family;
- families requiring reconciliation;
- current monitoring-policy revision.

This remains outbound-only communication because the agent initiates every request.

### Offline Buffering

While disconnected, the agent preserves:

- ordered CPU and memory minute samples;
- ordered heartbeat sequence metadata;
- meaningful lifecycle and health transitions;
- the newest state per latest-state entity.

Repeated unchanged snapshots are not buffered. Latest-state updates collapse by stable entity key. The agent does not acknowledge local revisions until the server accepts them.

## Collection Policy

### CPU

Persist 30 one-minute historical samples containing:

- total percent;
- idle percent;
- I/O wait percent;
- steal percent;
- system percent;
- user percent.

Do not collect or persist per-core percentages in normal heartbeats. CPU model and core topology belong to hardware inventory or latest host facts.

### Memory

Persist 30 one-minute samples containing used bytes and used percentage. Keep total, available, cache, buffers, and swap values only as latest state.

### Disk I/O

Disable collection through the monitoring policy. Discard disk I/O supplied by legacy agents. No historical or latest disk-I/O table is required in this version.

### Network

Disable network collection through the monitoring policy. Discard network samples from legacy agents. Do not persist loopback, container, bridge, tunnel, or physical-interface history until an explicit network telemetry feature requires it.

### Filesystems

Keep latest state only:

- one aggregate row per physical storage device;
- one row per relevant local mount point.

Exclude pseudo-filesystems, container/overlay mounts, remote NFS/SMB/SSHFS mounts, and duplicate bind views. Preserve partition, LVM, device, and mount relationships without double-counting capacity.

### GPU

Keep one latest row per stable GPU identity. Update it only when its content changes. Static identity fields must not be repeated historically.

### Sensors

Keep latest state only:

- one temperature per NVMe device;
- one derived average CPU temperature;
- no unrelated or duplicate channels unless consumed by a feature.

Temperature changes update the current row and do not create component events.

### System, Uptime, And Load

Keep static system facts in one latest host row:

- hostname;
- operating system;
- distribution and version;
- kernel;
- architecture.

Keep uptime and 1, 5, and 15-minute load averages in latest runtime state. Do not persist their history.

### Services

Keep one latest row per host, service manager, and service name. Store classification, active state, enabled state, sub-state, result, restart count, current resource values, and last-observed timestamp.

Only these changes create events:

- observed;
- started;
- stopped;
- failed;
- recovered;
- enabled;
- disabled;
- removed.

CPU and memory changes update latest state but never create events.

### Containers

Keep one latest row per host, runtime, and runtime ID. Store name, image and digest, Compose service, runtime state, health, ports, networks, current resource values, and last-observed timestamp.

Only these changes create events:

- observed;
- started;
- stopped;
- health changed;
- image changed;
- removed.

CPU, memory, uptime text, disk rates, and network rates do not influence the lifecycle state hash.

### Storage Health

Keep current health per storage device. Persist events only for health transitions and intentional low-frequency checkpoints required by notification recovery semantics.

## Database Schema

The telemetry database uses typed SQLite tables rather than full historical JSON payloads.

### Historical Tables

`heartbeat_receipts`

- numeric agent ID;
- numeric host item ID;
- sequence;
- collected and received timestamps;
- dropped samples;
- unique agent-and-sequence constraint.

`host_metric_samples`

- numeric host item ID;
- minute bucket timestamp;
- aggregate CPU percentage columns;
- memory used bytes and percentage;
- maximum one row per host and minute.

Each host retains exactly the newest 30 minute buckets. Missing minutes have no fabricated database row.

### Latest-State Tables

- `agent_capabilities`;
- `host_system_facts`;
- `host_runtime_state`;
- `service_states`;
- `container_states`;
- `storage_device_states`;
- `filesystem_mount_states`;
- `gpu_states`;
- `sensor_states`;
- `storage_health_states`.

Every entity table uses canonical numeric relationships, stable semantic entity keys, current revision, content hash, and last-observed timestamp.

### Transition Table

`component_events` stores compact meaningful transitions. Dynamic resource metrics never participate in event hashing.

### Removed Storage

The new schema removes:

- historical full heartbeat payload JSON;
- historical per-core CPU data;
- disk-I/O samples;
- network-interface samples;
- historical filesystem samples;
- historical load and uptime;
- historical GPU and sensor snapshots;
- metric-generated service and container events.

## Thirty-Minute Window Semantics

CPU and memory use exactly 30 logical one-minute slots.

- A received heartbeat creates or replaces its corresponding minute row.
- Missing heartbeats do not create database rows.
- Rows older than the newest 30-minute window are deleted immediately.
- The API materializes exactly 30 ordered minute buckets.
- A missing graph bucket carries forward the previous known CPU and memory values.
- The heartbeat bucket remains explicitly missed, so a flat graph does not imply receipt.
- No value is carried backward before the first known sample.

## API Contract

The host telemetry endpoint returns purpose-built data:

```json
{
  "status": {},
  "heartbeatBuckets": [],
  "metricBuckets": [],
  "services": [],
  "containers": [],
  "storage": {
    "devices": [],
    "mounts": []
  },
  "gpus": [],
  "sensors": []
}
```

The endpoint does not return full historical heartbeat payloads.

- `heartbeatBuckets` contains exactly 30 received/missed slots.
- `metricBuckets` contains exactly 30 CPU/memory graph slots.
- Component collections contain current state only.
- The normal one-minute inspector refresh should transfer only a few kilobytes.

The debugging modal reconstructs the latest agent state from typed tables and labels it as reconstructed state rather than an original heartbeat document.

## Notification Integration

Notification detection reads latest state and meaningful transition events. It does not inspect changing resource metrics unless a future threshold policy explicitly enables them.

Missed heartbeat incidents remain independent from unchanged service or container state. Recovery is emitted only for an incident whose outage notification was delivered.

## Automatic Migration

Migration runs automatically during application startup and requires no user action.

1. Stop telemetry writes and checkpoint WAL.
2. Validate and hash the current telemetry database as the rollback source.
3. Build the compact target database beside the source.
4. Repair canonical numeric agent and host relationships.
5. Extract the latest 30 CPU/memory minute samples per host.
6. Extract heartbeat receipts required for the 30-minute timeline and notification state.
7. Build latest state per host and component.
8. Preserve only meaningful transitions required by active incidents and notification recovery.
9. Validate relational IDs, unique keys, revisions, row limits, foreign-key checks where applicable, and SQLite integrity.
10. Rename the original database to a rollback path.
11. Atomically activate the compact database.
12. Start the application and perform post-start verification.
13. Delete the rollback file after verification succeeds.
14. Prune obsolete legacy telemetry files and oversized telemetry copies from completed local migration snapshots.

The original database remains untouched until target validation succeeds. Any failure restores or retains the original database and emits a clear startup error. Restart after success is idempotent.

The migration must account for users with limited free disk. Because the compact target is expected to be small, it avoids making another complete multi-gigabyte backup copy. Existing backup and selective export/import workflows must support the new schema.

## Compatibility And Rollout

1. Release the application with the compact schema and support for both complete legacy heartbeats and delta heartbeats.
2. Run the automatic migration and verify old agents continue reporting.
3. Release the updated agent.
4. Updated agents adopt hash acknowledgements, deltas, and reconciliation.
5. Remove complete-heartbeat ingestion only in a future protocol-major release.

Legacy complete heartbeats are normalized at the API boundary. Their disk I/O and network data are discarded, static/latest sections are upserted, and only CPU/memory minute samples enter history.

Demo mode remains unable to enroll, report, reconcile, or contribute agent telemetry.

## Error Handling

- Duplicate heartbeat sequences are idempotent.
- Stale state-family revisions are acknowledged without reapplying.
- Revision gaps request full reconciliation for only the affected family.
- Invalid entity keys or relationships reject that family transaction without corrupting accepted families.
- Failed acknowledgements do not advance agent-local acknowledged hashes or revisions.
- Server restoration requests missing capabilities and family reconciliation through outbound-request responses.
- Insufficient disk space fails before activation and preserves the source database.
- Migration validation failure leaves the original database active.

## Test Requirements

### Agent And Protocol

- capability activation, hash acknowledgement, change, and server-restore resynchronization;
- initial snapshot, delta, explicit removal, and six-hour reconciliation;
- independent family revisions and revision-gap recovery;
- agent restart and monitoring-policy change;
- offline buffering, ordered metrics, collapsed latest state, and transitions;
- old-agent full-heartbeat compatibility;
- disk-I/O and network collection disabled by policy.

### Persistence

- exactly 30 CPU/memory minute rows per host;
- missing-minute carry-forward only at API materialization;
- current-state upserts and explicit removals;
- service/container metric changes produce no transition event;
- meaningful lifecycle and health changes produce one event;
- physical filesystem filtering and LVM/partition relationships;
- CPU temperature averaging and one state per NVMe;
- canonical host and agent relationships on new writes.

### Migration

- production-sized source migration;
- canonical identity repair;
- latest-state extraction;
- 30-minute sample extraction;
- interruption before and after activation;
- rollback and restart idempotency;
- insufficient disk space;
- legacy and oversized migration telemetry cleanup only after verification;
- backup/export/import round trips;
- SQLite quick check and relationship validation.

### API And UI

- exactly 30 heartbeat and metric buckets;
- red missed heartbeat with carried graph value;
- no carry before first known sample;
- latest service, container, storage, GPU, and sensor state;
- reconstructed debugging view;
- one-minute TanStack Query refresh without unrelated rerenders;
- payload-size regression limits.

## Acceptance Criteria

- Existing Docker users migrate without manual commands or decisions.
- Existing agents continue reporting during the rollout.
- Updated agents send unchanged service/container state only during reconciliation.
- Active telemetry storage for the current four-host deployment is reduced from gigabytes to tens of megabytes.
- Normal agent-inspector refreshes are measured in kilobytes.
- CPU and memory graphs preserve the latest 30 one-minute slots.
- Missed heartbeats remain visible while graphs carry the previous value.
- Component events grow only from real lifecycle or health transitions.
- No new telemetry row lacks its canonical numeric host or agent relationship.
- Migration is verified, rollback-capable, idempotent, and automatically cleans obsolete telemetry copies after success.
