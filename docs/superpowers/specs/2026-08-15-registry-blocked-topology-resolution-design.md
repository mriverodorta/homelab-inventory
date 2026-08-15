# Registry Blocked Topology Resolution

## Objective

Finish the blocked Registry-update workflow so supported topology changes are
understandable and can be resolved safely from the Registry updates dialog.

This design is a focused amendment to
`2026-08-15-registry-update-semantic-reconciliation-design.md`. It closes the
implementation gaps exposed by the Synology DS620slim revision 2 update:

- detailed changes render only `Current` and `Proposed` because the API returns
  `path` while the component reads `field`;
- the application hides the resolver's specific failure reason behind a generic
  message;
- a fixed external-adapter NAS is evaluated before its generated host-owned AC
  input is materialized;
- a resource key rename with the same numeric resource ID is treated as removal,
  which would return assigned storage to inventory;
- no **Resolve and apply** action is available even though the topology can be
  migrated deterministically.

The solution must be generic. It must not special-case Synology, a NAS model, or
the `drive-bays` and `sata-bays` key values.

## Invariants

- Positive numeric IDs are persisted relationship identity.
- Semantic keys describe meaning and may be renamed without replacing the
  resource when the numeric ID remains stable.
- Assignment IDs, assigned inventory IDs, slot positions, placements, and
  unaffected cable IDs remain unchanged.
- Previewing a resolution never mutates data.
- Resolving a topology update is explicit, confirmed, atomic, and rollback-safe.
- A blocked update never silently detaches hardware, deletes a cable, or claims
  that an impossible route or relationship is valid.
- Automatic safe Registry updates never execute topology-resolution operations.
- Unknown fields from supported Registry contracts survive canonicalization and
  persistence.

## Canonical Planning Input

Registry comparison, validation, and resolution must consume the same fully
materialized target definition that persistence would write.

Before diffing or planning, the incoming definition passes through the canonical
inventory materializer for its type. This includes:

- generated fixed components;
- normalized resource groups;
- canonical ports;
- generated host-owned power inputs;
- fixed, internal, and replaceable power disposition;
- supported unknown Registry fields.

The topology resolver must not independently infer a partial target from raw
catalog JSON. In particular, a fixed external-adapter NAS receives its canonical
NAS-owned `ac-input` before power-adapter resolution is evaluated.

The exact canonical target produced for preview is retained in the resolution
plan and revalidated immediately before commit. Preview and persistence cannot
use different materialization paths.

## Resource Identity And Semantic-Key Remapping

### Stable numeric ID

When a current and proposed resource group share the same resource type and
positive numeric ID, they are the same relationship resource even if their
semantic keys differ. Numeric IDs may overlap between different resource types;
for example, storage resource 1 and expansion resource 1 are distinct.

The planner emits an explicit remap operation:

```json
{
  "kind": "remap-resource-key",
  "resourceId": 1,
  "fromKey": "drive-bays",
  "toKey": "sata-bays",
  "assignmentIds": [14, 15, 16, 17, 18]
}
```

The operation preserves each assignment ID and slot position. Persistence
reattaches the existing assignment rows to the proposed semantic key represented
by the same numeric resource ID.

### Validation

A stable-ID remap is deterministic only when:

- the proposed resource contains every occupied slot;
- each assigned item remains representable by the proposed resource;
- no second resource of the same type claims the same numeric ID;
- the proposed resource type can carry the current assignment category;
- the final project passes relational and compatibility validation.

A changed numeric ID may be remapped only when one unique semantic relationship
proves the target. Ambiguous ID changes remain blocked and expose the exact
manual correction required.

### Persistence

The inventory replacement/import path accepts explicit resource-key remaps from
the validated plan. It does not infer them from names, labels, array positions,
or product-specific aliases.

The executor preserves assignment rows where the schema permits an in-place
foreign-key update. If replacement requires rebuilding dependent rows, it must
restore the same assignment IDs, component references, and slot positions inside
the same transaction and verify them before commit.

## Power Topology Resolution

The generic power resolver compares current and proposed endpoint ownership and
adapter disposition after canonical materialization.

For a replaceable external adapter becoming fixed host hardware, the plan:

1. Adds or confirms the host-owned canonical AC input.
2. Moves each affected power connection from the assigned adapter endpoint to
   the host-owned endpoint.
3. Removes the adapter assignment.
4. Returns the standalone adapter item to inventory without deleting it.
5. Preserves the connection ID and cable metadata.
6. Invalidates only route-cache entries for connections whose endpoints moved.

The operation is unavailable when the source endpoint is ambiguous, multiple
candidate target endpoints exist, or the resulting cable endpoint fails
validation. The API returns that exact reason rather than a generic failure.

For the captured DS620slim case, connection 65 moves from the assigned Synology
65W adapter's AC input to the NAS-owned AC input, assignment 95 is removed, and
the adapter remains as an unassigned inventory item.

## Change Contract

Detailed and summarized Registry changes use one canonical record:

```ts
type CatalogFieldChange = {
  path: string
  kind: 'added' | 'removed' | 'changed'
  impact: 'metadata' | 'compatibility' | 'assignment' | 'cable' | 'topology'
  current?: unknown
  next?: unknown
}
```

The API normalizes historical records containing `field` to `path` before they
reach the client. The client does not maintain two competing change contracts.

Change paths are nested and precise. A compatibility object is decomposed into
meaningful field-level changes instead of being rendered as one opaque object
whenever the semantic differ can identify its children.

## Resolution Contract

Group detail returns the exact blocked reasons and a resolution object:

```ts
type CatalogResolution = {
  available: boolean
  reasonCode?: string
  reason?: string
  operations: CatalogResolutionOperation[]
  affectedRelationships: {
    assignmentIds: number[]
    connectionIds: number[]
    inventoryItems: Array<{ itemType: string; itemId: number }>
    projectIds: number[]
  }
  concurrencyToken: string
}
```

When `available` is false, `reasonCode` and `reason` are mandatory. The frontend
must not replace them with a generic dead end. When manual action is possible,
the reason names the relationship or field that must be corrected.

When `available` is true, every operation shown in the preview is the operation
the server will execute. The UI never fabricates a resolution summary from the
raw field diff.

## Dialog Behavior

Each change displays:

- a human-readable label;
- the exact machine path;
- current and proposed values;
- an impact badge.

Examples:

```text
Storage slot key
compatibility.host.storageSlots[0].key
Current: drive-bays
Proposed: sata-bays
Impact: Assignment
```

Blocked cards contain a **Why this is blocked** section with the exact backend
reason. When a deterministic plan exists, they also contain **What resolve and
apply will do**, listing preserved assignments, moved connections, returned
inventory items, and other topology effects.

**Resolve and apply** is the primary action for resolvable blocked groups.
**Decline revision** remains secondary and visually destructive. Only the action
submitted by the user displays a loading state.

After a successful resolution:

- the group moves to Applied rather than disappearing from the dialog;
- unresolved toolbar and tab counts update from the authoritative response;
- the detail cache for that group is invalidated;
- affected canvas/workspace projections refresh only when topology changed;
- unrelated groups remain mounted and unchanged.

If the group changes after preview, the API returns a refresh-required conflict,
the dialog retains the group, and the user sees that the resolution plan changed.

## Atomic Execution

Immediately before applying, the server validates:

- target catalog revision and content hash;
- Registry link membership;
- group concurrency token;
- current inventory and project revisions;
- assignment IDs and slot positions;
- connection IDs and endpoint ownership;
- canonical target topology;
- deterministic resolution operations.

The server then executes the operations and Registry definition replacement in
one SQLite transaction. Final relational validation, compatibility validation,
and project validation run before commit. Any failure rolls back the inventory
record, link revision, assignments, cables, adapter state, and route-cache
invalidation together.

The decision receipt may report `applied` only after the linked inventory record
and Registry link prove the target revision and content hash were committed.

## DS620slim Acceptance Case

The revision 2 update must produce one deterministic preview that states:

- SSD assignment IDs 14 through 18 remain assigned to resource ID 1 in their
  existing slots while its key changes from `drive-bays` to `sata-bays`;
- connection 65 moves to the canonical NAS-owned AC input;
- adapter assignment 95 is removed;
- the Synology 65W adapter remains in inventory as unassigned;
- network connections 32 and 33 remain attached to numeric port IDs 1 and 2;
- fixed CPU, memory policy, dimensions, aliases, normalized ports, and fixed
  power topology are applied;
- unaffected placements, connections, manual bends, and route-cache entries are
  unchanged.

The dialog must show meaningful labels and paths for every change and expose
**Resolve and apply**. After confirmation, the group appears in Applied and no
longer contributes to the unresolved count.

## Test Coverage

### Canonical planning

- fixed external-adapter NAS receives a host-owned AC input before resolution;
- preview and persistence use byte-equivalent canonical target definitions;
- unknown supported Registry fields survive the round trip.

### Resource relationships

- same numeric resource ID with a new semantic key preserves assignment IDs and
  slot positions;
- decreased slot count below occupied positions remains blocked;
- incompatible assigned component remains blocked with its exact reason;
- duplicate or ambiguous numeric resource IDs fail explicitly;
- changed numeric IDs require one unique target mapping.

### Power relationships

- adapter-owned endpoint migrates to a fixed host-owned endpoint;
- connection ID and cable metadata remain unchanged;
- obsolete adapter is returned to inventory;
- ambiguous source or target endpoints remain blocked;
- only the moved connection's route cache is invalidated.

### API and UI

- historical `field` changes are projected as canonical `path` records;
- detailed changes always display labels and exact paths;
- backend resolution reasons remain visible;
- operation preview matches the server plan;
- **Resolve and apply** appears only for deterministic plans;
- only the submitted action displays progress;
- success moves the group to Applied and updates counts immediately;
- stale concurrency returns a retained, refreshable conflict state.

### Transactions

- stale project, assignment, connection, catalog, and link state aborts before
  mutation;
- failure at every operation boundary rolls back all related changes;
- multi-item and multi-project groups remain atomic;
- restart preserves the applied revision and does not repeat the resolution.

## Release Documentation

Implementation is a user-visible Registry update fix. It updates the Unreleased
changelog and structured release-note draft. It does not bump the application
version or create a release tag until a deployment is explicitly requested.
