# Independent Canvas Topology And Project Inventory Design

Date: 2026-08-25

Status: Approved design, pending written-specification review.

## Problem

Canvas workspaces currently own placements, manual cable bends, visibility, and
route caches. Component assignments and cable connections instead belong to the
entire project. Adding an existing host to a second canvas consequently displays
the first canvas's components. Returning that host to inventory releases its
project-wide assignments and connections, damaging every other canvas.

A production incident confirmed the defect: returning a Dell OptiPlex Micro
7090 from a secondary canvas removed six component assignments and its cable
connections from the original canvas. The original placement remained, leaving
an unexpectedly empty host.

The legacy-to-SQLite importer also defaults existing items to `global`, despite
the approved migration contract requiring project-bound items. Production
contained 175 incorrectly global items and only five project-bound items.

These are separate defects with one coordinated solution: projects own an
inventory library, while each canvas owns an independent configuration scenario.

## Goals

- Isolate host placements, removable-component assignments, resource-slot
  occupancy, cables, port occupancy, compatibility findings, and routing per
  canvas workspace.
- Allow the same canonical physical item and port to participate independently
  in multiple canvases within the same project.
- Preserve canonical inventory identity, Registry links, agents, telemetry,
  metadata, tags, custom fields, and private fields.
- Default new inventory items to project-bound ownership.
- Repair incorrectly global single-project inventory automatically.
- Preserve each existing canvas's currently visible configuration through an
  automatic, verified, rollback-capable startup migration.
- Add stable inventory-ID visibility, copying, and sidebar lookup.
- Support copying a host configuration between canvases, with optional eligible
  cable copying.
- Add a canvas filter to Systems while preserving its default all-host behavior.
- Preserve selected-canvas isolation in LabGD sharing, backups, compatibility
  evaluation, undo/redo, and SSE invalidation.

## Non-Goals

- Adding a new inventory type, cloning physical inventory records, or creating
  hidden projects per canvas.
- Duplicating Registry links, agent enrollments, agent telemetry, canonical
  metadata, or physical inventory properties.
- Implementing rack, VLAN, or other future workspace types.
- Introducing per-canvas copies of manufacturer, model, serial number, canonical
  name, tags, custom fields, or agent identity.
- Introducing polling, automatic cross-canvas synchronization, or a LabGD
  service-side protocol change.

## Ownership Model

### Canonical Inventory

`inventory_items.id` remains the stable, globally unique relational identity of
one physical item. The inventory record continues to own:

- Physical class and item type.
- Name, manufacturer, model, family, serial number, and private attributes.
- Registry link, catalog provenance, and canonical compatibility definition.
- Physical ports, endpoint faces, host resource groups, and resource slots.
- Agent enrollment, agent identity, hardware snapshots, and telemetry.
- Installation-defined tags and custom fields.

A project-bound item has `scope = 'project'` and an owning project ID. A global
item has `scope = 'global'`, no owning project, and explicit memberships in any
project where it is available.

Changing a physical inventory property updates the same canonical item across
every project and canvas where it appears. Topology changes do not alter the
canonical inventory record.

### Project Inventory

Projects retain their inventory memberships, explicit global-library policy,
user-visible metadata, Systems workspace, and ordered canvas workspaces.

New inventory created from manual entry, Registry catalog import, duplication,
onboarding, backup restoration, or supported legacy import must default to the
active project's ownership unless the caller explicitly requests global scope.
Global sharing is an intentional user action, never a creation or migration
default.

A physical inventory item can belong to many projects only when explicitly
global. Scope changes continue to preserve canonical numeric IDs and existing
relational references.

### Canvas Configuration

Every canvas independently owns:

- Placements, orientation, z-order, viewport, and canvas settings.
- Component assignments and assignment-slot relationships.
- Occupancy of host resource slots.
- Cable connections, endpoints, endpoint sides, and occupied physical ports.
- Cable visibility, manual bend points, and route caches.
- Compatibility audits, dirty-host queues, findings, and ignored findings.
- Canvas-specific host attention projections derived from those findings.

Within one canvas, a component can be installed only once, a host resource slot
cannot be overallocated, and a port endpoint cannot connect to multiple cables.
The same component, slot, and endpoint may be used independently in another
canvas.

The inventory sidebar shows project-visible items and computes availability only
within the active canvas. A component installed on another canvas remains
available on the current canvas.

## Relational Schema

Maintain existing numeric primary keys. Relationships must use positive safe
integer IDs; semantic keys remain descriptive and are never persisted as foreign
keys.

### Component Assignments

Add a non-null `workspace_id` to `component_assignments` and
`component_assignment_slots`.

`component_assignments` must reference its owning canvas using the existing
composite project/workspace relationship. Its host and component continue to
reference canonical inventory items. Its resource slot continues to reference
the canonical slot belonging to that host.

Replace project-wide uniqueness with:

```text
UNIQUE (workspace_id, component_item_id)
UNIQUE (workspace_id, resource_slot_id) WHERE resource_slot_id IS NOT NULL
UNIQUE (project_id, workspace_id, id)
```

Assignment-slot relationships must reference the matching assignment through a
composite foreign key containing project and workspace identity. Their occupied
resource-slot uniqueness becomes workspace-specific.

Preserve the established assignment record ID on the primary migrated canvas.
Allocate fresh positive IDs only for additional canvas-local copies.

Fixed components remain stored once in their host's existing canonical
fixed-component definitions. Each canvas independently projects or materializes
those definitions as locked, nonremovable host configuration when the host is
present. Do not duplicate the canonical fixed-component record, invent a
removable inventory item, or create an ordinary component assignment merely to
render soldered hardware. Every placement of such a host includes its fixed
hardware automatically; fixed components cannot be detached, swapped, copied
independently, or consumed as ordinary available inventory.

### Cable Connections And Endpoints

Retain the existing `project_connections` table name to avoid unnecessary
adapter and migration churn, but add non-null `workspace_id` and enforce
composite ownership by the same project/canvas pair.

Add the necessary project/workspace ownership to `connection_endpoints`, with a
composite foreign key to its owning canvas connection. Replace global physical
endpoint uniqueness with:

```text
UNIQUE (workspace_id, port_id, coalesce(endpoint_face_id, 0))
```

Creating, removing, validating, auditing, and resolving cable endpoints must
always include the active workspace ID. Two canvases may therefore use the same
physical port in different independent connection scenarios.

Existing connection-side values, labels, negotiated speeds, endpoint-face IDs,
and cable configuration remain unchanged.

### Existing Workspace Routing Tables

`workspace_placements`, `workspace_connection_visibility`,
`workspace_manual_bend_points`, and `workspace_route_cache` remain
workspace-owned. Their connection relationships must be tightened so their
referenced cable belongs to exactly the same project and workspace.

Existing route caches and bend points remain attached to the preserved original
connection ID on the primary canvas. Copied connections on secondary canvases
receive mapped visibility, bend points, and route caches under their new local
connection IDs when valid. Invalid caches are discarded and recalculated without
discarding actual connections or manual bends.

### Compatibility And Attention

Add canvas ownership to compatibility audits, findings, dirty-host queues, and
their relevant indexes. A finding and its assignment must reference the same
workspace. Existing ignore records remain attached to their corresponding
migrated finding.

Project-wide compatibility policy may remain shared, but evaluated host
findings, host suppression results, occupied-slot validation, and attention
projections must be canvas-specific. Systems attention queries select the
requested canvas or the project's default canvas for the all-host view.

An inventory or Registry change marks every canvas containing the affected host
or assigned component dirty. An assignment or cable change marks only its owning
canvas dirty.

### Revision Discipline

Project inventory creation, scope, membership, canonical host data, and workbook
changes retain the appropriate project/workbook revisions. Canvas assignments,
connections, placements, and canvas-specific compatibility changes advance only
the affected workspace revision and the required scoped projections.

Do not invalidate or reroute another canvas solely because the current canvas
changed. Do not route cables for metadata-only or purely inventory-property
updates unless topology or actual rendered geometry changed.

## Existing Installation Migration

Run as an ordered automatic startup migration before serving the application.

1. Acquire the existing migration lock.
2. Create and verify a complete pre-migration backup using the established
   application migration workflow.
3. Validate foreign keys, active projects, canvas ownership, existing
   assignments, physical slots, endpoints, connections, placements, routing
   records, and project memberships.
4. Determine each project's primary canvas from its configured default when it
   is a canvas, otherwise its earliest active canvas.
5. Preserve all existing assignment and connection IDs on that primary canvas.
   This includes legacy assignments or cables whose endpoints are not currently
   placed, preventing existing data from disappearing.
6. For every additional canvas, create an independent assignment copy for each
   host placed on that canvas. Copy matching assignment-slot allocations while
   preserving the same canonical component and canonical resource-slot IDs.
7. For every additional canvas, copy each currently visible project connection
   whose owning endpoint hosts are both represented on that canvas. When an
   endpoint belongs to an installed component, resolve its host through that
   canvas-local assignment before deciding eligibility.
8. Preserve canvas-specific visibility, manual bends, routing cache, side
   selection, and endpoint metadata under deterministic connection-ID mappings.
9. Migrate or rebuild compatibility and Systems attention projections for each
   affected canvas without losing explicit ignore choices.
10. Convert each existing global item with exactly one project membership to a
    project-bound item owned by that project. Preserve global items with zero or
    multiple memberships. Reject inconsistent project ownership rather than
    guessing.
11. Validate the resulting per-canvas counts, relationships, physical endpoint
    occupancy, canonical IDs, placement fingerprints, cable fingerprints,
    routing fingerprints, private fields, Registry links, agent bindings, and
    inventory metadata.
12. Commit atomically. Restore the verified pre-migration state if any stage
    fails.

Repeated startup must not duplicate assignments, connections, slots, findings,
or memberships. Migration ordering must preserve SQLite foreign-key enforcement,
WAL safety, existing backup semantics, and application startup availability.

New canvases created after migration start without placements or removable
component assignments. Dragging a host creates only its placement and any
required locked fixed-component configuration.

## Canvas Operations

### Place Host

Validate the item is visible in the active project. Create one workspace-local
placement. Derive required fixed components for that workspace only. Do not
import removable assignments or cables from another canvas implicitly.

### Assign Component

Validate project membership, canvas-local component availability, host resource
compatibility, canonical resource-slot ownership, slot occupancy, and fixed
hardware restrictions. Commit the assignment and its slots for the current
workspace only.

### Remove Component

Remove only the selected workspace's assignment, assignment-slot records, and
connections that specifically terminate on that component in the same
workspace. Preserve all other canvases. Reject removal of fixed hardware.

### Return Host To Inventory

Compute the impact exclusively from the active workspace:

- Remove that workspace's host placement.
- Release that workspace's removable component assignments.
- Remove only that workspace's host/component cable connections.
- Remove only matching route cache, visibility, bends, and local findings.
- Preserve canonical host and component inventory records.
- Preserve every placement, assignment, cable, finding, and route in every
  other workspace.

Show accurate local impact before confirmation and commit the complete operation
as one undoable transaction.

### Delete Or Archive Inventory

Actual inventory archive, deletion, scope conversion, project removal, and
permanent project deletion must inspect references across every relevant canvas
and project. The dependency preview must identify affected workspaces and refuse
unsafe or ambiguous destructive operations. No canvas may be changed silently.

### Delete Or Archive Canvas

Removing a canvas releases only its placements, assignments, assignment slots,
connections, endpoints, visibility, bends, route caches, compatibility findings,
and attention projections. It never removes canonical inventory, memberships,
Registry links, agent bindings, or another canvas's topology.

Retain the existing invariant that every project has at least one Canvas
workspace.

## Inventory IDs And Search

The inspector displays the stable canonical numeric inventory ID with an
accessible copy action. This is `inventory_items.id`, not an array position,
legacy category ID, template key, runtime adapter key, or database-internal
relation ID.

The current frontend `InventoryItem.id` remains the legacy category-scoped ID
used by existing runtime keys, engine references, URLs, and historical adapter
contracts. Add a separate backward-compatible `inventoryId` field containing
the canonical SQLite inventory ID. Inspector display, clipboard copying, exact
sidebar matching, configuration-copy previews, and relevant sharing source
queries use `inventoryId`; existing `id` and `type:id` behavior does not change.

The inventory sidebar accepts both:

```text
#28
28
```

Exact canonical numeric-ID matches take precedence over ordinary text search.
Existing name, model, manufacturer, and applicable filter behavior remains
unchanged. Copied IDs allow a user to intentionally reconstruct the same
physical component configuration in another canvas.

## Copy Configuration Between Canvases

A placed host's inspector exposes a configuration-copy action when the same
canonical host exists on another active canvas in the same project.

The dialog contains:

```text
Copy configuration from: [Source canvas]

[x] Installed components
[ ] Cable connections
```

Installed-component copying is enabled by default. Optional cable copying is
disabled by default.

Before mutation, calculate a deterministic preview:

- Match the same canonical host ID across source and destination.
- Preserve canonical component IDs and physical resource-slot IDs.
- Skip identical already-present destination assignments.
- Reject occupied destination slots, components already assigned to another
  destination host, incompatible resources, and fixed-component replacement.
- Include only source cables whose other endpoint host/component also exists
  on the destination canvas and whose destination endpoints remain available.
- Preserve cable labels, endpoint faces, sides, negotiated speeds, and routing
  configuration. Copy valid route data only when destination geometry matches;
  otherwise calculate a fresh destination route.
- Report unavailable connections instead of silently disconnecting existing
  destination cables.

Apply the approved eligible configuration in one workspace-local transaction,
one undo/redo history entry, and one scoped SSE invalidation.

## Systems Workspace

Add a dynamic canvas selector to the Systems filters:

```text
[All systems] [Canvas A] [Canvas B]
```

`All systems` is the default and preserves existing project-wide host visibility.
CPU, memory, storage, compatibility, and attention columns use the project's
default canvas configuration. Hosts not configured there remain visible with
empty configuration cells instead of borrowing another canvas's assignments.

Selecting a canvas limits rows to hosts placed on that canvas and uses only that
canvas's assignments, compatibility findings, attention counts, and connection
context. Canonical Registry state, tags, custom fields, agent version, agent
availability, and telemetry remain attached to the physical host.

Persist the selected canvas with the existing project/user/browser Systems view
preferences and include it in named saved views. When a selected canvas is
archived or unavailable, fall back to `All systems`.

The Systems snapshot and live projections must receive the canvas scope
explicitly, avoid per-host N+1 queries, and deliver updates through the existing
SSE architecture rather than polling.

## Registry Updates And Agent Suggestions

Registry updates continue to mutate canonical item definitions only. Before
applying a host resource or component compatibility change, evaluate every
canvas where that host or component appears.

Deterministic resource migrations must preserve each workspace's assignments,
slot IDs, cable endpoints, bends, routing, and locked fixed hardware. A conflict
in any workspace prevents automatic destructive application and produces the
existing explicit review/resolution workflow.

Agent enrollments, hardware snapshots, telemetry, host identity, and suggested
canonical field values remain installation/host-owned. When an agent suggestion
creates, removes, or changes a component assignment, the mutation applies only
to the explicitly selected canvas.

## LabGD Sharing

A selected Canvas share includes only:

- That canvas's placements and viewport.
- That canvas's configured host/component assignments.
- That canvas's visible cable connections, endpoint metadata, bends, and routes.
- Canonical inventory details and metadata explicitly permitted by the sharing
  configuration.

Another canvas's placements, components, cables, or compatibility state must
never enter the serialized share. Resource snapshots use the same selected
canvas to resolve storage identity. Systems sharing respects the selected
Systems canvas filter where that preference is part of the explicitly shared
view.

Existing share protocol versions, installation identity, claim state, account
linkage, signing, content-addressed blobs, and publication contracts remain
unchanged. Replaceable shares re-evaluate only when their selected workspace or
shared canonical inventory changes.

## SSE And Cache Invalidation

Preserve the existing application live-event connection. Add or extend validated
workspace-specific topics and revision payloads as needed so:

- Canvas A topology changes do not invalidate Canvas B route cache.
- Systems updates invalidate only views affected by the selected canvas or
  canonical physical item.
- Inventory metadata updates do not synchronize an unrelated WASM engine.
- Agent telemetry continues to refresh only physical-host projections.
- Sharing publication updates follow their existing authenticated SSE stream.

Any new topic must retain authorization checks, bounded subscription limits,
resume semantics, and project/workspace membership validation. Do not introduce
new HTTP polling endpoints.

## Backup, Restore, And Demo

Full and selective project backups include all canvas-specific topology and
preserve their numeric relational references. Restore validates project/canvas
ownership before activation and never collapses independent scenarios into one
project-wide assignment set.

Demo sessions receive the same schema and isolation semantics while preserving
all existing restrictions on enrollment, sharing credentials, Registry identity,
and installation persistence.

Rollback recovery restores the complete pre-migration database rather than
attempting lossy reconstruction from partial relationship tables.

## Security And Authorization

- Every workspace-scoped read and mutation verifies both project membership and
  workspace ownership.
- Cross-project and cross-workspace IDs fail closed.
- Configuration copy is permitted only between active canvases in the same
  project and requires the existing inventory/workspace edit permissions.
- Physical inventory IDs expose no additional private fields or credentials.
- Dependency previews, LabGD payloads, logs, and SSE events never reveal
  unauthorized project data.
- Existing account roles, invitations, OIDC/local authentication, demo
  restrictions, and sharing permissions remain unchanged.

## Failure Handling

- Invalid migration relationships, duplicate occupancy, missing owners,
  incompatible foreign keys, or ambiguous cable-host mappings abort migration.
- Failed configuration copy rolls back the entire destination mutation.
- Failed Registry resource migration leaves every canvas and the existing
  linked revision unchanged.
- Missing source canvases, unavailable hosts, or stale revisions produce normal
  user-facing conflict messages without mutating another workspace.
- Invalid route cache is recoverable; actual cable connections and manual bends
  are not disposable.
- Global inventory with zero memberships is preserved; global inventory with
  multiple memberships remains global.

## Verification Matrix

### Migration And Persistence

- Import legacy inventory into project-bound project `1`.
- Convert existing single-membership global items to their owning project.
- Preserve zero-membership and genuinely multi-project global items.
- Preserve original assignment, connection, port, host, component, resource,
  Registry-link, agent, placement, and route identities.
- Copy preexisting shared host assignments into every canvas where the host is
  placed.
- Copy visible eligible cable connections into each independent canvas.
- Preserve existing manual bends, visibility overrides, and valid route caches.
- Preserve fixed hardware and reject its removal.
- Verify foreign-key integrity, atomic rollback, restart idempotency, backup
  restore, and deterministic repeated migration.

### Canvas Isolation

- Install the same CPU, RAM, storage, GPU, network card, or power adapter in
  different canvases without violating another canvas's occupancy.
- Connect the same physical network, display, or power port differently in
  separate canvases.
- Reject duplicate component, slot, or endpoint usage within one canvas.
- Return a host to inventory in one canvas and prove all other canvases retain
  placements, assignments, cables, route cache, and compatibility findings.
- Remove an assigned component in one canvas without changing its assignments
  or cables in another.
- Undo and redo local topology operations without mutating another workspace.
- Delete a canvas without deleting canonical inventory or another canvas.

### Systems, Inspector, And Sidebar

- Display and copy stable canonical inventory IDs.
- Find the same inventory item with `#id` and plain numeric ID search.
- Show project inventory availability independently per canvas.
- Default Systems to `All systems`.
- Filter Systems host rows and component summaries by selected canvas.
- Preserve canonical telemetry, Registry, custom-field, and tag projections.
- Persist and restore the canvas filter in project/user/browser preferences and
  saved views.
- Verify no per-host N+1 queries and no new HTTP polling.

### Copy, Registry, Sharing, And Recovery

- Copy component assignments preserving physical component IDs.
- Copy eligible cables only when explicitly enabled.
- Reject conflicting slots/endpoints atomically and preserve destination data.
- Recalculate route cache only when copied geometry differs.
- Evaluate Registry updates across every affected canvas.
- Preserve agent identity while applying suggestions only to the active canvas.
- Serialize only selected-canvas configuration into LabGD payloads.
- Preserve full/selective backups, selective restoration, demo isolation, and
  external sharing/account contracts.

### Mandatory Release Gates

Before any requested deployment:

```text
bun run lint
bun run test
bun run build
bun run security:container
```

Container verification must boot final distroless images for `linux/amd64` and
`linux/arm64`; Docker Scout and Trivy must each report zero vulnerabilities at
every severity.

User-visible behavior requires updates to the structured unreleased release
notes and `CHANGELOG.md`. Do not bump the application version, create tags,
push, publish, or deploy until the user explicitly requests deployment.

Remove task-created temporary databases, browser artifacts, Docker images,
containers, and build cache before completion. Preserve source files, existing
user data, and every Docker volume unless the user explicitly authorizes volume
deletion.

## Implementation Sequencing

Implement this as one coordinated feature with separately verified internal
stages:

1. Add the relational workspace-owned schema, automatic migration, inventory
   scope correction, and rollback/idempotency coverage.
2. Move topology mutations, compatibility evaluation, routing, undo/redo, and
   dependency analysis to workspace ownership.
3. Add canonical inventory IDs, sidebar ID search, Systems canvas filtering, and
   scoped SSE/read-model invalidation.
4. Add configuration copying, verify LabGD/backup/Registry integration, and run
   complete two-canvas end-to-end regression coverage.

Do not publish an intermediate stage that leaves the migration, runtime engine,
sharing projections, or existing production canvases operating under conflicting
ownership models.
