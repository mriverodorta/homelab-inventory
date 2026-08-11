# SQLite Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the authoritative LowDB stores with normalized, verified SQLite persistence while preserving the current single-project API and user experience.

**Architecture:** Drizzle owns typed schema definitions, reviewed SQL migrations, and ordinary repositories on top of Bun's native SQLite driver. Specialized import, telemetry, catalog, integrity, backup, and measured hot paths use direct `bun:sqlite`; existing JSON-shaped APIs are served by read-only compatibility projections until the later project/workspace plan replaces them.

**Tech Stack:** Bun 1.3.14, SQLite 3.53.0, `bun:sqlite`, Drizzle ORM 0.45.2, Drizzle Kit 0.31.10, `lru-cache` 11.5.2, Zod-compatible existing validators, Vitest, Bun test, Docker distroless.

## Global Constraints

- Work only on the local `sqlite-migration` branch; do not push, tag, deploy, or bump the application version.
- Keep the current frontend and single-project API operational throughout this milestone.
- Do not expose a mutable `store.databases.*.data` compatibility layer over SQLite.
- Every canonical primary and foreign key is a positive safe integer.
- Every durable relationship row has a non-reusable `id`, foreign keys, and a meaningful unique constraint.
- Supported inventory fields use typed columns or normalized child rows; JSON is limited to raw reports, derived cache payloads, and unknown forward-compatible extensions.
- Use canonical integer units: MHz, MiB, bytes, bits per second, milliwatts, millivolts, milliamps, millimeters, milli-degrees Celsius, epoch milliseconds, and basis points.
- Keep `/data/registry/installation-instance.json`, the Ed25519 key, and installation credentials as protected files with mode `0600`.
- Preserve every existing assignment, placement, connection, manual bend, route cache, registry link, agent binding, authentication record, notification record, and setting.
- Preserve the current telemetry and catalog database data while migrating their schemas and references.
- Do not run Drizzle `push` against user databases; only committed, checksummed migrations may change production schema.
- Update the Unreleased changelog and structured release-note draft for user-visible migration work; do not finalize a version.
- Run `bun run lint`, `bun run test`, `bun run build`, and `bun run security:container` before declaring the milestone complete.

---

### Task 1: Install Drizzle And Establish Database Tooling

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Create: `drizzle.config.ts`
- Create: `server/persistence/core/schema/index.ts`
- Create: `server/persistence/core/migrations/manifest.ts`
- Create: `scripts/check-database-migrations.mjs`
- Create: `scripts/check-database-migrations.bun_spec.mjs`

**Interfaces:**
- Produces: `coreSchema`, `CORE_MIGRATIONS`, and `verifyMigrationManifest({ migrationsDir, manifest })`.
- Consumes: pinned Bun SQLite runtime from `scripts/verify-sqlite-runtime.mjs`.

- [ ] **Step 1: Add the failing migration-manifest tests**

```js
test('accepts ordered migrations whose SHA-256 checksums match', async () => {
  const result = await verifyMigrationManifest({ migrationsDir, manifest })
  expect(result).toEqual({ count: 1, latest: '0001_sqlite_foundation' })
})

test('rejects modified historical SQL', async () => {
  await writeFile(join(migrationsDir, '0001_sqlite_foundation.sql'), 'SELECT 2;')
  expect(() => verifyMigrationManifest({ migrationsDir, manifest })).toThrow('checksum')
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `bun test scripts/check-database-migrations.bun_spec.mjs`

Expected: FAIL because the verifier and manifest do not exist.

- [ ] **Step 3: Pin dependencies and scripts**

Add exact dependencies:

```json
{
  "dependencies": {
    "drizzle-orm": "0.45.2",
    "lru-cache": "11.5.2"
  },
  "devDependencies": {
    "drizzle-kit": "0.31.10"
  },
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrations:check": "bun scripts/check-database-migrations.mjs",
    "test:sqlite": "bun test scripts/verify-sqlite-runtime.bun_spec.mjs scripts/check-database-migrations.bun_spec.mjs server/persistence/**/*.bun_spec.{js,mjs,ts} server/registry/*.bun_spec.mjs server/telemetry/*.bun_spec.mjs"
  }
}
```

Configure Drizzle for SQLite, schema glob `server/persistence/core/schema/*.ts`, and output directory `server/persistence/core/migrations/generated`.

- [ ] **Step 4: Implement checksummed migration discovery**

```ts
export type CoreMigration = Readonly<{
  id: string
  file: string
  sha256: string
}>

export const CORE_MIGRATIONS: readonly CoreMigration[] = []
```

The verifier must reject duplicate IDs, non-ascending IDs, missing files, extra untracked SQL files, and checksum mismatches.

- [ ] **Step 5: Run focused checks**

Run: `bun install --frozen-lockfile && bun test scripts/check-database-migrations.bun_spec.mjs && bun run db:migrations:check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock drizzle.config.ts scripts/check-database-migrations.* server/persistence/core
git commit -m "build: add SQLite schema migration tooling [skip release-notes]"
```

---

### Task 2: Add Managed SQLite Connections And Migration Runner

**Files:**
- Create: `server/persistence/sqlite/database.ts`
- Create: `server/persistence/sqlite/migrator.ts`
- Create: `server/persistence/sqlite/integrity.ts`
- Create: `server/persistence/sqlite/database.bun_spec.ts`
- Create: `server/persistence/sqlite/migrator.bun_spec.ts`

**Interfaces:**
- Produces: `openManagedDatabase(options)`, `closeManagedDatabase(handle)`, `databaseStatus(handle)`, `applyCommittedMigrations(handle, migrations)`.
- Consumes: `CORE_MIGRATIONS` from Task 1.

- [ ] **Step 1: Write failing connection-profile tests**

```ts
test('opens a strict WAL database with required safety pragmas', async () => {
  using handle = await openManagedDatabase({ filePath, schemaName: 'core' })
  expect(databaseStatus(handle)).toMatchObject({
    journalMode: 'wal',
    foreignKeys: true,
    busyTimeoutMs: 5000,
    integrity: 'ok',
  })
})
```

Also test file mode `0600`, directory mode `0700`, future schema rejection, failed-migration rollback, checksum mismatch, and idempotent restart.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `bun test server/persistence/sqlite/database.bun_spec.ts server/persistence/sqlite/migrator.bun_spec.ts`

Expected: FAIL because the lifecycle functions do not exist.

- [ ] **Step 3: Implement the managed handle**

```ts
export type ManagedDatabase = Disposable & {
  readonly database: Database
  readonly filePath: string
  readonly schemaName: 'core' | 'telemetry' | 'catalog'
  close(): void
}

export async function openManagedDatabase(options: {
  filePath: string
  schemaName: ManagedDatabase['schemaName']
  readonly?: boolean
}): Promise<ManagedDatabase>
```

Apply the approved pragmas, enable incremental auto-vacuum before first schema creation, run `quick_check`, and refuse unsafe ownership or permissions.

- [ ] **Step 4: Implement ordered migrations**

Create `schema_migrations` with migration ID, checksum, app version, start time, completion time, and verification status. Apply each SQL file in a transaction and record it only after migration-specific checks pass. Never apply a migration whose committed checksum differs from the recorded checksum.

- [ ] **Step 5: Run focused checks**

Run: `bun test server/persistence/sqlite/*.bun_spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/persistence/sqlite
git commit -m "feat: add managed SQLite lifecycle"
```

---

### Task 3: Define Project, Inventory Parent, And Vocabulary Schema

**Files:**
- Create: `server/persistence/core/schema/system.ts`
- Create: `server/persistence/core/schema/projects.ts`
- Create: `server/persistence/core/schema/inventory-base.ts`
- Create: `server/persistence/core/schema/vocabularies.ts`
- Modify: `server/persistence/core/schema/index.ts`
- Create: `server/persistence/core/schema/schema.bun_spec.ts`
- Create: `server/persistence/core/migrations/generated/0001_sqlite_foundation.sql`
- Modify: `server/persistence/core/migrations/manifest.ts`

**Interfaces:**
- Produces: Drizzle tables for system metadata, project `1`, workspace bases, inventory parent identity, aliases, manufacturers, and controlled vocabularies.
- Consumes: managed SQLite lifecycle from Task 2.

- [ ] **Step 1: Write failing schema tests**

```ts
test('enforces global and project-bound inventory ownership', () => {
  expect(() => insertItem({ scope: 'project', ownerProjectId: null })).toThrow()
  expect(() => insertItem({ scope: 'global', ownerProjectId: 1 })).toThrow()
})

test('prevents active project names from colliding case-insensitively', () => {
  insertProject('Default Project')
  expect(() => insertProject('default project')).toThrow()
})
```

Also test non-reused IDs, immutable alias uniqueness, workspace ownership, one Systems workspace per project, and vocabulary key uniqueness.

- [ ] **Step 2: Run the schema test and verify failure**

Run: `bun test server/persistence/core/schema/schema.bun_spec.ts`

Expected: FAIL because the tables are absent.

- [ ] **Step 3: Define system and project tables**

Define `application_metadata`, `application_settings`, `migration_runs`, `restore_runs`, `cross_database_operations`, `projects`, `project_preferences`, `workspaces`, `canvas_workspaces`, `project_inventory_memberships`, and `project_inventory_overrides` with the checks and unique indexes from the design.

- [ ] **Step 4: Define inventory identity tables**

Define `inventory_items`, `inventory_item_types`, `manufacturers`, `manufacturer_aliases`, `inventory_identity_aliases`, `port_identity_aliases`, and `resource_identity_aliases`. Use epoch-millisecond timestamps and a CHECK constraint coupling `scope` with `owner_project_id`.

- [ ] **Step 5: Define controlled vocabulary tables**

Create numeric lookup tables for CPU sockets, memory generations and module types, storage interfaces and form factors, expansion slots, ports, connectors, chassis classes, and power connectors. Seed stable keys through the migration, not application startup.

- [ ] **Step 6: Generate and review SQL**

Run: `bun run db:generate -- --name sqlite_foundation`

Review that every table is `STRICT`, every relationship column is indexed, foreign keys are enabled, and no generated migration drops a user table.

- [ ] **Step 7: Update the manifest and run tests**

Run: `bun run db:migrations:check && bun test server/persistence/core/schema/schema.bun_spec.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/persistence/core
git commit -m "feat: define core SQLite identity schema"
```

---

### Task 4: Define Typed Inventory Subtables And Canonical Units

**Files:**
- Create: `server/persistence/core/schema/inventory-hosts.ts`
- Create: `server/persistence/core/schema/inventory-components.ts`
- Create: `server/persistence/core/schema/inventory-network.ts`
- Create: `server/persistence/core/schema/inventory-power.ts`
- Create: `server/persistence/core/inventory/field-contract.ts`
- Create: `server/persistence/core/inventory/units.ts`
- Create: `server/persistence/core/inventory/units.test.ts`
- Create: `server/persistence/core/inventory/field-contract.test.ts`
- Modify: `server/persistence/core/schema/index.ts`

**Interfaces:**
- Produces: one shared-primary-key table for each of the 20 current inventory types, `INVENTORY_FIELD_CONTRACT`, and canonical unit converters.
- Consumes: `inventoryItems` and vocabulary tables from Task 3.

- [ ] **Step 1: Write failing canonical-unit tests**

```ts
expect(toMhz({ value: 2.3, unit: 'GHz' })).toBe(2300)
expect(toMib({ value: 16, unit: 'GiB' })).toBe(16384)
expect(toBytes({ value: 1_000_204_886_016, unit: 'bytes' })).toBe(1_000_204_886_016)
expect(toMilliwatts({ value: 130, unit: 'W' })).toBe(130_000)
```

Reject unsafe integers, negative capacities, and conversions that imply false precision.

- [ ] **Step 2: Write the persistence coverage test**

The test must enumerate every field currently emitted by inventory forms and registry adapters and assert exactly one database mapping or explicit `extensions` classification.

```ts
for (const field of supportedInventoryFields()) {
  expect(INVENTORY_FIELD_CONTRACT.get(`${field.type}.${field.path}`)).toBeDefined()
}
```

- [ ] **Step 3: Run tests and verify failure**

Run: `bun test server/persistence/core/inventory/*.test.ts`

Expected: FAIL because converters and mappings do not exist.

- [ ] **Step 4: Define subtype tables**

Create shared-primary-key tables for `server`, `nas`, `pcBuild`, `cpu`, `ram`, `storage`, `gpu`, `network`, `motherboard`, `cpuCooler`, `case`, `powerSupply`, `soundCard`, `wireless`, `powerAdapter`, `switch`, `patchPanel`, `monitor`, `ups`, and `powerStrip`. Common identity stays in `inventory_items`; subtype-only supported fields use typed columns.

- [ ] **Step 5: Implement unit adapters and field contract**

Map current names such as `baseClockGhz`, `capacityGb`, `speedMbps`, and `tdpWatts` to canonical columns. Preserve source text only when a precise conversion is impossible. Reject supported field names inside `extensions_json`.

- [ ] **Step 6: Generate, inspect, and verify migration SQL**

Run: `bun run db:generate -- --name typed_inventory && bun run db:migrations:check`

Expected: generated SQL adds only the typed subtype tables and indexes.

- [ ] **Step 7: Run focused tests**

Run: `bun test server/persistence/core/inventory/*.test.ts server/persistence/core/schema/schema.bun_spec.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/persistence/core
git commit -m "feat: normalize typed inventory records"
```

---

### Task 5: Define Hardware Resources, Ports, Topology, And Routing Cache

**Files:**
- Create: `server/persistence/core/schema/resources.ts`
- Create: `server/persistence/core/schema/ports.ts`
- Create: `server/persistence/core/schema/topology.ts`
- Create: `server/persistence/core/schema/routing.ts`
- Create: `server/persistence/core/schema/topology.bun_spec.ts`
- Modify: `server/persistence/core/schema/index.ts`

**Interfaces:**
- Produces: normalized host resources, individual slots, assignments, ports, project connections, placements, visibility, bends, and route cache.
- Consumes: canonical item and vocabulary IDs from Tasks 3-4.

- [ ] **Step 1: Write failing relationship tests**

```ts
test('rejects assigning a component to a slot owned by another host', () => {
  expect(() => assign({ projectId: 1, hostId: 1, componentId: 9, slotId: otherHostSlot })).toThrow()
})

test('blocks deleting a port used by a connection', () => {
  expect(() => deletePort(connectedPortId)).toThrow()
})
```

Also test one component per project assignment, single-capacity slots, paired patch-panel endpoints, connection-kind compatibility, workspace ownership, bend ordering, and route-cache replacement without revision increment.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `bun test server/persistence/core/schema/topology.bun_spec.ts`

Expected: FAIL because topology tables are absent.

- [ ] **Step 3: Define resource and slot tables**

Add resource groups, physical slots, CPU sockets, memory, storage, expansion, optional modules, controllers, boot devices, PSU bays, cooling profiles, management controllers, constraint groups, and resource membership tables. Preserve semantic keys separately from numeric IDs.

- [ ] **Step 4: Define ports and connections**

Add port groups, item ports, endpoint faces, internal links, canonical project connections, and indexes that enforce single-use ports where required.

- [ ] **Step 5: Define workspace presentation state**

Add placements, connection visibility, manual bends, and route cache. Route cache rows include engine version, layout fingerprint, route fingerprint, payload, and calculated timestamp; they never increment user-data revisions.

- [ ] **Step 6: Generate migration SQL and run tests**

Run: `bun run db:generate -- --name hardware_topology && bun run db:migrations:check && bun test server/persistence/core/schema/topology.bun_spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/persistence/core
git commit -m "feat: normalize hardware topology and routing state"
```

---

### Task 6: Define Registry, Agent, Authentication, Notification, And Backup Tables

**Files:**
- Create: `server/persistence/core/schema/registry.ts`
- Create: `server/persistence/core/schema/agents.ts`
- Create: `server/persistence/core/schema/authentication.ts`
- Create: `server/persistence/core/schema/notifications.ts`
- Create: `server/persistence/core/schema/backups.ts`
- Create: `server/persistence/core/schema/application-domains.bun_spec.ts`
- Modify: `server/persistence/core/schema/index.ts`

**Interfaces:**
- Produces: relational schemas for every remaining LowDB and notification JSON store.
- Consumes: canonical items, projects, users, and relationship-ID policy.

- [ ] **Step 1: Write failing domain-schema tests**

Test registry source/link validity, one active agent binding per host, session-account foreign keys, role-permission uniqueness, protected owner constraints, notification incident/delivery relationships, backup schedule validity, and registry adoption status uniqueness per source.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `bun test server/persistence/core/schema/application-domains.bun_spec.ts`

Expected: FAIL because domain tables are absent.

- [ ] **Step 3: Define relational domain tables**

Translate all arrays and next-ID counters from registry, agents, authentication, notifications, and backup-management stores into AUTOINCREMENT tables and explicit foreign keys. Keep notification encrypted secret envelopes in the core database but keep their master key as a protected file.

- [ ] **Step 4: Add project-independent configuration rows**

Use one-row configuration tables guarded by `CHECK (id = 1)` for application, authentication, registry, notification, and backup settings. Store environment source metadata separately so environment overrides remain read-only.

- [ ] **Step 5: Generate and verify SQL**

Run: `bun run db:generate -- --name application_domains && bun run db:migrations:check`

- [ ] **Step 6: Run focused tests**

Run: `bun test server/persistence/core/schema/application-domains.bun_spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/persistence/core
git commit -m "feat: normalize application persistence domains"
```

---

### Task 7: Build The Legacy Snapshot Reader And Deterministic Identity Planner

**Files:**
- Create: `server/persistence/legacy/snapshot-reader.ts`
- Create: `server/persistence/legacy/identity-plan.ts`
- Create: `server/persistence/legacy/semantic-snapshot.ts`
- Create: `server/persistence/legacy/identity-plan.test.ts`
- Create: `server/persistence/legacy/snapshot-reader.test.ts`
- Modify: `server/db/store.mjs`

**Interfaces:**
- Produces: `readLatestLegacySnapshot(dataDir)`, `buildCanonicalIdentityPlan(snapshot)`, and `legacySemanticSnapshot(snapshot)`.
- Consumes: existing schema 0-29 pure migration functions and validators.

- [ ] **Step 1: Write failing deterministic-ID tests**

```ts
const first = buildCanonicalIdentityPlan(snapshot)
const second = buildCanonicalIdentityPlan(structuredClone(snapshot))
expect(second).toEqual(first)
expect(first.items.get('server:1')).toBe(1)
expect(new Set(first.items.values()).size).toBe(first.items.size)
```

Test inventory, nested ports, endpoints, resource groups, physical slots, agents, registry links, assignments, and connections. Add explicit collision and ambiguous-reference failure cases.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `bun test server/persistence/legacy/*.test.ts`

Expected: FAIL because the reader and planner are absent.

- [ ] **Step 3: Extract legacy upgrades into import-only transforms**

Keep existing schema migrations pure and callable without opening LowDB. The reader loads all legacy files, upgrades them to schema 29 in memory, normalizes optional stores, and validates the complete graph without writing source files.

- [ ] **Step 4: Implement deterministic identity planning**

Use the fixed `INVENTORY_TYPES` order followed by ascending legacy ID. Allocate nested port, endpoint, resource-group, slot, and remaining domain IDs deterministically. Return immutable maps used by all importers.

- [ ] **Step 5: Implement semantic snapshots**

Produce canonical count, capacity, topology, identity, assignment, placement, connection, authentication, registry, agent, notification, and settings summaries. Exclude timestamps that are expected to change during migration.

- [ ] **Step 6: Run legacy migration tests**

Run: `bun test server/persistence/legacy/*.test.ts server/db/migrate-schema-*.test.mjs server/db/store.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/persistence/legacy server/db/store.mjs
git commit -m "refactor: isolate legacy persistence import"
```

---

### Task 8: Import Legacy Core Data Into Normalized SQLite

**Files:**
- Create: `server/persistence/migration/core-importer.ts`
- Create: `server/persistence/migration/core-verifier.ts`
- Create: `server/persistence/migration/core-importer.bun_spec.ts`
- Create: `server/persistence/fixtures/schema-29-production-shape.ts`

**Interfaces:**
- Produces: `importLegacyCore({ database, snapshot, identityPlan })` and `verifyImportedCore({ database, expected })`.
- Consumes: schema, canonical unit adapters, identity plan, and semantic snapshot from Tasks 3-7.

- [ ] **Step 1: Write a failing production-shaped import test**

```ts
const result = importLegacyCore({ database, snapshot, identityPlan })
expect(result.projectId).toBe(1)
expect(result.systemsWorkspaceId).toBe(1)
expect(result.canvasWorkspaceId).toBe(2)
expect(verifyImportedCore({ database, expected: legacySemanticSnapshot(snapshot) })).toEqual({ ok: true })
```

Assert record counts, capacities, aliases, exact assignments, connections, placements, manual bends, route cache, registry state, agent state, authentication, notifications, and settings.

- [ ] **Step 2: Run the import test and verify failure**

Run: `bun test server/persistence/migration/core-importer.bun_spec.ts`

Expected: FAIL because no importer exists.

- [ ] **Step 3: Implement dependency-ordered inserts**

Insert vocabularies, project `1`, Systems `1`, Canvas `2`, parent inventory rows, subtype rows, resources, ports, memberships, assignments, placements, connections, bends, registry, agents, auth, notifications, and settings in one transaction. Convert supported measurements to canonical units and reject lossy conversions.

- [ ] **Step 4: Implement strict verification**

Compare the imported semantic snapshot to the legacy snapshot, run `foreign_key_check` and `quick_check`, and reject leftover supported fields in extensions.

- [ ] **Step 5: Run focused and schema tests**

Run: `bun test server/persistence/migration/core-importer.bun_spec.ts server/persistence/core/**/*.bun_spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/persistence/migration server/persistence/fixtures
git commit -m "feat: import legacy core data into SQLite"
```

---

### Task 9: Migrate Telemetry References And Rebuild Catalog Safely

**Files:**
- Modify: `server/telemetry/schema.mjs`
- Modify: `server/telemetry/database.mjs`
- Modify: `server/telemetry/repository.mjs`
- Create: `server/persistence/migration/telemetry-importer.ts`
- Create: `server/persistence/migration/telemetry-importer.bun_spec.ts`
- Modify: `server/registry/catalog-index.mjs`
- Create: `server/persistence/migration/catalog-rebuilder.ts`
- Create: `server/persistence/migration/catalog-rebuilder.bun_spec.ts`

**Interfaces:**
- Produces: `migrateTelemetryReferences({ sourcePath, targetPath, identityPlan })` and `rebuildVerifiedCatalog({ snapshotService, targetPath })`.
- Consumes: canonical host and agent IDs from Task 7.

- [ ] **Step 1: Write failing telemetry rekey tests**

Seed telemetry using `server:7`, migrate it, and assert every sample/latest/event row uses the canonical host and agent IDs while counts, sequences, timestamps, and payload hashes remain unchanged.

- [ ] **Step 2: Write failing catalog rebuild tests**

Seed a signed snapshot, rebuild to staging, verify FTS/facets/template counts, and prove the existing catalog file is unchanged if verification fails.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `bun test server/persistence/migration/telemetry-importer.bun_spec.ts server/persistence/migration/catalog-rebuilder.bun_spec.ts`

- [ ] **Step 4: Normalize telemetry schema**

Add canonical host metrics, network, storage, filesystem, service/container/virtualization events, latest-state tables, full manual inventory reports, normalized components, and suggestion tables. Retain the latest five complete manual reports per host.

- [ ] **Step 5: Implement staged telemetry migration and catalog rebuild**

Never mutate the active telemetry or catalog file in place. Clone/rebuild to staging, verify independent schema versions, counts, integrity, signed hashes, and file modes, then return activation-ready paths.

- [ ] **Step 6: Run telemetry and registry suites**

Run: `bun test server/telemetry/*.bun_spec.mjs server/persistence/migration/*telemetry* server/persistence/migration/*catalog* server/registry/*.bun_spec.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/telemetry server/registry/catalog-index.mjs server/persistence/migration
git commit -m "feat: migrate telemetry and catalog persistence"
```

---

### Task 10: Implement Atomic Persistence Cutover And Recovery

**Files:**
- Create: `server/persistence/migration/cutover.ts`
- Create: `server/persistence/migration/activation-marker.ts`
- Create: `server/persistence/migration/cutover.bun_spec.ts`
- Create: `server/persistence/migration/crash-fixtures.ts`
- Modify: `server/index.mjs`

**Interfaces:**
- Produces: `ensureSqlitePersistence({ dataDir, appVersion, legacyProjectPath, seedDir, backupServiceFactory })` returning active managed database paths and migration status.
- Consumes: importers and verifiers from Tasks 7-9.

- [ ] **Step 1: Write interruption tests for every stage**

```ts
for (const stage of CUTOVER_STAGES) {
  await expect(runWithInjectedFailure(stage)).rejects.toThrow(stage)
  expect(await sourceLowDbHashes()).toEqual(beforeHashes)
  expect(await activationMarker()).toBeNull()
}
```

Also prove lock staleness rules, exact retry from clean staging, successful restart idempotency, and refusal to open a newer SQLite schema.

- [ ] **Step 2: Run the cutover tests and verify failure**

Run: `bun test server/persistence/migration/cutover.bun_spec.ts`

- [ ] **Step 3: Implement lock, backup, staging, and activation**

Use `/data/.sqlite-migration.lock`, unique `/data/.sqlite-migration/<uuid>` staging, a verified complete `.hlibackup`, and `/data/databases/persistence-engine.json`. Write the marker only after all three staged databases reopen and verify successfully.

- [ ] **Step 4: Implement failure behavior**

Discard staging on failure, retain the pre-migration backup and untouched LowDB files, expose the exact failed stage through persistence health, and refuse authoritative writes. Never continue from a partially populated database.

- [ ] **Step 5: Integrate startup without switching the store yet**

Call `ensureSqlitePersistence` before application services initialize, but keep route traffic on the legacy store until Task 14 activates the SQLite facade. This creates and verifies shadow SQLite data for parity tests without double-writing.

- [ ] **Step 6: Run cutover and startup tests**

Run: `bun test server/persistence/migration/cutover.bun_spec.ts server/app-health.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/persistence/migration server/index.mjs
git commit -m "feat: add verified SQLite cutover"
```

---

### Task 11: Build Relational Repositories And Legacy Read Projection

**Files:**
- Create: `server/persistence/core/repositories/project-repository.ts`
- Create: `server/persistence/core/repositories/inventory-repository.ts`
- Create: `server/persistence/core/repositories/topology-repository.ts`
- Create: `server/persistence/core/repositories/routing-repository.ts`
- Create: `server/persistence/core/repositories/registry-repository.ts`
- Create: `server/persistence/core/repositories/agent-repository.ts`
- Create: `server/persistence/core/repositories/auth-repository.ts`
- Create: `server/persistence/core/repositories/notification-repository.ts`
- Create: `server/persistence/core/repositories/backup-repository.ts`
- Create: `server/persistence/core/projections/legacy-project.ts`
- Create: `server/persistence/core/repositories/repositories.bun_spec.ts`

**Interfaces:**
- Produces: focused repositories and `buildLegacyProjectProjection({ projectId })`.
- Consumes: Drizzle schema and managed database from Tasks 2-6.

- [ ] **Step 1: Write repository contract tests**

Test CRUD, archive/restrict behavior, item/project/workspace revisions, canonical aliases, exact slots, port availability, connection insertion, and route cache writes. Assert a route-cache write does not change project or workspace revision.

- [ ] **Step 2: Write projection parity test**

```ts
expect(buildLegacyProjectProjection({ projectId: 1 })).toEqual(expectedLegacyProject)
```

The expected projection must match existing API keys, category types, item map, placements, assignments, connections, compatibility policy, and fixed route sides.

- [ ] **Step 3: Run tests and verify failure**

Run: `bun test server/persistence/core/repositories/repositories.bun_spec.ts`

- [ ] **Step 4: Implement repositories with prepared hot queries**

Use Drizzle for ordinary writes and joins. Use direct prepared statements only for measured projection or bulk paths. Repositories return domain records, not Drizzle rows.

- [ ] **Step 5: Implement the read-only legacy projection**

Assemble only project `1` and its active Canvas into the existing `ProjectState` shape. Do not expose mutable arrays or a synthetic `databases` object.

- [ ] **Step 6: Run repository and current validation suites**

Run: `bun test server/persistence/core/repositories/repositories.bun_spec.ts && bunx vitest run server/db/validation.test.mjs`

- [ ] **Step 7: Commit**

```bash
git add server/persistence/core/repositories server/persistence/core/projections
git commit -m "feat: add relational persistence repositories"
```

---

### Task 12: Remove Direct LowDB Access From Routes And Services

**Files:**
- Modify: `server/agent-routes.mjs`
- Modify: `server/agents/v1-routes.mjs`
- Modify: `server/registry-routes.mjs`
- Modify: `server/index.mjs`
- Modify: `server/telemetry/backup-service.bun_spec.mjs`
- Modify: route tests adjacent to each modified route
- Create: `server/persistence/store-contract.ts`

**Interfaces:**
- Produces: `HomelabInventoryPersistence` interface used by routes and services.
- Consumes: repositories from Task 11.

- [ ] **Step 1: Add the architectural guard test**

```ts
test('production routes never access mutable store databases', async () => {
  expect(await sourceMatches('server/**/*.mjs', /store\.databases\./)).toEqual([])
})
```

Allow the pattern only inside `server/persistence/legacy` and legacy tests.

- [ ] **Step 2: Run the guard and verify failure**

Run: `bun test server/persistence/store-contract.bun_spec.ts`

Expected: FAIL with existing agent, registry, health, and test consumers.

- [ ] **Step 3: Define store contract methods**

Include explicit methods for agent enrollment/device lookup and mutation, hardware reports, latest agent status, metadata/schema health, registry variant lookup, auth snapshot, backup snapshot, and transactional domain writes. Every mutation must be atomic and return its committed record or projection.

- [ ] **Step 4: Refactor agent and registry routes**

Replace direct collection mutation with repository-backed store methods. Preserve response bodies, status codes, enrollment signatures, heartbeat ordering, and registry delivery behavior.

- [ ] **Step 5: Refactor health and tests**

Use `store.getDatabaseStatus()` rather than reading meta JSON. Replace tests that seed direct arrays with repository fixture helpers.

- [ ] **Step 6: Run route and guard tests**

Run: `bun test server/persistence/store-contract.bun_spec.ts && bunx vitest run server/agent-routes.test.mjs server/agents/v1-routes.test.mjs server/registry-routes.test.mjs`

Expected: PASS and no production `store.databases.*` access.

- [ ] **Step 7: Commit**

```bash
git add server/agent-routes.mjs server/agents server/registry-routes.mjs server/index.mjs server/persistence server/**/*test.mjs
git commit -m "refactor: isolate persistence behind repositories"
```

---

### Task 13: Implement SQLite Store Facade And Command Parity

**Files:**
- Create: `server/persistence/sqlite-store.ts`
- Create: `server/persistence/sqlite-store.bun_spec.ts`
- Modify: `server/db/inventory-commands.test.mjs`
- Modify: `server/db/catalog-update-lifecycle.test.mjs`
- Modify: `server/engine/command-service.mjs`
- Modify: `server/engine/sse-hub.mjs`

**Interfaces:**
- Produces: `SqliteHomelabInventoryStore` implementing `HomelabInventoryPersistence` and current store methods.
- Consumes: repositories and legacy projection from Task 11.

- [ ] **Step 1: Parameterize current command tests**

Run the inventory lifecycle, project command, catalog update, onboarding, routing cache, registry, auth, and notification behavioral suites against both the legacy implementation and `SqliteHomelabInventoryStore` until cutover.

- [ ] **Step 2: Run the SQLite matrix and verify failure**

Run: `bun test server/persistence/sqlite-store.bun_spec.ts server/db/inventory-commands.test.mjs server/db/catalog-update-lifecycle.test.mjs`

- [ ] **Step 3: Implement read and mutation compatibility**

Support `getProject`, `setProject`, inventory lifecycle methods, registry transactions, auth transactions, backup state, onboarding, engine snapshots, routing cache, persistence health, flush/close, and project commit subscriptions. Translate submitted legacy project snapshots into targeted relational diffs inside one SQLite transaction.

- [ ] **Step 4: Implement scoped revisions**

Use item, project, and workspace revisions internally. Continue emitting the current project revision in the compatibility projection. Route cache updates do not advance authoritative revisions.

- [ ] **Step 5: Run parity suites**

Run: `bun test server/persistence/sqlite-store.bun_spec.ts server/db/*.test.mjs server/registry/*.bun_spec.mjs server/auth/*.bun_spec.mjs`

Expected: both implementations pass the same observable behavior.

- [ ] **Step 6: Commit**

```bash
git add server/persistence/sqlite-store.ts server/persistence/sqlite-store.bun_spec.ts server/db server/engine
git commit -m "feat: provide SQLite store compatibility facade"
```

---

### Task 14: Add Bounded L1 Cache And Revision-Aware Read Models

**Files:**
- Create: `server/persistence/cache/cache-store.ts`
- Create: `server/persistence/cache/memory-cache.ts`
- Create: `server/persistence/cache/memory-cache.test.ts`
- Create: `server/persistence/core/read-model/workspace-read-model.ts`
- Create: `server/persistence/core/read-model/workspace-read-model.bun_spec.ts`
- Modify: `server/persistence/sqlite-store.ts`

**Interfaces:**
- Produces: `CacheStore`, `MemoryCacheStore`, `buildWorkspaceReadModel(input)`, and tag invalidation.
- Consumes: project/workspace/item revisions and repositories.

- [ ] **Step 1: Write failing cache tests**

Test 64 MiB size enforcement, LRU eviction, TTL, tag invalidation, no secret-bearing keys, full clear, and cache-miss rebuilding.

- [ ] **Step 2: Write read-model invalidation tests**

Assert item edits invalidate only item/member projections, workspace movement invalidates one workspace, project topology changes invalidate member Canvas projections, and route-cache writes invalidate nothing authoritative.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `bun test server/persistence/cache/*.test.ts server/persistence/core/read-model/*.bun_spec.ts`

- [ ] **Step 4: Implement cache and read model**

Use revision-bearing keys such as `workspace-read-model:project=1:workspace=2:projectRev=42:workspaceRev=18`. Track approximate serialized bytes and reject values larger than the cache budget rather than evicting the entire cache.

- [ ] **Step 5: Add cache diagnostics**

Expose hit, miss, eviction, entry, and byte counts through persistence diagnostics. Never include values or private keys.

- [ ] **Step 6: Run focused tests**

Run: `bun test server/persistence/cache/*.test.ts server/persistence/core/read-model/*.bun_spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/persistence/cache server/persistence/core/read-model server/persistence/sqlite-store.ts
git commit -m "perf: add bounded relational read cache"
```

---

### Task 15: Convert Backup And Restore To Logical SQLite Sections

**Files:**
- Modify: `shared/backup/contract.mjs`
- Modify: `server/backup/backup-sections.mjs`
- Modify: `server/backup/restore-preflight.mjs`
- Modify: `server/backup/backup-service.mjs`
- Create: `server/backup/sqlite-section-exporter.ts`
- Create: `server/backup/sqlite-restore-staging.ts`
- Create: `server/backup/sqlite-backup.bun_spec.ts`

**Interfaces:**
- Produces: backup format v2 logical sections, staging restore, and internal exact SQLite snapshots.
- Consumes: repository exports, database bundle, protected identity files, and cross-database operation journal.

- [ ] **Step 1: Write failing complete and selective restore tests**

Cover complete backup, inventory-only replacement, routing-cache-only replacement, registry-enrollment replacement, authentication, agents, telemetry, catalog state, missing dependencies, ID collisions, foreign-key violations, protected identity modes, and rollback after interrupted activation.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `bun test server/backup/sqlite-backup.bun_spec.ts && bunx vitest run server/backup/*.test.mjs`

- [ ] **Step 3: Implement logical section exporters**

Export canonical IDs and independent core/telemetry/catalog schema versions. Continue reading format v1 LowDB archives through the legacy transformer. Complete and registry-enrollment sections include `installation-instance.json`, signing key, and credentials.

- [ ] **Step 4: Implement staging restore**

Clone all active databases, replace selected sections in foreign-key order, require dependencies during preflight, run semantic checks plus `foreign_key_check` and `quick_check`, create an encrypted complete pre-restore backup, then atomically activate.

- [ ] **Step 5: Implement internal exact snapshots**

Use coherent SQLite serialization under a short write barrier for migration rollback and disaster recovery. Do not expose raw databases through the user export API.

- [ ] **Step 6: Run backup suites**

Run: `bun test server/backup/sqlite-backup.bun_spec.ts && bunx vitest run server/backup/*.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add shared/backup server/backup
git commit -m "feat: migrate backup and restore to SQLite"
```

---

### Task 16: Activate SQLite In Production And Remove Active LowDB Runtime

**Files:**
- Modify: `server/index.mjs`
- Modify: `server/demo/session-manager.mjs`
- Modify: `server/db/store.mjs`
- Move: `server/db/store.mjs` legacy implementation to `server/persistence/legacy/legacy-store.mjs`
- Modify: `server/app-health.mjs`
- Modify: `server/app-health.test.mjs`
- Modify: `Dockerfile`
- Modify: `.dockerignore`

**Interfaces:**
- Produces: SQLite-only production and demo runtime after activation.
- Consumes: cutover, SQLite store facade, backup, telemetry, catalog, and cache services.

- [ ] **Step 1: Write startup activation tests**

Test fresh production setup, migrated setup, successful restart, failed migration health, demo isolation, no production identity in demo, no active LowDB writes after activation, and graceful WAL checkpoint on shutdown.

- [ ] **Step 2: Run startup tests and verify failure**

Run: `bunx vitest run server/demo/session-manager.test.mjs server/app-health.test.mjs && bun test server/persistence/migration/cutover.bun_spec.ts`

- [ ] **Step 3: Switch runtime store construction**

After `ensureSqlitePersistence`, instantiate only `SqliteHomelabInventoryStore`. Retain the legacy class only for migration import and legacy backup tests. Remove `lowdb` from runtime dependencies after proving no production import remains.

- [ ] **Step 4: Update health and shutdown**

Report persistence engine plus independent schema versions and integrity status. On shutdown, drain writes, use passive/truncate checkpoints as designed, clear L1, and close all handles.

- [ ] **Step 5: Preserve demo semantics**

Each demo session receives isolated ephemeral SQLite files, connected catalog mode, immutable disabled contributions, no enrollment files, and complete cleanup at session expiry.

- [ ] **Step 6: Run startup and full backend suites**

Run: `bun run test:auth && bun run test:sqlite && bunx vitest run server`

Expected: PASS and no active runtime LowDB import.

- [ ] **Step 7: Commit**

```bash
git add server Dockerfile .dockerignore package.json bun.lock
git commit -m "feat: activate SQLite persistence"
```

---

### Task 17: Prove Semantic Parity, Performance, And Recovery

**Files:**
- Create: `scripts/benchmark-sqlite-persistence.mjs`
- Create: `scripts/benchmark-sqlite-persistence.bun_spec.mjs`
- Create: `server/persistence/parity/current-data-parity.bun_spec.ts`
- Create: `server/persistence/parity/recovery-matrix.bun_spec.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: repeatable migration, bootstrap, command, cache, memory, and recovery reports.
- Consumes: a copied data directory supplied by path; never writes the source.

- [ ] **Step 1: Add parity tests**

Compare source and migrated semantic snapshots, including counts, capacities, topology hash, registry identity projection, protected identity file hashes, auth counts, notification counts, telemetry counts, and catalog revision.

- [ ] **Step 2: Add performance assertions**

Measure no more than three initial API bootstrap requests, warm workspace server load at or below 250 ms, typical commands at or below 100 ms, no route recomputation on valid cache hydration, and L1 memory at or below 64 MiB.

- [ ] **Step 3: Add recovery matrix**

Exercise process termination during migration, backup, restore, catalog activation, telemetry cleanup, and shutdown. Each restart must complete or fail at an explicit durable stage without duplicate rows.

- [ ] **Step 4: Run parity against copied local data**

Run: `bun scripts/benchmark-sqlite-persistence.mjs --source ./data --output /tmp/hli-sqlite-parity`

Expected: source remains byte-identical; migrated semantic parity passes.

- [ ] **Step 5: Run focused suites**

Run: `bun test scripts/benchmark-sqlite-persistence.bun_spec.mjs server/persistence/parity/*.bun_spec.ts`

- [ ] **Step 6: Commit**

```bash
git add scripts/benchmark-sqlite-persistence* server/persistence/parity package.json
git commit -m "test: prove SQLite migration parity"
```

---

### Task 18: Complete Documentation And Milestone Verification

**Files:**
- Modify: `CHANGELOG.md`
- Modify: structured Unreleased release-note draft under the repository's existing release-note path
- Create: `docs/SQLITE_MIGRATION.md`
- Modify: `README.md` only where persistence or backup behavior is documented
- Modify: `DOCKERHUB.md` only where persistence or backup behavior is documented

**Interfaces:**
- Produces: user migration/recovery guidance and consolidated Unreleased notes.
- Consumes: final behavior and benchmark results from Tasks 1-17.

- [ ] **Step 1: Document automatic migration**

Include prerequisites, verified backup location, normal startup, progress, health diagnostics, rollback to the previous image, SQLite file paths, permissions, and the rule that original LowDB files are not active after successful activation.

- [ ] **Step 2: Document backup compatibility**

Explain format v1 import, format v2 export, selective restore dependencies, internal exact snapshots, protected identity handling, and future PostgreSQL portability.

- [ ] **Step 3: Consolidate Unreleased notes**

Add one SQLite-foundation feature group covering relational validation, automatic migration, cache behavior, backup compatibility, and data-safety guarantees. Do not create a versioned entry.

- [ ] **Step 4: Run the complete verification set**

```bash
bun run db:migrations:check
bun run lint
bun run test
bun run build
bun run security:container
```

Expected: all checks pass; Docker Scout and Trivy report zero vulnerabilities on AMD64 and ARM64 final distroless images.

- [ ] **Step 5: Review repository safety**

Run:

```bash
git status --short
git diff --check
git ls-files | rg '(^|/)data/|\.env$|installation-ed25519|installation-credentials|\.sqlite(-wal|-shm)?$' && exit 1 || true
```

Expected: no runtime data, identities, credentials, SQLite files, or private screenshots are tracked.

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md README.md DOCKERHUB.md docs/SQLITE_MIGRATION.md src/release-notes.ts
git commit -m "docs: explain SQLite persistence migration"
```

## Milestone Exit Criteria

- Production and demo run exclusively on SQLite after activation.
- LowDB remains only as an import-only legacy reader.
- Current UI and APIs behave identically for the migrated Default Project.
- Current data migrates with semantic parity and no source-file changes.
- Restart, rollback, complete backup, and selective restore are proven.
- Valid route cache hydrates without rerouting.
- Core, telemetry, and catalog schema versions report independently.
- No direct production access to `store.databases.*.data` remains.
- Full lint, test, build, migration-check, and container-security suites pass.
- No version, tag, push, or deployment occurs.
