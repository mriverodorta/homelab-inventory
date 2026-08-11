# SQLite Persistence And Multi-Project Workspaces

## Status

Approved design for the `sqlite-migration` branch. This document defines two
implementation milestones that are verified independently but released
together:

1. Replace the authoritative LowDB stores with normalized SQLite persistence.
2. Activate projects and typed workbook workspaces on the new relational model.

The final application milestone also adopts the registry catalog-status
check-in contract. A separate registry v9 handoff will then align catalog wire
values with the canonical units defined here.

## Goals

- Replace the in-memory LowDB write model with durable, relational SQLite.
- Preserve the fast interaction model through coarse read endpoints and bounded
  caching rather than loading the complete database into JavaScript memory.
- Preserve every inventory item, assignment, placement, cable, bend point,
  registry link, agent binding, user, role, setting, and notification record.
- Give every canonical entity and relationship a positive, non-reusable numeric
  ID suitable for a later PostgreSQL migration.
- Normalize every field and repeated structure currently understood by the app.
- Preserve unknown registry and agent fields without making JSON the primary
  persistence model.
- Add projects with fixed Systems workspaces and multiple Canvas workspaces.
- Keep project access global initially while leaving authorization interfaces
  ready for future project ACLs.
- Preserve selective `.hlibackup` export and replacement restore.
- Avoid additional database or cache containers.

## Non-Goals

- PostgreSQL deployment in this release.
- DuckDB.
- Redis or Valkey as a required service.
- Project duplication.
- Project-specific authorization rules.
- Rack, VLAN, or other new workspace implementations.
- Registry canonical-unit v9 implementation in this repository.
- Runtime use of the old LowDB stores after successful SQLite activation.

## Delivery Sequence

### Milestone 1: SQLite Foundation

- Introduce the three SQLite databases and Drizzle schemas.
- Add ordered migrations, repositories, integrity checks, and cache boundaries.
- Import the current LowDB installation into SQLite automatically.
- Keep the current single-project user experience while verifying parity.
- Prove backup, restore, restart, rollback, and cross-architecture behavior.

### Milestone 2: Projects And Workspaces

- Activate the project-aware tables and APIs.
- Migrate current data into project `1`, named `Default Project`.
- Add the top-header project switcher and bottom workbook tab strip.
- Add the fixed Systems workspace and multiple Canvas workspaces.
- Add global and project-bound inventory scope.

The two milestones remain on `sqlite-migration` until both pass. Milestone 1 is
not deployed publicly by itself.

### Final Application Work

- Adopt the registry catalog-status check-in contract.
- Complete release documentation and migration guidance.
- Produce a separate registry v9 canonical-units handoff.

## Database Boundaries

The application owns three independent SQLite files:

```text
/data/databases/homelab-inventory.sqlite
/data/databases/telemetry.sqlite
/data/databases/catalog.sqlite
```

Each database has an independent schema version and migration journal. Health
and backup metadata report all three versions plus the supported OEM contract
version.

### Core Database

`homelab-inventory.sqlite` is the authoritative transactional database for:

- projects and workspaces;
- inventory, hardware structure, and compatibility;
- project membership, assignments, connections, and layouts;
- registry configuration, links, contributions, and enrollment projection;
- agents, bindings, enrollment, and monitoring policy;
- authentication, authorization, sessions, and invitations;
- audits, incidents, notification configuration, and delivery state;
- backup configuration, migration history, and cross-database journals.

### Telemetry Database

`telemetry.sqlite` stores retention-managed operational data:

- agent heartbeats and host measurements;
- network, storage, and filesystem samples;
- service, container, virtualization, and storage-health observations;
- latest-state projections;
- complete manual hardware inventory reports and interpreted suggestions.

### Catalog Database

`catalog.sqlite` is a replaceable, signed read model:

- verified catalog revision metadata;
- canonical template payloads;
- identity aliases and hashes;
- FTS5 search data;
- indexed term and numeric facets.

It contains no private inventory, installation credentials, or local overrides.

## Persistence Technology

### Drizzle

Use Drizzle ORM and Drizzle Kit for:

- TypeScript schema definitions;
- compile-time table, column, and relationship typing;
- reviewed SQL migration generation;
- routine CRUD and relational queries;
- CI schema-drift checks.

Use `drizzle-kit generate`, never uncontrolled `drizzle-kit push` against a user
database. Generated SQL is reviewed and committed.

### Direct Bun SQLite

Use direct `bun:sqlite` for specialized paths where explicit control matters:

- the initial LowDB bulk migration;
- high-volume telemetry transactions;
- FTS and catalog index construction;
- backup and restore staging;
- integrity checks and pragmas;
- measured hot paths that benefit from long-lived prepared statements.

Both access styles share the same managed database connections and transaction
boundaries. Domain services depend on repository interfaces rather than SQL.

## Runtime Contract

The pinned runtime contract is defined in
`docs/superpowers/specs/2026-08-11-sqlite-runtime-contract-design.md`.

Every database connection uses strict mode and the relevant baseline pragmas:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA temp_store = MEMORY;
PRAGMA trusted_schema = OFF;
PRAGMA wal_autocheckpoint = 1000;
```

New databases enable incremental auto-vacuum before schema creation. Runtime
maintenance uses passive checkpoints, bounded incremental vacuum after large
deletions, and `PRAGMA optimize` after migrations and at measured intervals. A
full blocking `VACUUM` does not run during normal interactive use.

## ID And Relationship Model

### Canonical IDs

Canonical core entities and durable relationship rows use:

```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
```

IDs are never reused. Join tables also have their own ID plus unique constraints
on the meaningful foreign-key combination. Array positions, names, labels, and
semantic keys never act as persisted relationships.

### Shared-Primary-Key Inventory Inheritance

All physical inventory has one globally unique parent identity:

```text
inventory_items.id = 402
cpus.id            = 402
```

Subtype `id` columns are both their primary key and a foreign key to
`inventory_items.id`. They are not independently generated.

Generic relationships reference `inventory_items.id` through ordinary columns
such as `host_id`, `component_id`, or `item_id`.

### Permanent Legacy Aliases

Current category-scoped identities are retained through permanent aliases:

```text
inventory_identity_aliases
port_identity_aliases
resource_identity_aliases
```

Existing `{type, id}` references from agents, old backups, URLs, and API clients
resolve through aliases. Active SQLite relationships use canonical IDs only.
An alias is never reassigned to another record.

The initial migration allocates global IDs deterministically using a fixed type
order and ascending legacy ID. Ambiguous references or alias collisions stop the
migration.

## Core Schema Domains

### System

```text
schema_migrations
application_metadata
application_settings
migration_runs
restore_runs
cross_database_operations
```

Migration records include an ordered ID, SQL checksum, app version, start and
completion timestamps, and verification result. Historical migration checksum
changes are fatal.

### Projects And Workspaces

```text
projects
project_preferences
workspaces
canvas_workspaces
project_inventory_memberships
project_inventory_overrides
```

`projects` stores name, description, curated icon key, revision, global
inventory access, archive state, and timestamps. Active names are unique
case-insensitively. Projects do not have colors.

`workspaces` stores project, type, name, curated icon key, controlled color key,
sort order, revision, and fixed system key where applicable.

Every project has exactly one Systems workspace at sort order zero and at least
one Canvas workspace. Systems metadata is fixed. Future workspace types receive
their own subtype tables without changing the base tab model.

`project_preferences.default_workspace_id` must reference a workspace in the
same project.

`project_inventory_overrides` stores a project-specific display alias and notes
for a global item. It never duplicates or overrides canonical hardware identity,
registry linkage, serial number, agent binding, or telemetry.

### Inventory Parent

```text
inventory_items
inventory_item_types
manufacturers
manufacturer_aliases
inventory_identity_aliases
```

The parent stores common physical identity and lifecycle fields:

- type;
- global or project scope;
- owner project for project-bound items;
- name, manufacturer, model, family, and product number;
- serial number and notes;
- row version and archive state;
- narrowly scoped unknown-field extensions;
- creation and update timestamps.

Project-bound scope requires an owner project. Global scope requires no owner
project. Quantity creation inserts multiple physical item rows.

Serial numbers remain private local data and are excluded by registry
contribution serializers.

### Inventory Subtypes

Create one typed table for every inventory type supported by the application,
including compute hosts, processors, memory, storage, graphics, networking,
displays, audio, chassis, cooling, and power equipment. Every field currently
understood by the application becomes a typed column or normalized child row.

`extensions_json` preserves only fields from a supported newer payload that the
installed app does not yet understand. Supported fields are rejected from the
extension object to avoid duplicate sources of truth. Unsupported contract
versions fail explicitly.

### Controlled Vocabularies

Compatibility-relevant values use lookup tables with numeric IDs, stable keys,
and display labels:

```text
cpu_socket_types
memory_generations
memory_module_types
storage_interfaces
storage_form_factors
expansion_slot_types
port_kinds
connector_types
chassis_types
power_connector_types
```

Many-to-many support uses relationship rows with IDs and uniqueness constraints.
Descriptive values such as notes, operating-system text, and custom labels remain
free text.

### Host Resources

```text
host_resource_groups
host_resource_slots
cpu_socket_slots
memory_slots
storage_slots
expansion_slots
controller_slots
boot_device_slots
psu_bays
power_adapter_slots
component_assignments
```

Every physical slot is represented individually. Resource groups preserve stable
semantic keys and population requirements. Slots can reference parent resources
for CPU-dependent memory and expansion topology.

Assignments are project-specific and reference exact canonical host, component,
and resource-slot IDs. Legacy assignments are positioned only when the mapping
is unambiguous. Otherwise, they remain explicitly unpositioned and produce an
audit warning.

### Ports And Connections

```text
port_groups
item_ports
internal_port_links
connections
workspace_connection_visibility
workspace_manual_bend_points
workspace_route_cache
```

All network, power, and video connection endpoints use `item_ports.id`.
Patch-panel pass-through and similar internal structure use
`internal_port_links`, not user-created cables.

Connections are canonical project topology. Endpoint sides become fixed after
initial automatic selection. Manual bend points are authoritative user data.
Calculated routes are disposable cache records keyed by workspace, connection,
routing-engine version, and a deterministic geometry/settings fingerprint.
Zoom is not part of routing geometry.

A connection is visible by default in a Canvas only when both endpoint items are
placed there. Per-workspace visibility can override that default.

### Registry

```text
registry_settings
registry_sources
registry_links
registry_installation_projection
registry_catalog_adoption_status
contribution_outbox
contribution_delivery_ledger
```

Private keys, credentials, and `installation-instance.json` remain protected
files under `/data/registry`. SQLite stores the public projection and operational
state, not private key material.

### Agents

```text
agents
agent_host_bindings
agent_monitoring_policies
agent_enrollment_codes
```

Agent bindings reference canonical host IDs. Legacy host references resolve
through aliases before any core or telemetry operation.

### Authentication And Authorization

```text
users
user_identities
credentials
sessions
invitations
roles
permissions
role_permissions
user_roles
```

Roles and visibility remain global in this release. Authorization service calls
accept an optional project scope so future project ACLs can be added without
changing callers. No unused project-ACL tables are introduced yet.

### Audits, Notifications, And Backups

```text
compatibility_audits
compatibility_audit_ignores
notification_contact_points
notification_rules
incidents
incident_transitions
notification_deliveries
backup_schedules
backup_runs
backup_restore_journal
```

## Canonical Units

Persist measurable values in explicit integer units:

```text
CPU clock                 MHz
Memory capacity           MiB
Storage capacity          bytes
Network speed             bits per second
Power                     milliwatts
Voltage                   millivolts
Current                   milliamps
Physical dimensions       millimeters
Temperature               milli-degrees Celsius
Timestamps                Unix epoch milliseconds UTC
Percentages               basis points when persisted
Canvas coordinates        REAL canvas units
```

Display adapters continue presenting friendly units. Imprecise source text is
preserved separately instead of being converted into false precision.

Current registry v8 fields are translated at the application boundary. The
later registry v9 handoff will define matching canonical wire units, dual v8/v9
support, deterministic hashing, staged backfill, and publication gating.

## Revision And Command Model

Replace the broad single project revision with:

```text
inventory_items.version
projects.revision
workspaces.revision
```

- Hardware edits increment only the item version.
- Membership, assignment, and canonical connection changes increment the
  project revision.
- Layout, visibility, viewport, and manual-bend changes increment only the
  workspace revision.
- Derived route-cache writes increment no user-data revision.

Commands carry only relevant expected revisions. Conflicts return current
records and revisions for targeted reconciliation rather than rebuilding the
whole workspace. A transaction journal records actor, operation, affected IDs,
and timestamps for audit and undo support.

## Read Model And Caching

Use coarse-grained endpoints:

```text
GET /api/bootstrap
GET /api/projects/:projectId/workspaces/:workspaceId
GET /api/inventory/:itemId
```

The bootstrap returns session, projects, active-project preference, global
settings, and lightweight workspace metadata. The workspace endpoint returns
membership, placements, visible connections, manual bends, valid route-cache
entries, and compact inventory summaries. Inspector, telemetry, catalog, and
archive details load lazily.

### Cache Levels

```text
L0  SQLite page cache and Bun prepared-statement cache
L1  bounded in-process LRU result cache
L2  persisted SQLite derived-cache tables
```

The default L1 budget is 64 MiB. Entries use revision-based keys, TTLs where
appropriate, and tag-based invalidation. Secrets and private values never enter
cache keys. Restore, migration, and activation clear L1 completely.

SQLite remains authoritative. Cache misses rebuild from repositories; cached
values are never written back as user data. A `CacheStore` interface permits a
future Redis or Valkey implementation if the app later supports multiple server
replicas, but no cache service is required now.

Local inventory search uses FTS5 over supported identity fields. Every foreign
key and frequent filter receives an appropriate index. Unknown extension JSON
is not indexed.

## Cross-Database Operations

Do not rely on attached-database transactions across WAL files. Use an
idempotent `cross_database_operations` journal.

Examples include telemetry cleanup after host unlink, catalog activation, and
coordinated backup. Each operation records its stage and resumes safely after a
restart. Catalog activation stages and verifies a complete replacement database
before atomic file replacement. Backups use a short write barrier to snapshot
matching revisions across all databases and protected files.

## Deletion And Foreign Keys

- `ON DELETE CASCADE` is limited to wholly owned child records.
- `ON DELETE RESTRICT` protects meaningful dependencies.
- `ON DELETE SET NULL` is limited to historical actor references.
- Inventory and projects are archive-first.
- Permanent project deletion is available only from the archive.
- Project deletion presents exact dependency counts and uses confirmation
  without typed-name entry.
- Project deletion is blocked while project-bound hosts have linked agents.
- Global items survive project deletion; only membership is removed.

The application checks dependencies for clear errors, and SQLite independently
enforces the same safety boundary.

## Settings Scope

### Application

Authentication, registry, backups, notifications, telemetry retention, update
channel, and environment-derived overrides.

### Project

Default workspace, global inventory access, compatibility policy, notification
defaults, and future project permission configuration.

### Workspace

Cable visibility, snapping, collision avoidance, viewport, and rendering
preferences.

### Browser

Use-last-active-tab, last workspace per project, panel sizes, and non-shared UI
preferences.

Environment values remain read-only and retain the existing explanatory
tooltip. Browser preferences are not backed up.

## Multi-Project Behavior

### Project Defaults

- New projects start empty.
- Global inventory access defaults to enabled.
- Systems and Canvas are created in one transaction.
- Canvas is the configured default workspace.
- Project names are unique among active projects.
- Projects have name, optional description, and curated Lucide icon.
- Projects do not have colors.

### Inventory Scope

- Project-bound items belong to exactly one owner project.
- Global items are canonical once and can have memberships in many projects.
- Global library items do not appear in Systems until added to the project.
- Project-specific assignments, placements, display aliases, notes, and audit
  exceptions can differ without copying canonical global hardware identity.
- Project-bound to global preserves the same canonical item ID.
- Global to project-bound is allowed only when exactly one membership remains.
- Cross-project item duplication creates one unassigned project-bound record,
  clears serial and agent identity, and copies no components, topology,
  placement, registry link, or telemetry.

Disabling global access is blocked while the project references global items.
The user must remove them or create project-bound duplicates first.

### Project Lifecycle

Projects can be renamed, archived, restored, and permanently deleted under the
foreign-key policy. Project duplication is deferred.

Project visibility remains global under existing role permissions. The
authorization interface accepts future project scope, but project-specific ACLs
are not implemented in this release.

## Workbook User Experience

- The active project switcher is compact and remains in the top header.
- Navigation uses `/projects/:projectId/workspaces/:workspaceId`.
- Back, Forward, direct links, and refresh preserve project and workspace.
- The bottom workbook strip is the final viewport element with no status footer.
- Systems is fixed first with a neutral style and immutable name/icon.
- User workspaces use controlled colors and curated Lucide icon keys.
- User workspace tabs can be renamed, reordered, and deleted.
- Every project retains at least one Canvas.
- The floating Canvas toolbar sits immediately above the tab strip.
- Autosaved Canvas changes flush before required navigation.
- Dirty inspector and settings forms use the existing discard confirmation.
- Failed required saves keep the user on the current workspace.

`Use last active tab` is a browser-wide preference. When enabled, a browser-local
map stores the last workspace ID for each project. Otherwise, the project default
opens. Missing workspace fallback order is initial Canvas, then Systems.

The Systems workspace lists project-member compute hosts only: servers, NAS
devices, PC builds, desktops, and workstations. Rack and other workspace types
are deferred.

## Existing Installation Migration

Create:

```text
Project 1: Default Project
Workspace 1: Systems
Workspace 2: Canvas
```

Migration behavior:

- All existing inventory becomes project-bound to project `1`.
- Every existing item receives project membership `1`.
- Assignments and canonical connections receive project `1`.
- Placements, viewport, manual bends, cable visibility, and valid route cache
  move to Canvas workspace `2`.
- Existing project revision becomes project `1`'s revision.
- Registry links, agents, telemetry, audit ignores, notifications, users, and
  roles resolve through canonical aliases.
- No item becomes global automatically.
- Canvas is the configured and browser fallback default.

## Automatic LowDB Cutover

The first SQLite-capable startup:

1. Acquires an exclusive migration lock.
2. Detects whether SQLite is already active.
3. Flushes and closes all LowDB stores.
4. Validates the complete legacy relational graph.
5. Creates and verifies a pre-migration `.hlibackup`.
6. Creates databases in a unique staging directory.
7. Applies schemas and imports records in dependency order.
8. Rewrites relationships using canonical ID maps.
9. Clones the existing telemetry database, migrates legacy host references to
   canonical IDs, and verifies sample and event counts.
10. Rebuilds the catalog database from the last verified signed snapshot.
11. Runs migration-specific semantic assertions.
12. Runs `foreign_key_check` and `quick_check`.
13. Commits and atomically activates the staged databases.
14. Writes the persistence-engine activation marker.
15. Reopens through normal repositories and verifies again.

The legacy transformer remains import-only so every currently supported old
backup schema can upgrade into the latest canonical import model before SQLite
insertion.

On failure, the staged databases are discarded, no activation marker is written,
and LowDB files remain unchanged. The new container refuses writes and reports
the precise failure. Restoring the previous image against the untouched LowDB
data remains possible. A retry always begins from clean staging files.

After successful activation, LowDB is never used as an active persistence layer.

## Backup And Restore

`.hlibackup` remains a logical, portable archive with sections such as:

```text
inventory
projects
workspaceLayouts
connections
routingCache
registryEnrollment
catalogState
agents
telemetry
authentication
settings
```

The manifest reports persistence engine and independent database schema
versions. Selective restore works against staging clones of all databases.
Preflight requires dependent sections when an isolated replacement would break
foreign keys. Restore never creates placeholders, silently renumbers records,
or disables validation to force success.

Internal migration and disaster-recovery snapshots may use exact SQLite
serialization. User-facing backups remain logical so they can restore into later
schemas and PostgreSQL.

Complete and registry-enrollment backups continue including
`installation-instance.json` and required protected identity files with ownership
and mode validation.

## Catalog Adoption Check-In

Adopt the registry contract from
`ServerSpecsInventoryRegistry/docs/handoffs/server-specs-inventory-catalog-adoption.md`.

Send a signed `POST /v1/installations/catalog-status`:

- after enrollment credentials and active catalog are ready;
- after active catalog revision changes;
- every six hours in connected mode.

The request contains only application version, active catalog revision, and
current report timestamp. Each attempt uses a fresh nonce, timestamp, signature,
and body timestamp.

Check-in never blocks startup, catalog browsing, inventory writes, or
contributions. Transient failures use bounded backoff. `429` defers until the
next scheduled interval. `401` enters the existing enrollment recovery state
without creating another installation. Demo and offline modes never check in.

Registry Settings displays last attempt, last success, current/behind state,
registry revision, and a non-sensitive failure summary.

## Registry V9 Follow-Up

After the application design is implemented, prepare a separate registry handoff
that:

- defines canonical integer wire units matching this schema;
- updates identity normalization and hashes;
- preserves source precision and unknown fields;
- stages and verifies catalog backfill;
- keeps v8 imports supported during transition;
- blocks v9 publication until the app reports v9 support;
- publishes a newly signed catalog revision without silently changing local
  inventory.

## Security

- Database and staging directories use mode `0700`.
- Database, WAL, migration, and protected identity files use mode `0600`.
- Values use bound parameters; dynamic identifiers use code-owned allowlists.
- Production DDL comes only from reviewed committed migrations.
- No API exposes arbitrary SQL or raw database files.
- Secrets never enter L1 cache, logs, contribution payloads, or cache keys.
- Startup verifies ownership, permissions, migration checksums, foreign keys,
  and integrity before accepting writes.
- Demo sessions use isolated ephemeral databases and cannot enroll, rotate,
  recover, or contribute.

SQLite data files are not transparently encrypted at rest. Deployment storage
permissions and host-level disk protection remain the at-rest boundary, while
portable backups containing protected sections remain encrypted.

## Error Handling

- Unsupported future schema or protocol versions fail explicitly.
- Migration and restore errors identify the failed stage without exposing data.
- Real revision conflicts return current records and revisions for reconciliation.
- Derived-cache failures degrade to recomputation and never block authoritative
  writes.
- Cross-database operations resume from their durable journal stage.
- Catalog adoption errors remain non-blocking except that authentication failures
  enter the existing recovery state.
- Database integrity failures stop writes and direct the user to verified restore
  options.

## Verification

### Correctness

- Migrate every supported historical LowDB schema through the import-only legacy
  transformer.
- Migrate production-shaped schema 29 fixtures.
- Preserve every record and relationship semantically.
- Test deterministic canonical ID and alias creation.
- Fail on alias collisions and ambiguous legacy references.
- Inject interruption after every migration and cross-database stage.
- Prove restart idempotency and rollback.
- Test foreign-key restrictions and intended cascades.
- Test complete and selective backup/restore dependency behavior.
- Test concurrent item, project, and workspace conflicts.
- Test demo isolation and protected identity preservation.
- Test registry v8 import and reserve fixtures for v9 canonical units.
- Test catalog adoption signing, privacy, retry, rate-limit, and recovery behavior.

### Performance

Initial targets:

```text
Initial API bootstrap requests        <= 3
Warm active-workspace server load     <= 250 ms
Typical transactional command         <= 100 ms
Cached route hydration                no route recomputation
Default L1 result-cache budget        64 MiB
Idle database write activity          scheduled jobs only
```

Migration duration is benchmarked against a copy of current production-sized
data before setting a hard threshold. Record startup duration, request count,
memory, database size, WAL size, cache hit rate, and routing hydration behavior.

### Required Checks

```bash
bun run lint
bun run test
bun run build
bun run security:container
```

The final distroless image must pass the pinned SQLite runtime verifier and zero-
vulnerability policy on AMD64 and ARM64 before release.

## Release And Documentation

- Accumulate work in the Unreleased changelog and structured release-note draft.
- Do not bump the version, tag, push, or deploy during implementation.
- Publish one consolidated release only after both milestones pass.
- Add a user migration guide covering automatic cutover, backup, failure
  recovery, project defaults, inventory scope, and selective restore.
- Keep README and Docker Hub documentation aligned when the feature is released.
