# Domain Persistence Boundaries Design

**Date:** 2026-08-19

## Objective

Prevent non-topology changes from rebuilding the Rust/WASM workspace engine or
recalculating cable routes. Preserve one application-wide Undo/Redo experience
while giving each persisted domain its own revision, API, invalidation event,
and restore operation.

The first visible workflow is debounced custom metadata and tag autosave, but
the change must correct the underlying persistence architecture rather than
special-case that form.

## Current Problem

`projects.revision` currently represents several unrelated concerns:

- engine topology;
- inventory definitions and presentation;
- project and workspace presentation;
- compatibility preferences;
- custom metadata and tags.

Several endpoints write a non-topology change through `setProject` or
`commitCanonicalMutationAcrossProjects`. That increments the engine revision,
emits `canonical-invalidated`, rebuilds the WASM worker, replaces broad project
collections, clears transient selection state, and causes cable-routing work.

Custom metadata is not present in `createEngineSnapshot`, so its current engine
revision bump is invalid. Compatibility policy and most presentation state are
also absent from the engine snapshot. Inventory `properties` are mixed: some
are presentation-only while orientation and row-order values affect measured
canvas geometry but still do not affect the engine topology snapshot.

## Domain Model

Every mutation belongs to one or more explicit effect domains:

| Domain | Owns | May rebuild WASM | May reroute cables |
| --- | --- | --- | --- |
| `topology` | Inventory existence/archival, ports, power topology, assignments, connections, placements, route intent | Yes | Only when measured routing dependencies change |
| `geometry` | Card orientation, endpoint row order, dimensions, and measured endpoint positions | No | Yes, affected connections only |
| `compatibility` | Host policy, verified limits, ignored findings, and derived findings | No | No |
| `inventory` | Descriptive item fields and non-topological properties | No unless the topology projection also changes | Only when the geometry projection changes |
| `metadata` | Custom-field values, tag assignments, field definitions, and tag definitions | No | No |
| `workbook` | Project name/description/icon, workspace collection/order/default, workspace name/icon/color | No | No |
| `workspace-preferences` | Viewport and Canvas/UI settings | No | Only settings whose documented behavior changes routing |
| `operational` | Agent, telemetry, notifications, Registry enrollment, backups, authentication, saved Systems views | No | No |

The server, not the browser, determines mutation effects. A browser request may
not claim that a mutation is topology-free.

## Revision Ownership

Core schema 28 establishes the following revision rules:

1. `projects.revision` becomes the topology revision and is the only project
   revision consumed by the Rust/WASM engine protocol.
2. `projects.workbook_revision` tracks project presentation, workspace
   collection/order, and default-workspace changes.
3. `workspaces.revision` continues to track per-workspace metadata and
   configuration.
4. `inventory_items.row_version` tracks inventory definition and property
   changes independently of project topology.
5. `project_compatibility_policies.revision` tracks policy changes.
6. Existing custom-field, option, value, and tag row revisions remain their
   concurrency controls. Item metadata replacement receives a dedicated
   `inventory_item_metadata_revisions` row keyed by numeric inventory item ID.
7. Operational stores retain their existing independent revisions.

Migration 0028 must be automatic, transactional, idempotent, covered by the
standard pre-migration backup, and rollback-capable. It initializes
`workbook_revision` from the existing project revision, initializes policy and
item-metadata revisions to 1, and leaves `projects.revision` unchanged. No
assignment, placement, connection, route-cache row, private field, Registry
link, inventory identity, or project membership may change.

## Mutation Effect Projection

Introduce one server-side effect projector that compares normalized before and
after projections and returns:

```ts
type MutationEffects = {
  topology: boolean
  geometry: {
    projectIds: number[]
    workspaceIds: number[]
    itemIds: number[]
    connectionIds: number[]
  } | null
  compatibility: {
    projectIds: number[]
    hostItemIds: number[]
  } | null
  presentation: {
    projectIds: number[]
    itemIds: number[]
  } | null
}
```

The topology comparison uses a dedicated topology projector derived from
`createEngineSnapshot` while excluding revision and project name. It must not
use whole-object equality. A topology revision advances only when this
projection changes or when assignments, connections, placements, or explicit
route intent change.

The geometry projector classifies fields that can change card dimensions or
endpoint positions. The browser receives a targeted geometry invalidation,
remeasures affected items, compares the resulting geometry fingerprint, and
requests routes only for connections whose routing dependencies changed.

Known property behavior is explicit:

- `displayName`: inventory presentation only;
- `canvasOrientation`: geometry;
- `patchPanelRowOrder`: geometry;
- `upsOutletGroupOrder`: geometry;
- unknown property keys: inventory presentation plus compatibility
  invalidation, but no topology revision unless the topology projector proves
  otherwise.

Catalog updates use the same projector. Downloading or refreshing a catalog is
operational only. Applying a template advances topology only when the final
merged item changes the topology projection.

## Persistence APIs And Events

Broad project replacement remains available only for backup restore,
migration, and explicit whole-project recovery. Interactive UI actions must use
domain-specific endpoints.

Add or complete dedicated commands for:

- inventory metadata replacement and history restore;
- project compatibility policy changes;
- project presentation changes;
- workspace presentation/order/default changes;
- inventory item property changes;
- inventory definition changes with server-computed effects.

Mutation responses use a shared envelope:

```ts
type DomainMutationResult<T> = {
  data: T
  revisions: {
    topology?: number
    workbook?: number
    workspace?: number
    inventoryItem?: number
    compatibility?: number
    metadata?: number
  }
  effects: MutationEffects
}
```

SSE topics remain domain-specific:

- `topology:<projectId>:<workspaceId>`;
- `geometry:<projectId>:<workspaceId>`;
- `compatibility:<projectId>`;
- `inventory:<projectId>`;
- `inventory-metadata:<projectId>`;
- `workbook:<projectId>`;
- existing operational topics.

`canonical-invalidated` is emitted only for topology revisions. A metadata,
policy, workbook, or presentation event must never transition the engine out
of `ready`.

## Frontend Persistence Coordinator

Replace the assumption that every saved `ProjectState` requires engine
synchronization with an effect-aware persistence coordinator.

The coordinator:

1. serializes writes within each domain;
2. allows independent domains to complete without waiting on WASM;
3. updates TanStack Query caches using the returned domain data;
4. calls `synchronizeCanonicalRevision` only when `effects.topology` is true;
5. performs targeted geometry remeasurement only when `effects.geometry` is
   present;
6. refreshes compatibility and metadata projections through their SSE topics;
7. preserves item and connection selection unless the selected record was
   removed;
8. does not clear network traces unless their topology changed.

Engine startup/readiness transitions alone must not request cable routes. A
route request requires a changed routing-dependency fingerprint.

## Metadata Autosave

The Inspector metadata editor has no Save or Reset footer.

- Changes autosave after 500 ms of inactivity.
- Changes within one debounce window coalesce into one transaction and one
  Undo entry.
- Saves are serialized. If values change during an in-flight save, only the
  newest pending state is sent next.
- Closing the Inspector, switching items, or leaving the metadata tab flushes
  a valid pending change before teardown.
- A compact status reports `Saving`, `Saved`, or the error with a Retry action.
- A failed save retains the edited values and never records history.
- Applying the exact already-saved value is a no-op.

Metadata persistence refreshes metadata and Systems projections only. It must
not change any topology, workbook, workspace, assignment, placement,
connection, route-cache, or Registry-link revision.

## Global Undo And Redo

Undo/Redo remains application-wide. Replace whole-project-only history entries
with typed domain commands:

```ts
type HistoryCommand = {
  domain: 'topology' | 'geometry' | 'compatibility' | 'inventory' | 'metadata' | 'workbook' | 'workspace-preferences'
  label: string
  undo: DomainMutation
  redo: DomainMutation
}
```

Each user action creates one history command after persistence succeeds.
Debounced metadata edits create one command per debounce window. Undo and redo
call the domain restore endpoint and process its effects through the same
coordinator. Metadata, compatibility, and presentation history never rebuild
WASM or reroute. Geometry history reroutes only affected connections. Topology
history follows normal engine synchronization.

Undo/Redo failures retain the current history pointer and expose a recoverable
error. Concurrent revision conflicts fail closed rather than overwriting newer
state.

## Error Handling And Recovery

- Every domain mutation uses optimistic concurrency with its owning revision.
- The server transaction commits data and its domain revision together.
- SSE publication occurs only after commit.
- A failed or conflicting non-topology mutation cannot advance the topology
  revision.
- If topology synchronization fails after a committed topology mutation, the
  existing canonical reload/rebuild recovery remains available.
- Geometry measurement or routing failure preserves the persisted user change
  and the last valid route cache; it reports the routing error without
  inventing an impossible route.
- Restart reconstructs every revision from SQLite and must not emit synthetic
  invalidations.

## Required Verification

### Migration and persistence

- Upgrade an existing schema-27 database to schema 28 automatically.
- Verify restart idempotency and migration rollback recovery.
- Verify exact preservation of inventory IDs, memberships, assignments,
  resource/slot IDs, placements, connections, route cache, private fields,
  Registry links, authentication, agents, telemetry, notifications, and saved
  views.
- Verify unsupported newer schemas fail explicitly.

### Domain isolation

For each mutation below, assert expected revision/event behavior:

- metadata values and tags;
- metadata Undo/Redo;
- compatibility enable/disable;
- verified-memory policy;
- ignore/unignore and clear ignored warnings;
- project name/description/icon;
- workspace name/icon/color/order/default;
- viewport and non-routing Canvas preferences;
- item display name and descriptive fields;
- power-equipment orientation;
- patch-panel row order;
- UPS outlet-group order;
- item ports and power topology;
- assignment, placement, connection, route-side, and bend changes;
- catalog refresh and catalog update application.

Non-topology tests must prove the engine phase and revision remain unchanged.
Non-geometry tests must prove no route planner request occurs. Geometry tests
must prove only affected connections are reconsidered.

### Local end-to-end verification

Use the isolated staging application at `http://127.0.0.1:7899/` and its copied
dataset. Do not modify the user's production data.

Exercise every migrated workflow through the browser:

1. edit tags and every supported custom-field type;
2. verify 500 ms autosave, status, retry behavior, coalescing, flush on close,
   and no Save button;
3. Undo and Redo metadata changes;
4. toggle each compatibility policy and ignore state;
5. edit project and workspace presentation and ordering;
6. edit display-only item properties;
7. rotate UPS/power-strip equipment and swap patch-panel/UPS endpoint order;
8. edit a descriptive hardware field that does not alter topology;
9. perform a true port/topology edit, assignment change, placement move,
   connection change, and bend reset;
10. refresh the catalog and apply a controlled linked-template update;
11. reload and restart the container;
12. verify browser console, network requests, SSE events, engine activity, and
    cable-routing activity for each case.

Before completion run:

```bash
bun run lint
bun run test
bun run build
bun run security:container
```

The local container must remain healthy, and all changed workflows must be
verified at desktop and mobile viewport sizes where they are available.

## Documentation And Release Notes

Update the structured unreleased release-note draft and `CHANGELOG.md`. Do not
bump the application version or publish a release until explicitly requested.

## Non-Goals

- Changing the Rust routing algorithm.
- Replacing SSE with WebSockets.
- Changing Registry protocol or catalog contract versions.
- Adding required custom fields.
- Deploying to production or modifying the live dataset.
