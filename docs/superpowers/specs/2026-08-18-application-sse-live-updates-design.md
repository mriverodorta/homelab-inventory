# Application-Wide SSE Live Updates Design

**Date:** 2026-08-18

## Objective

Replace every periodic browser-to-server status request with a server-sent event
(SSE) update path. The browser must stop polling Systems, Agent state and
telemetry, Agent hardware evidence, notifications, update availability, and demo
session state. Data must update after the server knows it changed, while initial
loads and reconnect recovery remain deterministic.

This design also adds fixed-width integer utilization labels before the compact
Systems CPU, memory, and storage bars:

- `03%`
- `15%`
- `99%`
- `100%`

## Scope Boundary

This change removes **server-to-browser status polling**. It does not remove
timers that perform different jobs:

- Homelab Inventory Agent remains outbound-only and continues sending signed
  heartbeats to the application at its configured cadence.
- Server-side backup, catalog refresh, contribution delivery, notification
  delivery, retention, and update-check schedules remain server jobs.
- Client-only timers for animation, copy confirmation, input debounce, save
  debounce, touch gestures, and the locally rendered demo countdown remain.
- Request timeout timers remain.
- The existing project-engine SSE stream remains separate because it carries
  ordered project revision patches with its own consistency protocol.

SSE does not let the application initiate a connection to an Agent. The data
flow remains:

```text
Agent --signed outbound HTTP--> Homelab Inventory server
Homelab Inventory server --SSE--> authorized browser
Browser --REST mutations--> Homelab Inventory server
```

## Existing Browser Polling Inventory

The following current browser polling paths move to SSE:

| Surface | Current behavior | New behavior |
| --- | --- | --- |
| Systems live rows | `GET /systems/live` every 30 seconds | Active Systems topic; compact changed-host events |
| Agent fleet status | `GET /api/agent/status` every 60 seconds | Compact host status events |
| Selected-host telemetry | Host telemetry every 60 seconds | Host telemetry invalidation after committed heartbeat |
| Agent hardware evidence | Hardware snapshot every 60 seconds | Host hardware invalidation after a new scan is committed |
| Notification snapshot | Full config and summary every 30 seconds | Summary events only while its visible control is mounted |
| Notification incidents | Incident pages every 60 seconds | Incident invalidation while Notification Center is open |
| Application update status | Browser refresh schedule up to every 6 hours | Server update scheduler emits changed status |
| Demo session | Session status every 60 seconds | Session events plus a local countdown derived from `expiresAt` |

Queries that run once when a dialog, route, or inspector opens are demand loads,
not polling. They remain REST queries and are refreshed by relevant events while
visible.

## Chosen Architecture

### Application event bus

Add a transport-independent, in-process `ApplicationLiveEventBus`. Producers
publish typed domain events only after their backing write has committed. The
event bus owns event sequencing and fan-out; it does not know about React Query,
HTTP responses, or component state.

The SSE adapter exposes the event bus to browsers. A future WebSocket adapter
may consume the same event bus without changing producers or domain services.

The existing engine SSE hub is not reused. Engine events are ordered project
patches and invalidations, while application live events are status changes and
query-cache updates. Keeping the protocols separate prevents Agent or
notification traffic from blocking project synchronization.

### One dynamic application stream

Each visible browser application uses at most one application event stream:

```text
GET /api/events?topics=<bounded-topic-list>
```

The client provider derives the topic set from visible consumers. When the user
changes workspace, opens an Agent inspector, opens Notification Center, or
closes a surface, the provider reconnects with the new normalized topic set.
The previous EventSource is closed before the replacement is opened.

The project-engine EventSource remains a second independent stream when the
active workspace requires it.

### Topic catalog

Topics are a strict server-side allowlist, not arbitrary strings:

```text
systems:<projectId>
agents:fleet
agent-telemetry:<hostType>:<hostId>
agent-hardware:<hostType>:<hostId>
notifications:summary
notifications:incidents
updates:status
demo:session
```

Only currently visible consumers subscribe:

- Systems subscribes to `systems:<projectId>`.
- Canvas or any other surface displaying Agent status subscribes to
  `agents:fleet`.
- An open Agent inspector subscribes to the selected host telemetry topic.
- The hardware evidence section subscribes to the selected host hardware topic.
- The Canvas notification control subscribes to `notifications:summary` only
  while that control is visible.
- Notification Center adds `notifications:incidents` while open.
- Update status subscribes only while the update UI or its visible indicator
  requires live state.
- Only demo mode subscribes to `demo:session`.

Closing or hiding a consumer removes its topic. The document closes the
application stream while hidden and reconnects when visible. External ntfy
delivery remains responsible for notifications when the application tab is not
active.

## Event Protocol

Every event uses a versioned envelope:

```json
{
  "version": 1,
  "sequence": 42,
  "topic": "systems:1",
  "kind": "systems.host-updated",
  "occurredAt": "2026-08-18T12:00:00.000Z",
  "payload": {}
}
```

The SSE frame uses the event sequence as its `id`, `app-event` as its event
name, and the envelope as JSON data. The server emits comment heartbeats to keep
reverse proxies from closing an otherwise idle connection. Heartbeats do not
cause React renders or data queries.

The stream sends a `stream-ready` event after connection containing:

- protocol version;
- server generation identifier;
- current sequence;
- accepted topics.

Event payloads have a strict maximum serialized size. Large records are never
placed directly on the stream.

## Push Versus Invalidation

Events use one of two deliberate data strategies.

### Compact direct updates

Small, complete state that can safely replace a query-cache fragment is sent in
the event:

- a changed Systems live row;
- a changed Agent fleet-status row;
- notification counts;
- update status;
- demo-session status.

The Systems event contains only the dynamic row fields needed by the table. It
does not repeat static inventory identity, null fields for unrelated hosts, or
the Agent update command. The initial Systems snapshot remains the source of
static fields and commands.

### Targeted invalidation

Larger or independently paginated resources use an invalidation event:

- selected-host 30-minute telemetry;
- Agent hardware snapshot and suggestions;
- notification incident pages;
- full notification configuration.

The client invalidates and reloads these queries only when their consumer is
currently enabled. Multiple events for the same resource in a short interval
are coalesced into one refresh. There is no repeating timer.

## Systems Payload

The initial Systems REST snapshot remains a full renderable table. SSE then
delivers only changed dynamic host projections. A host update identifies the
host with `itemType` and numeric `itemId` and may contain:

- Agent state;
- Agent version and update-available state;
- CPU percentage;
- memory percentage;
- boot-storage percentage;
- uptime;
- attention count, state, and revision.

Absent fields mean unchanged. Explicit `null` clears a prior value. The payload
must therefore distinguish omission from null.

The 23-system production-shaped fixture must keep a complete active Systems
update under 1.5 KB when only the four registered Agent hosts require state.
Normal heartbeat events should be smaller because they carry one changed host.

The UI renders percentage text before each available bar. Values are rounded,
clamped to `0..100`, and formatted with a two-digit minimum width. The text and
bar occupy stable dimensions so updates do not move table columns.

## Agent State Transitions Without Browser Polling

Agent online state is partly time-derived. If an Agent stops sending data, no
new heartbeat exists to announce that it became stale or offline. The server
must own this transition.

Add an Agent lifecycle scheduler that:

1. rebuilds deadlines from persisted active devices at startup;
2. arms one timer for the nearest pending state transition;
3. replaces that host's deadlines after each committed heartbeat;
4. emits `online`, `stale`, and `offline` changes only when the computed state
   actually changes;
5. rearms itself for the next deadline;
6. is deterministic across restart and clock movement.

This is event scheduling, not polling. It avoids one timer per host and does not
scan all hosts at a fixed interval.

A heartbeat is published only after telemetry and Agent status persistence
succeed. Failed or rejected heartbeats emit nothing.

## Producer Integration

### Agents

Publish after:

- enrollment activation;
- committed heartbeat and telemetry write;
- registration unlink/revocation;
- hardware snapshot commit;
- scheduled stale/offline transition;
- embedded Agent release change.

One heartbeat can notify multiple subscribed projections without duplicating
the persistence read. Systems, fleet status, and selected-host telemetry derive
from the same committed host event.

### Notifications

Publish summary changes after incident opening, acknowledgement, recovery,
reminder transitions, and delivery exhaustion changes. Publish configuration
changes after the configuration write commits. Full configuration remains a
lazy REST resource and is not placed on the summary event.

Notification Center reloads incident pages only while open. The Canvas summary
control receives only the small count payload and does not cause a full
notification configuration request.

### Update status

The existing server update scheduler remains responsible for checking the
configured release channel. When the persisted result changes, it publishes the
new public update status. The browser no longer schedules `/api/update-status`
requests. A manual **Check for updates** command remains a REST mutation and its
response updates the local cache immediately.

### Demo session

The initial bootstrap provides `expiresAt`. The browser derives its visible
countdown locally. Extend and expire operations publish session events so other
open tabs converge. Server cleanup and expiration publish the terminal state.
The browser no longer reloads `/api/demo/session` every minute.

## Initial Load, Ordering, And Recovery

REST remains the authoritative snapshot interface. SSE carries changes after a
snapshot and wakes active consumers.

On initial application startup and every EventSource reconnect:

1. the server accepts and authorizes the topic set;
2. the server sends `stream-ready`;
3. the client conditionally refreshes active authoritative snapshots;
4. events arriving during refresh are queued by sequence;
5. the client applies queued events newer than the snapshot boundary;
6. normal event application resumes.

The in-memory event bus does not promise replay across process restart. A
changed server generation or a sequence gap triggers the same bounded resync.
No event may be treated as durable state.

React Query remains the client cache and request deduplication layer. Event
handlers use typed cache-update functions rather than component-specific event
listeners.

Event-managed queries disable interval, focus, mount, and generic browser
reconnect revalidation. Their only automatic refresh path is the explicit SSE
ready/gap resynchronization. User commands and successful mutations may still
update or invalidate the affected cache deliberately.

## Connection Failure Behavior

- EventSource reconnects automatically using the server-provided retry delay.
- The UI keeps the last authoritative values during a short disconnection.
- Time-sensitive Agent state must not remain falsely green. When disconnected,
  the client can derive visual staleness from the last persisted `lastSeenAt`
  and known heartbeat thresholds, but it must not invent a successful sample.
- Reconnect always performs one conditional resync of active resources.
- Repeated reconnects must not create duplicate EventSource instances, query
  refresh loops, or duplicate event application.
- A stream-capacity rejection presents a passive degraded-live-state indicator;
  it does not fall back to interval polling.
- Manual refresh remains available for recovery.

## Authorization And Security

- The stream is a same-origin authenticated GET and uses the existing session
  cookie. No access token or secret is placed in the URL.
- Every topic is parsed and normalized server-side with bounded topic count and
  URL length.
- Topic subscription requires the same permission and project access as its
  corresponding REST endpoint.
- Unauthorized topics reject the stream request rather than being silently
  accepted.
- Events are filtered to the connected installation, account, project, and host
  scope.
- A role, account, or project-access change closes affected streams so the
  client must reconnect under current authorization.
- Event payloads never contain notification secrets, Agent private identity,
  enrollment tokens, serial numbers, or registry credentials.
- SSE responses use `no-cache`, `no-transform`, `X-Accel-Buffering: no`, and
  connection limits equivalent to or stricter than the engine SSE hub.

## API Compatibility

Existing snapshot endpoints remain supported:

- manual refresh and diagnostics;
- initial loads;
- reconnect resynchronization;
- older clients during the transition release.

Their periodic callers are removed. After the application release has proven
stable, redundant specialized live endpoints may be deprecated separately;
they are not deleted as part of the first SSE rollout.

The event protocol is versioned independently from the registry and Agent
contracts.

## Migration Sequence

Implement in slices while preserving a working fallback during development:

1. Add and test the event bus, SSE adapter, authorization, connection limits,
   resync protocol, and client provider.
2. Migrate Systems and Agent fleet state, including the server-side lifecycle
   scheduler.
3. Migrate selected-host telemetry and hardware evidence.
4. Migrate notification summary, configuration invalidation, and incidents.
5. Migrate update status and demo-session state.
6. Remove every browser `refetchInterval` covered by this specification.
7. Disable implicit focus, mount, and network-reconnect refetch behavior for
   event-managed queries.
8. Add a static regression test that fails when a new periodic server query is
   introduced without an explicit allowlist and justification.
9. Verify the browser network panel remains free of repeating application API
   requests during idle use.

No database schema migration is required solely for SSE. Existing persisted
timestamps, sequences, incidents, telemetry, and update metadata remain the
source of truth.

## Testing And Acceptance

### Server

- event bus preserves order and isolates subscriber failures;
- topic parser rejects unknown, malformed, excessive, and unauthorized topics;
- stream connection and per-installation limits are enforced;
- heartbeat comments keep idle streams alive without application events;
- disconnect cleanup releases every subscription;
- committed Agent heartbeat emits the expected host events once;
- rejected heartbeat emits no event;
- lifecycle scheduler emits stale and offline transitions at the correct
  deadlines without fixed-interval scans;
- notification, update, hardware, and demo producers emit only after commit;
- process restart changes generation and forces resynchronization.

### Client

- one application EventSource exists for the normalized active topic set;
- hidden documents close it and visible documents reconnect once;
- changing visible surfaces replaces rather than duplicates the stream;
- `stream-ready`, generation changes, and sequence gaps trigger one bounded
  resync;
- repeated events are idempotent;
- Systems host deltas preserve unrelated rows;
- omitted fields remain unchanged and explicit nulls clear values;
- telemetry and hardware refresh only for the selected visible host;
- Notification Center refreshes incidents only while open;
- Systems makes no notification request when the notification control is not
  present;
- no migrated query retains `refetchInterval`;
- focus, mount, and browser reconnect do not independently refetch
  event-managed queries;
- no interval polling fallback starts after SSE failure;
- utilization labels render `03%`, `15%`, `99%`, and `100%` without layout
  shift.

### End-to-end

- a live Agent heartbeat updates Systems and an open Agent inspector without a
  timed browser request;
- stopping an Agent changes online to stale to offline without a browser poll;
- a new hardware scan appears while its inspector is open;
- notification counts change without transferring full configuration;
- an open Notification Center updates after an incident transition;
- a server update check changes the visible update state;
- demo extension in one tab updates another tab;
- disconnecting and restoring the network yields one resync and current state;
- an idle visible application shows only SSE traffic and no repeating API GETs;
- a hidden application performs no application live traffic;
- production reverse proxy does not buffer SSE frames.

## Documentation And Release Notes

This is user-visible performance and reliability work. Update:

- the structured unreleased release-note draft;
- `CHANGELOG.md` under `Unreleased`;
- architecture documentation describing outbound Agent heartbeats and browser
  SSE separately;
- operational documentation for reverse-proxy buffering, connection lifetime,
  and stream capacity.

No version is bumped until a deployment is explicitly requested.
