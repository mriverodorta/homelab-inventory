import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CORE_MIGRATIONS } from '../persistence/core/migrations/manifest.ts'
import { schema29ProductionShapeFixture } from '../persistence/fixtures/schema-29-production-shape.ts'
import { buildCanonicalIdentityPlan } from '../persistence/legacy/identity-plan.ts'
import { importLegacyCore } from '../persistence/migration/core-importer.ts'
import { openManagedDatabase } from '../persistence/sqlite/database.ts'
import { applyCommittedMigrations } from '../persistence/sqlite/migrator.ts'
import { SqliteHomelabInventoryStore } from '../persistence/sqlite-store.ts'
import { CompatibilityAuditService } from './audit-service.mjs'

const roots: string[] = []
const stores: SqliteHomelabInventoryStore[] = []

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixtureStore() {
  const root = await mkdtemp(join(tmpdir(), 'homelab-inventory-compatibility-audit-'))
  roots.push(root)
  const handle = await openManagedDatabase({ filePath: join(root, 'core.sqlite'), schemaName: 'core' })
  await applyCommittedMigrations(handle, await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
    id: migration.id,
    sha256: migration.sha256,
    sql: await readFile(resolve(import.meta.dir, '../persistence/core/migrations/generated', migration.file), 'utf8'),
  }))))
  const snapshot = schema29ProductionShapeFixture()
  snapshot.project.compatibilityPolicy.disabledHosts = []
  delete snapshot.inventory.servers[0].compatibility.host.cpu.maxTdpWatts
  importLegacyCore({
    database: handle.database,
    snapshot,
    identityPlan: buildCanonicalIdentityPlan(snapshot),
  })
  const store = new SqliteHomelabInventoryStore({ core: handle })
  stores.push(store)
  return store
}

async function migrationFixtureStore() {
  const root = await mkdtemp(join(tmpdir(), 'homelab-inventory-compatibility-migration-'))
  roots.push(root)
  const handle = await openManagedDatabase({ filePath: join(root, 'core.sqlite'), schemaName: 'core' })
  const migrationDefinitions = async (migrations = CORE_MIGRATIONS) => Promise.all(
    migrations.map(async (migration) => ({
      id: migration.id,
      sha256: migration.sha256,
      sql: await readFile(
        resolve(import.meta.dir, '../persistence/core/migrations/generated', migration.file),
        'utf8',
      ),
    })),
  )
  await applyCommittedMigrations(
    handle,
    await migrationDefinitions(CORE_MIGRATIONS.slice(0, -1)),
  )
  const snapshot = schema29ProductionShapeFixture()
  snapshot.project.compatibilityPolicy.disabledHosts = []
  snapshot.inventory.servers[0].name = 'Dell OptiPlex Micro 7010'
  snapshot.inventory.servers[0].manufacturer = 'Dell'
  snapshot.inventory.servers[0].model = 'OptiPlex Micro 7010'
  snapshot.inventory.servers[0].serialNumber = 'PRIVATE-SERIAL'
  snapshot.inventory.servers[0].notes = 'Private migration invariant'
  snapshot.inventory.servers[0].compatibility.host.cpu = {
    sockets: ['LGA1700'],
    generations: ['12th Gen', '13th Gen'],
    maxTdpWatts: 35,
    socketCount: 1,
  }
  snapshot.inventory.cpus[0].name = 'Intel Core i7-12700T'
  snapshot.inventory.cpus[0].manufacturer = 'Intel'
  snapshot.inventory.cpus[0].family = 'Core i7'
  snapshot.inventory.cpus[0].number = 'i7-12700T'
  snapshot.inventory.cpus[0].compatibility.requirements.cpu = {
    socket: 'LGA1700',
    generation: '12th Gen',
    tdpWatts: 35,
  }
  importLegacyCore({
    database: handle.database,
    snapshot,
    identityPlan: buildCanonicalIdentityPlan(snapshot),
  })
  handle.database.query('DELETE FROM compatibility_audit_dirty_hosts').run()

  const host = handle.database.query(`
    SELECT item.id
    FROM inventory_items item
    JOIN inventory_identity_aliases alias ON alias.item_id = item.id
    WHERE alias.legacy_type_key = 'server' AND alias.legacy_id = 7
  `).get() as { id: number }
  const cpu = handle.database.query(`
    SELECT item.id
    FROM inventory_items item
    JOIN inventory_identity_aliases alias ON alias.item_id = item.id
    WHERE alias.legacy_type_key = 'cpu' AND alias.legacy_id = 3
  `).get() as { id: number }
  handle.database.query(`
    INSERT INTO compatibility_audit_findings (
      project_id, host_item_id, component_item_id, assignment_id,
      finding_key, rule_key, severity, classification, message, details_json,
      first_seen_at_ms, last_seen_at_ms
    ) VALUES (1, ?, ?, 1, 'stale-cpu-generation', 'cpu.generation.unsupported',
      'error', 'actionable', 'Stale evaluator-v1 finding.', '{}', 1, 1)
  `).run(host.id, cpu.id)

  const allMigrations = await migrationDefinitions()
  await applyCommittedMigrations(handle, allMigrations)
  const store = new SqliteHomelabInventoryStore({ core: handle })
  stores.push(store)
  return {
    store,
    hostItemId: host.id,
    reapplyMigrations: () => applyCommittedMigrations(handle, allMigrations),
  }
}

describe('canonical compatibility audit service', () => {
  test('drains successful reconciliation batches without polling or retrying failures', async () => {
    const store = {} as SqliteHomelabInventoryStore
    const service = new CompatibilityAuditService()
    const results = [
      { claimed: 100, evaluated: 100, failed: 0 },
      { claimed: 1, evaluated: 1, failed: 0 },
    ]
    const calls: unknown[] = []
    service.reconcile = ((_store: unknown, options: unknown) => {
      calls.push(options)
      return results.shift() ?? { claimed: 0, evaluated: 0, failed: 0 }
    }) as typeof service.reconcile

    service.schedule(store)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(calls).toEqual([{ limit: 100 }, { limit: 100 }])
  })

  test('persists a missing legacy allocation only when its destination is deterministic', async () => {
    const store = await fixtureStore()
    const database = store.core.database
    const assignment = database.query(`
      SELECT id, host_item_id FROM component_assignments WHERE id = 3
    `).get() as { id: number; host_item_id: number }
    const topologyBefore = JSON.stringify({
      placements: database.query('SELECT * FROM workspace_placements ORDER BY id').all(),
      connections: database.query('SELECT * FROM project_connections ORDER BY id').all(),
      routes: database.query('SELECT * FROM workspace_route_cache ORDER BY id').all(),
    })
    database.query('DELETE FROM component_assignment_slots WHERE assignment_id = 3').run()
    database.query('UPDATE component_assignments SET resource_slot_id = NULL WHERE id = 3').run()

    const service = new CompatibilityAuditService({ now: () => 3_000 })
    service.markHostDirty(store, { projectId: 1, hostItemId: assignment.host_item_id, reason: 'legacy-allocation' })
    expect(service.reconcile(store)).toEqual({ claimed: 1, evaluated: 1, failed: 0 })

    expect(database.query(`
      SELECT slot.position, groups.resource_type, alias.legacy_resource_group_id
      FROM component_assignments assignment
      JOIN host_resource_slots slot ON slot.id = assignment.resource_slot_id
      JOIN host_resource_groups groups ON groups.id = slot.resource_group_id
      JOIN resource_identity_aliases alias ON alias.resource_id = groups.resource_identity_id
      WHERE assignment.id = 3
    `).get()).toEqual({ position: 1, resource_type: 'storage', legacy_resource_group_id: 1 })
    expect(JSON.stringify({
      placements: database.query('SELECT * FROM workspace_placements ORDER BY id').all(),
      connections: database.query('SELECT * FROM project_connections ORDER BY id').all(),
      routes: database.query('SELECT * FROM workspace_route_cache ORDER BY id').all(),
    })).toBe(topologyBefore)
  })

  test('persists actionable and informational findings once and resolves stale rows', async () => {
    const store = await fixtureStore()
    const database = store.core.database
    const host = database.query(`
      SELECT item.id
      FROM inventory_items item
      JOIN inventory_item_types type ON type.id = item.type_id
      WHERE type.key = 'server' LIMIT 1
    `).get() as { id: number }
    const events: unknown[] = []
    const service = new CompatibilityAuditService({ now: () => 2_000, onChanged: (_store, event) => events.push(event) })

    service.markHostDirty(store, { projectId: 1, hostItemId: host.id, reason: 'test' })
    expect(service.reconcile(store)).toEqual({ claimed: 1, evaluated: 1, failed: 0 })

    const actionable = service.findings(store, { projectId: 1, classification: 'actionable' })
    const informational = service.findings(store, { projectId: 1, classification: 'informational' })
    expect(actionable).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleKey: 'memory.speed.negotiated', classification: 'actionable' }),
    ]))
    expect(informational.length).toBeGreaterThan(0)
    expect(informational.every((finding) => finding.severity === 'info')).toBe(true)
    expect(informational).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ details: expect.objectContaining({ field: 'component.memory.ecc' }) }),
    ]))
    expect(events).toHaveLength(1)

    const ignoredFinding = actionable[0]
    service.setIgnored(store, { projectId: 1, findingId: ignoredFinding.id, ignored: true })
    expect(service.findings(store, { projectId: 1, visibility: 'open' }))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: ignoredFinding.id })]))
    expect(service.findings(store, { projectId: 1, visibility: 'ignored' }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: ignoredFinding.id, ignored: true })]))

    service.markHostDirty(store, { projectId: 1, hostItemId: host.id, reason: 'repeat' })
    expect(service.reconcile(store)).toEqual({ claimed: 1, evaluated: 1, failed: 0 })
    expect(database.query(`
      SELECT finding_key, count(*) AS count
      FROM compatibility_audit_findings
      GROUP BY finding_key HAVING count(*) > 1
    `).all()).toEqual([])
    expect(service.findings(store, { projectId: 1, visibility: 'ignored' }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: ignoredFinding.id })]))

    database.query(`UPDATE project_compatibility_policies SET policy_json = ? WHERE project_id = 1`)
      .run(JSON.stringify({
        disabledHosts: [{ hostType: 'server', hostId: 7 }],
        ignoredWarningIds: [],
      }))
    service.markHostDirty(store, { projectId: 1, hostItemId: host.id, reason: 'disabled' })
    expect(service.reconcile(store)).toEqual({ claimed: 1, evaluated: 1, failed: 0 })
    expect(service.findings(store, { projectId: 1 })).toEqual([])
    expect(database.query(`
      SELECT count(*) AS count FROM compatibility_audit_findings
      WHERE resolved_at_ms IS NULL
    `).get()).toEqual({ count: 0 })
  })

  test('rebuilds evaluator-v1 findings without changing application state', async () => {
    const { store, hostItemId, reapplyMigrations } = await migrationFixtureStore()
    const database = store.core.database
    const preservedState = () => JSON.stringify({
      projects: database.query('SELECT * FROM projects ORDER BY id').all(),
      inventory: database.query('SELECT * FROM inventory_items ORDER BY id').all(),
      identities: database.query('SELECT * FROM inventory_identity_aliases ORDER BY id').all(),
      assignments: database.query('SELECT * FROM component_assignments ORDER BY id').all(),
      assignmentSlots: database.query('SELECT * FROM component_assignment_slots ORDER BY id').all(),
      placements: database.query('SELECT * FROM workspace_placements ORDER BY id').all(),
      connections: database.query('SELECT * FROM project_connections ORDER BY id').all(),
      routes: database.query('SELECT * FROM workspace_route_cache ORDER BY id').all(),
      registryLinks: database.query('SELECT * FROM registry_links ORDER BY id').all(),
    })
    const before = preservedState()

    expect(database.query(`
      SELECT project_id, host_item_id, reason
      FROM compatibility_audit_dirty_hosts
    `).all()).toEqual([{
      project_id: 1,
      host_item_id: hostItemId,
      reason: 'workspace-topology-migration',
    }])

    const service = new CompatibilityAuditService({ now: () => 4_000 })
    expect(service.reconcile(store)).toEqual({ claimed: 1, evaluated: 1, failed: 0 })
    expect(database.query(`
      SELECT count(*) AS count
      FROM compatibility_audit_findings
      WHERE rule_key = 'cpu.generation.unsupported' AND resolved_at_ms IS NULL
    `).get()).toEqual({ count: 0 })
    expect(database.query(`
      SELECT engine_version
      FROM compatibility_audits
      ORDER BY id DESC LIMIT 1
    `).get()).toEqual({ engine_version: 'canonical-v2.cpu-alias-2' })
    expect(preservedState()).toBe(before)

    expect(await reapplyMigrations()).toEqual({ applied: 0, currentVersion: 33 })
    service.markHostDirty(store, {
      projectId: 1,
      hostItemId,
      reason: 'compatibility-evaluator-v2',
    })
    expect(database.query('SELECT count(*) AS count FROM compatibility_audit_dirty_hosts').get())
      .toEqual({ count: 1 })
    expect(service.reconcile(store)).toEqual({ claimed: 1, evaluated: 1, failed: 0 })
    expect(preservedState()).toBe(before)
  })
})
