import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  NAS_FINGERPRINT_VERSION,
  NETWORK_FINGERPRINT_VERSION,
  digestCatalogTemplate,
  type FingerprintVersion,
} from '../../packages/catalog-protocol/src/index.ts'
import { planHostAllocations } from '../../shared/compatibility/index.mjs'
import { CORE_MIGRATIONS } from './core/migrations/manifest.ts'
import { schema29ProductionShapeFixture } from './fixtures/schema-29-production-shape.ts'
import { buildCanonicalIdentityPlan } from './legacy/identity-plan.ts'
import { importLegacyCore } from './migration/core-importer.ts'
import { openManagedDatabase } from './sqlite/database.ts'
import { applyCommittedMigrations } from './sqlite/migrator.ts'
import { SqliteHomelabInventoryStore } from './sqlite-store.ts'
import nasV10Fixture from '../../packages/catalog-protocol/test/fixtures/server-specs-inventory-nas-v10.json'
import networkV11Fixture from '../../packages/catalog-protocol/test/fixtures/network/server-specs-inventory-network-v11.json'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixtureStore(configure?: (snapshot: ReturnType<typeof schema29ProductionShapeFixture>) => void) {
  const root = await mkdtemp(join(tmpdir(), 'homelab-inventory-sqlite-store-'))
  roots.push(root)
  const handle = await openManagedDatabase({ filePath: join(root, 'core.sqlite'), schemaName: 'core' })
  await applyCommittedMigrations(handle, await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
    id: migration.id,
    sha256: migration.sha256,
    sql: await readFile(resolve(import.meta.dir, 'core/migrations/generated', migration.file), 'utf8'),
  }))))
  const snapshot = schema29ProductionShapeFixture()
  configure?.(snapshot)
  importLegacyCore({ database: handle.database, snapshot, identityPlan: buildCanonicalIdentityPlan(snapshot) })
  return new SqliteHomelabInventoryStore({
    core: handle,
    appVersion: '0.12.0',
    now: () => Date.parse('2026-08-12T01:00:00.000Z'),
  })
}

async function emptyFixtureStore() {
  return fixtureStore((snapshot) => {
    for (const table of Object.keys(snapshot.inventory) as (keyof typeof snapshot.inventory)[]) {
      snapshot.inventory[table] = [] as never
    }
    snapshot.project.placements = []
    snapshot.project.assignments = []
    snapshot.project.connections = []
    snapshot.project.compatibilityPolicy = { disabledHosts: [], ignoredWarningIds: [] }
    snapshot.registry.links = []
    snapshot.routingCache.entries = []
    snapshot.agents.devices = {}
    snapshot.notificationState.incidents = []
    snapshot.notificationState.deliveryJobs = []
    snapshot.meta.onboarding = {
      status: 'available',
      walkthroughStep: 0,
      sampleBatchId: 0,
      sampleInventoryRefs: [],
      sampleAssignmentIds: [],
      sampleConnectionIds: [],
    }
  })
}

async function catalogTemplate(
  item: Record<string, unknown>,
  revision = 1,
  templateKey = 'cpu-example-cpu-200',
  fingerprintVersion?: FingerprintVersion,
) {
  const projection = await digestCatalogTemplate(item, { fingerprintVersion })
  return {
    templateKey,
    revision,
    fingerprintVersion: projection.fingerprintVersion,
    identityHash: projection.identityHash,
    contentHash: projection.contentHash,
    item: projection.item,
  }
}

describe('SQLite Homelab Inventory store facade', () => {
  test('persists the Registry update reconciliation marker across store instances', async () => {
    const store = await emptyFixtureStore()
    try {
      expect(store.getCatalogUpdateReconciliationVersion()).toBe(0)
      store.markCatalogUpdateReconciliationComplete(1)
      expect(store.getCatalogUpdateReconciliationVersion()).toBe(1)
      expect(() => store.markCatalogUpdateReconciliationComplete(0)).toThrow(/version is invalid/iu)
    } finally {
      store.close()
    }
  })

  test('opens and saves project-scoped workspaces without changing the default store identity', async () => {
    const store = await emptyFixtureStore()
    try {
      const created = store.createProject({ name: 'Downsize plan' })
      const projectId = created.project.id
      const canvasId = created.defaultWorkspaceId

      expect(store.projectId).toBe(1)
      expect(store.workspaceId).toBe(2)
      expect(store.listProjects().map(({ id }) => id)).toEqual([1, projectId])
      expect(store.getWorkspace(projectId, canvasId)).toMatchObject({
        id: String(projectId),
        metadata: { projectId, workspaceId: canvasId },
        placements: [],
      })

      const scoped = store.getWorkspace(projectId, canvasId)
      const saved = store.setWorkspace(projectId, canvasId, {
        ...scoped,
        metadata: { ...scoped.metadata, name: 'Compact topology' },
      })
      expect(saved.metadata).toMatchObject({
        name: 'Compact topology',
        projectId,
        workspaceId: canvasId,
      })
      expect(store.getProject().metadata.name).not.toBe('Compact topology')
      expect(() => store.getWorkspace(1, canvasId)).toThrow(/not found/iu)
    } finally {
      store.close()
    }
  })

  test('duplicates a clean project-bound inventory record without copying instance relationships', async () => {
    const store = await fixtureStore()
    try {
      const target = store.createProject({ name: 'Downsize plan' })
      const duplicated = store.duplicateInventoryToProject(
        1,
        target.project.id,
        { type: 'server', id: 7 },
      )
      const duplicate = duplicated.project.items[`server:${duplicated.item.id}`] as any
      expect(duplicate).toMatchObject({
        type: 'server',
        scope: 'project',
        ownerProjectId: target.project.id,
      })
      expect(duplicate.serialNumber).toBeUndefined()

      const canonical = store.core.database.query(`
        SELECT a.item_id AS itemId, item.serial_number AS serialNumber
        FROM inventory_identity_aliases a
        JOIN inventory_items item ON item.id = a.item_id
        WHERE a.legacy_type_key = ? AND a.legacy_id = ?
      `).get('server', duplicated.item.id) as { itemId: number; serialNumber: string | null }
      expect(canonical.serialNumber).toBeNull()
      expect(store.core.database.query('SELECT project_id FROM project_inventory_memberships WHERE item_id = ?').all(canonical.itemId))
        .toEqual([{ project_id: target.project.id }])
      expect(store.core.database.query('SELECT count(*) AS count FROM agent_host_bindings WHERE host_item_id = ?').get(canonical.itemId))
        .toEqual({ count: 0 })
      expect(store.core.database.query('SELECT count(*) AS count FROM registry_links WHERE item_id = ?').get(canonical.itemId))
        .toEqual({ count: 0 })
      expect(store.core.database.query('SELECT count(*) AS count FROM component_assignments WHERE project_id = ? AND (host_item_id = ? OR component_item_id = ?)').get(target.project.id, canonical.itemId, canonical.itemId))
        .toEqual({ count: 0 })
      expect(store.core.database.query('SELECT count(*) AS count FROM workspace_placements WHERE project_id = ? AND item_id = ?').get(target.project.id, canonical.itemId))
        .toEqual({ count: 0 })
    } finally {
      store.close()
    }
  })

  test('creates project-bound inventory by default through the scoped facade', async () => {
    const store = await emptyFixtureStore()
    try {
      const target = store.createProject({ name: 'New lab' })
      const project = store.createInventoryItemsForProject(target.project.id, {
        type: 'cpu',
        name: 'Planning CPU',
        serialNumber: 'local-only',
      })
      expect(project.items['cpu:1']).toMatchObject({
        name: 'Planning CPU',
        scope: 'project',
        ownerProjectId: target.project.id,
      })
      const row = store.core.database.query(`
        SELECT scope, owner_project_id AS ownerProjectId
        FROM inventory_items item
        JOIN inventory_identity_aliases alias ON alias.item_id = item.id
        WHERE alias.legacy_type_key = 'cpu' AND alias.legacy_id = 1
      `).get()
      expect(row).toEqual({ scope: 'project', ownerProjectId: target.project.id })
    } finally {
      store.close()
    }
  })

  test('projects relational state into the current engine contract', async () => {
    const store = await fixtureStore()
    try {
      const project = store.getProject()
      expect(project.revision).toBe(8)
      expect(project.assignments[2].allocation).toMatchObject({
        resourceType: 'storage',
        resourceKey: 'm2-storage',
        groupId: 1,
        positions: [0],
      })
      expect(store.getEngineSnapshot().topology.assignments[2].allocation).toEqual({
        resource_type: 'storage',
        group_id: 1,
        positions: [0],
      })
      expect(store.getDatabaseStatus()).toMatchObject({ schemaVersion: 20 })
      expect(store.getPersistenceHealth()).toMatchObject({ ok: true, engine: 'sqlite' })
    } finally {
      store.close()
    }
  })

  test('applies targeted engine patches atomically and emits one commit', async () => {
    const store = await fixtureStore()
    const commits: unknown[] = []
    const unsubscribe = store.subscribeToProjectCommits((event) => commits.push(event))
    try {
      const project = await store.applyEnginePatch({
        baseRevision: 8,
        patchSet: {
          revision: 9,
          inverse: {
            kind: 'patch-placements',
            payload: {
              upsert: [{ item: { item_type: 'server', id: 7 }, x: 120, y: 240 }],
              remove_items: [],
            },
          },
          forward: {
            kind: 'patch-placements',
            payload: {
              upsert: [{ item: { item_type: 'server', id: 7 }, x: 144, y: 252 }],
              remove_items: [],
            },
          },
        },
        responseBytes: Uint8Array.from([1, 2, 3]),
      })

      expect(project.revision).toBe(9)
      expect(project.placements).toContainEqual({ serverId: 'server:7', x: 144, y: 252 })
      expect(commits).toEqual([{
        type: 'project-commit',
        baseRevision: 8,
        revision: 9,
        responseBytes: Uint8Array.from([1, 2, 3]),
      }])
      await expect(store.applyEnginePatch({
        baseRevision: 8,
        patchSet: { revision: 9, forward: { kind: 'set-project-name', payload: { name: 'Stale' } } },
        responseBytes: new Uint8Array(),
      })).rejects.toThrow(/stale/iu)
    } finally {
      unsubscribe()
      store.close()
    }
  })

  test('persists routing cache without advancing authoritative revisions', async () => {
    const store = await fixtureStore()
    try {
      const before = store.getEngineRevision()
      expect(store.getRoutingCache()).toMatchObject({ plannerVersion: 'fixture-planner', entries: [expect.any(Object)] })
      const next = store.setRoutingCache({
        version: 1,
        plannerVersion: 'planner-2',
        geometryFingerprint: 'geometry-2',
        obstacles: [],
        failures: [],
        entries: [{
          input: { request: { definition: { connection_id: 1 } } },
          result: { route: { connection_id: 1, points: [], manual_anchor_point_indexes: [] } },
        }],
      })
      expect(next.plannerVersion).toBe('planner-2')
      expect(store.getEngineRevision()).toBe(before)
    } finally {
      store.close()
    }
  })

  test('invalidates authoritative read models only for canonical mutations', async () => {
    const store = await fixtureStore()
    try {
      store.getProject()
      store.getProject()
      const beforeRouteCache = store.cache.diagnostics()
      store.setRoutingCache({
        version: 1,
        plannerVersion: 'planner-cache-test',
        geometryFingerprint: 'geometry-cache-test',
        obstacles: [],
        failures: [],
        entries: [],
      })
      store.getProject()
      expect(store.cache.diagnostics().hits).toBe(beforeRouteCache.hits + 1)

      const cpu = store.getProject().items['cpu:3']
      store.updateInventoryItem({ type: 'cpu', id: 3 }, { ...cpu, name: 'Cache-invalidating CPU' })
      expect(store.cache.diagnostics().entries).toBe(1)
      expect(store.getProject().items['cpu:3'].name).toBe('Cache-invalidating CPU')
    } finally {
      store.close()
    }
  })

  test('updates one connection route without rebuilding unrelated topology', async () => {
    const store = await fixtureStore()
    try {
      const before = store.getProject()
      const unchanged = structuredClone(before.connections[1])
      const project = await store.applyEnginePatch({
        baseRevision: 8,
        patchSet: {
          revision: 9,
          forward: {
            kind: 'set-connection-route',
            payload: {
              connection_id: 1,
              route: {
                source_side: 'right',
                target_side: 'left',
                bend_points: [{ x: 612, y: 288 }, { x: 648, y: 288 }],
                avoid_cable_overlap: true,
              },
            },
          },
        },
        responseBytes: Uint8Array.from([4]),
      })
      expect(project.connections[0].route).toEqual({
        sourceSide: 'right',
        targetSide: 'left',
        bendPoints: [{ x: 612, y: 288 }, { x: 648, y: 288 }],
        avoidCableOverlap: true,
      })
      expect(project.connections[1]).toEqual(unchanged)
    } finally {
      store.close()
    }
  })

  test('preserves every occupied slot for multi-position assignments', async () => {
    const store = await fixtureStore()
    try {
      const database = store.core.database
      database.query(`
        UPDATE host_resource_groups SET slot_count = 2
        WHERE host_item_id = 1 AND resource_type = 'storage'
      `).run()
      const group = database.query(`
        SELECT id FROM host_resource_groups
        WHERE host_item_id = 1 AND resource_type = 'storage'
      `).get() as { id: number }
      const secondSlotId = 10_000
      database.query(`
        INSERT INTO host_resource_slots (
          id, resource_group_id, host_item_id, position, label, single_capacity, created_at_ms
        ) VALUES (?, ?, 1, 2, 'M.2 storage 2', 1, ?)
      `).run(secondSlotId, group.id, Date.parse('2026-08-12T01:00:00.000Z'))
      database.query('INSERT INTO storage_slots (id) VALUES (?)').run(secondSlotId)

      const current = store.getEngineSnapshot().topology.assignments[2]
      await store.applyEnginePatch({
        baseRevision: 8,
        patchSet: {
          revision: 9,
          forward: {
            kind: 'patch-assignments',
            payload: {
              upsert: [{
                ...current,
                allocation: { resource_type: 'storage', group_id: 1, positions: [0, 1] },
              }],
              remove_assignment_ids: [],
            },
          },
        },
        responseBytes: Uint8Array.from([5]),
      })

      expect(store.getProject().assignments[2].allocation?.positions).toEqual([0, 1])
      expect(database.query(`
        SELECT count(*) AS count FROM component_assignment_slots WHERE assignment_id = 3
      `).get()).toEqual({ count: 2 })
    } finally {
      store.close()
    }
  })

  test('persists a compatible expansion slot when a GPU is removed and assigned again', async () => {
    const store = await fixtureStore((snapshot) => {
      snapshot.inventory.servers[0].compatibility.host.maxExpansionPowerWatts = 75
      snapshot.inventory.servers[0].compatibility.host.expansionSlots = [{
        id: 1,
        key: 'pcie-slot',
        label: 'PCIe slot',
        count: 1,
        interfaceFamily: 'pcie',
        pcieGeneration: 3,
        mechanicalLanes: 8,
        electricalLanes: 8,
        acceptedHeights: ['low-profile'],
        maxSlotWidth: 1,
        maxPowerWatts: 75,
      }]
      snapshot.inventory.gpus.push({
        id: 1,
        name: 'AMD Radeon RX 640',
        manufacturer: 'AMD',
        specs: { formFactor: 'Low Profile', slotWidth: 1, pcie: 'PCIe 3.0 x8' },
        compatibility: {
          requirements: {
            expansion: {
              interfaceFamily: 'pcie',
              pcieGeneration: 3,
              connectorLanes: 8,
              minimumElectricalLanes: 8,
              height: 'low-profile',
              slotWidth: 1,
              powerWatts: 50,
            },
          },
        },
      })
      snapshot.project.compatibilityPolicy = { disabledHosts: [], ignoredWarningIds: [] }
    })
    try {
      const assignedAt = '2026-08-14T12:00:00.000Z'
      const candidate = {
        id: 5,
        serverId: 'server:7',
        itemId: 'gpu:1',
        type: 'gpu' as const,
        assignedAt,
      }
      const plan = planHostAllocations({
        ...store.getProject(),
        assignments: [...store.getProject().assignments, candidate],
      }, candidate.serverId)
      const planned = plan.assignments.find((assignment) => assignment.id === candidate.id)!
      expect(plan.results.find((result) => result.assignmentId === candidate.id)).toMatchObject({
        status: 'compatible',
        findings: [],
      })
      expect(planned.allocation).toEqual({
        resourceType: 'expansion',
        groupId: 1,
        positions: [0],
      })

      const engineAssignment = {
        id: candidate.id,
        host: { item_type: 'server', id: 7 },
        item: { item_type: 'gpu', id: 1 },
        component_type: 'gpu',
        assigned_at: assignedAt,
        allocation: {
          resource_type: planned.allocation!.resourceType,
          group_id: planned.allocation!.groupId ?? null,
          positions: planned.allocation!.positions,
        },
      }
      let revision = store.getEngineRevision()
      await store.applyEnginePatch({
        baseRevision: revision,
        patchSet: {
          revision: ++revision,
          forward: {
            kind: 'patch-assignments',
            payload: { upsert: [engineAssignment], remove_assignment_ids: [] },
          },
        },
        responseBytes: Uint8Array.from([8]),
      })

      const persistedAllocation = () => store.core.database.query(`
        SELECT assignment.resource_slot_id AS resourceSlotId,
               slot.resource_slot_id AS assignedSlotId,
               slot.host_item_id AS hostItemId,
               resource.position
        FROM component_assignments assignment
        JOIN component_assignment_slots slot ON slot.assignment_id = assignment.id
        JOIN host_resource_slots resource ON resource.id = slot.resource_slot_id
        WHERE assignment.id = ?
      `).get(candidate.id) as {
        resourceSlotId: number
        assignedSlotId: number
        hostItemId: number
        position: number
      } | null
      expect(persistedAllocation()).toMatchObject({
        resourceSlotId: expect.any(Number),
        assignedSlotId: expect.any(Number),
        hostItemId: 1,
        position: 1,
      })
      expect(persistedAllocation()!.resourceSlotId).toBe(persistedAllocation()!.assignedSlotId)

      await store.applyEnginePatch({
        baseRevision: revision,
        patchSet: {
          revision: ++revision,
          forward: {
            kind: 'patch-assignments',
            payload: { upsert: [], remove_assignment_ids: [candidate.id] },
          },
        },
        responseBytes: Uint8Array.from([9]),
      })
      expect(persistedAllocation()).toBeNull()

      await store.applyEnginePatch({
        baseRevision: revision,
        patchSet: {
          revision: ++revision,
          forward: {
            kind: 'patch-assignments',
            payload: { upsert: [engineAssignment], remove_assignment_ids: [] },
          },
        },
        responseBytes: Uint8Array.from([10]),
      })
      expect(persistedAllocation()).toMatchObject({ hostItemId: 1, position: 1 })
      expect(store.getProject().assignments.find((assignment) => assignment.id === candidate.id)?.allocation)
        .toEqual({ resourceType: 'expansion', resourceKey: 'pcie-slot', groupId: 1, positions: [0] })
    } finally {
      store.close()
    }
  })

  test('removes assigned components without mistaking cascaded slot rows for missing assignments', async () => {
    const store = await fixtureStore()
    try {
      const database = store.core.database
      const assignmentId = 3
      const baseRevision = store.getEngineRevision()
      database.query(`
        UPDATE host_resource_groups SET slot_count = 2
        WHERE host_item_id = 1 AND resource_type = 'storage'
      `).run()
      const group = database.query(`
        SELECT id FROM host_resource_groups
        WHERE host_item_id = 1 AND resource_type = 'storage'
      `).get() as { id: number }
      const secondSlotId = 10_001
      database.query(`
        INSERT INTO host_resource_slots (
          id, resource_group_id, host_item_id, position, label, single_capacity, created_at_ms
        ) VALUES (?, ?, 1, 2, 'M.2 storage 2', 1, ?)
      `).run(secondSlotId, group.id, Date.parse('2026-08-12T01:00:00.000Z'))
      database.query('INSERT INTO storage_slots (id) VALUES (?)').run(secondSlotId)
      database.query(`
        INSERT INTO component_assignment_slots (
          project_id, assignment_id, host_item_id, resource_slot_id, position
        ) VALUES (1, ?, 1, ?, 1)
      `).run(assignmentId, secondSlotId)
      expect(database.query(`
        SELECT count(*) AS count FROM component_assignment_slots WHERE assignment_id = ?
      `).get(assignmentId)).toEqual({ count: 2 })

      await store.applyEnginePatch({
        baseRevision,
        patchSet: {
          revision: baseRevision + 1,
          forward: {
            kind: 'patch-assignments',
            payload: { upsert: [], remove_assignment_ids: [assignmentId] },
          },
        },
        responseBytes: Uint8Array.from([6]),
      })

      expect(store.getProject().assignments.some((assignment) => assignment.id === assignmentId)).toBe(false)
      expect(database.query(`
        SELECT count(*) AS count FROM component_assignment_slots WHERE assignment_id = ?
      `).get(assignmentId)).toEqual({ count: 0 })
      expect(store.getEngineRevision()).toBe(baseRevision + 1)

      await expect(store.applyEnginePatch({
        baseRevision: baseRevision + 1,
        patchSet: {
          revision: baseRevision + 2,
          forward: {
            kind: 'patch-assignments',
            payload: { upsert: [], remove_assignment_ids: [assignmentId] },
          },
        },
        responseBytes: Uint8Array.from([7]),
      })).rejects.toThrow(`Assignment ${assignmentId} does not exist.`)
      expect(store.getEngineRevision()).toBe(baseRevision + 1)
    } finally {
      store.close()
    }
  })

  test('removes connections without mistaking cascaded topology rows for missing connections', async () => {
    const store = await fixtureStore()
    try {
      const database = store.core.database
      const connectionId = 1
      const baseRevision = store.getEngineRevision()
      const connection = store.getEngineSnapshot().topology.connections
        .find((candidate) => candidate.id === connectionId)
      expect(connection).toBeDefined()
      expect(database.query(`
        SELECT count(*) AS count FROM connection_endpoints WHERE connection_id = ?
      `).get(connectionId)).toEqual({ count: 2 })

      await store.applyEnginePatch({
        baseRevision,
        patchSet: {
          revision: baseRevision + 1,
          forward: { kind: 'remove-connection', payload: { connection: connection! } },
        },
        responseBytes: Uint8Array.from([8]),
      })

      expect(store.getProject().connections.some((candidate) => candidate.id === connectionId)).toBe(false)
      expect(database.query(`
        SELECT count(*) AS count FROM connection_endpoints WHERE connection_id = ?
      `).get(connectionId)).toEqual({ count: 0 })
      expect(store.getEngineRevision()).toBe(baseRevision + 1)

      await expect(store.applyEnginePatch({
        baseRevision: baseRevision + 1,
        patchSet: {
          revision: baseRevision + 2,
          forward: { kind: 'remove-connection', payload: { connection: connection! } },
        },
        responseBytes: Uint8Array.from([9]),
      })).rejects.toThrow(`Connection ${connectionId} does not exist.`)
      expect(store.getEngineRevision()).toBe(baseRevision + 1)
    } finally {
      store.close()
    }
  })

  test('replaces a submitted project atomically with one invalidation revision', async () => {
    const store = await fixtureStore()
    const commits: unknown[] = []
    store.subscribeToProjectCommits((event) => commits.push(event))
    try {
      const current = store.getProject()
      const next = store.setProject({
        ...current,
        metadata: { ...current.metadata, name: 'Replanned Lab' },
        placements: current.placements.map((placement) => (
          placement.serverId === 'server:7' ? { ...placement, x: 168 } : placement
        )),
        compatibilityPolicy: { disabledHosts: [], ignoredWarningIds: [] },
      })
      expect(next.revision).toBe(9)
      expect(next.metadata.name).toBe('Replanned Lab')
      expect(next.placements.find(({ serverId }) => serverId === 'server:7')?.x).toBe(168)
      expect(next.compatibilityPolicy).toEqual({ disabledHosts: [], ignoredWarningIds: [] })
      expect(commits).toEqual([{
        type: 'canonical-invalidated',
        baseRevision: 8,
        revision: 9,
      }])
    } finally {
      store.close()
    }
  })

  test('creates quantities and duplicates clean records with relational identities', async () => {
    const store = await fixtureStore()
    try {
      let project = store.createInventoryItems({ type: 'switch', name: 'Edge Switch' }, 2)
      const createdSwitches = Object.values(project.items).filter((item) => item.type === 'switch' && item.name.startsWith('Edge Switch'))
      expect(createdSwitches.map(({ name }) => name)).toEqual(['Edge Switch #1', 'Edge Switch #2'])

      project = store.createInventoryItems({
        type: 'powerAdapter',
        name: 'OEM 90W',
        specs: { wattageWatts: 90, connector: 'Slim tip' },
      }, 2)
      const adapters = Object.values(project.items).filter((item) => item.type === 'powerAdapter' && item.name === 'OEM 90W')
      expect(adapters).toHaveLength(2)
      expect(adapters.every((item) => item.ports?.[0]?.type === 'ac-input')).toBe(true)

      const source = createdSwitches[0]
      project = store.duplicateInventoryItem({ type: 'switch', id: source.id }, 1)
      expect(Object.values(project.items).some((item) => item.type === 'switch' && item.name === 'Edge Switch #3')).toBe(true)
      expect(store.core.database.query(`
        SELECT count(*) AS count
        FROM inventory_identity_aliases
        WHERE legacy_type_key IN ('switch', 'powerAdapter')
      `).get()).toMatchObject({ count: expect.any(Number) })
    } finally {
      store.close()
    }
  })

  test('archives, restores, deletes, and updates properties atomically', async () => {
    const store = await fixtureStore()
    try {
      let project = store.createInventoryItems({ type: 'cpu', name: 'Lifecycle CPU' })
      const cpu = Object.values(project.items).find((item) => item.type === 'cpu' && item.name === 'Lifecycle CPU')!
      project = store.updateInventoryItemProperties({ type: 'cpu', id: cpu.id }, { source: 'agent', nested: { value: 1 } })
      expect(project.items[`cpu:${cpu.id}`].properties).toEqual({ source: 'agent', nested: '{"value":1}' })

      project = store.archiveInventoryItems([{ type: 'cpu', id: cpu.id }])
      expect(project.items[`cpu:${cpu.id}`].archivedAt).toBeTruthy()
      project = store.restoreInventoryItems([{ type: 'cpu', id: cpu.id }])
      expect(project.items[`cpu:${cpu.id}`].archivedAt).toBeUndefined()
      expect(() => store.deleteInventoryItems([{ type: 'cpu', id: cpu.id }])).toThrow(/Archive/iu)
      store.archiveInventoryItems([{ type: 'cpu', id: cpu.id }])
      project = store.deleteInventoryItems([{ type: 'cpu', id: cpu.id }])
      expect(project.items[`cpu:${cpu.id}`]).toBeUndefined()
    } finally {
      store.close()
    }
  })

  test('blocks lifecycle changes while relational dependencies remain', async () => {
    const store = await fixtureStore()
    try {
      const report = store.getInventoryDependencies({ type: 'server', id: 7 })
      expect(report.blocked).toBe(true)
      expect(report.reasons.map(({ kind }) => kind)).toContain('canvas-placement')
      expect(() => store.archiveInventoryItems([{ type: 'server', id: 7 }])).toThrow(/dependencies/iu)
    } finally {
      store.close()
    }
  })

  test('updates connected equipment while preserving relational port identities', async () => {
    const store = await fixtureStore()
    try {
      const beforePort = store.core.database.query(`
        SELECT p.id
        FROM inventory_ports p
        JOIN port_identity_aliases a ON a.port_id = p.id
        WHERE a.legacy_item_type_key = 'switch'
          AND a.legacy_item_id = 1
          AND a.legacy_port_id = 1
      `).get() as { id: number }
      const beforeEndpoint = store.core.database.query(`
        SELECT port_id FROM connection_endpoints
        WHERE connection_id = 1 AND role = 'source'
      `).get()

      const project = store.updateInventoryItem({ type: 'switch', id: 1 }, {
        name: 'Renamed Example Switch',
        manufacturer: 'Example Networks',
        specs: { management: 'Managed', switchingCapacityGbps: 20, fanless: true },
        ports: [{
          id: 1,
          kind: 'switch-port',
          type: 'rj45',
          slotNumber: 1,
          speed: '1G',
          role: 'access',
          label: 'LAN 1',
          origin: 'fixed',
        }],
      })

      expect(project.items['switch:1']).toMatchObject({
        name: 'Renamed Example Switch',
        ports: [{ id: 1, label: 'LAN 1', speed: '1G' }],
      })
      expect(store.core.database.query(`
        SELECT p.id
        FROM inventory_ports p
        JOIN port_identity_aliases a ON a.port_id = p.id
        WHERE a.legacy_item_type_key = 'switch'
          AND a.legacy_item_id = 1
          AND a.legacy_port_id = 1
      `).get()).toEqual(beforePort)
      expect(store.core.database.query(`
        SELECT port_id FROM connection_endpoints
        WHERE connection_id = 1 AND role = 'source'
      `).get()).toEqual(beforeEndpoint)

      expect(() => store.updateInventoryItem({ type: 'switch', id: 1 }, {
        ...project.items['switch:1'],
        ports: [{ ...project.items['switch:1'].ports![0], speed: '10G' }],
      })).toThrow(/Connected port 1/iu)
    } finally {
      store.close()
    }
  })

  test('updates host compatibility without orphaning assigned resource slots', async () => {
    const store = await fixtureStore()
    try {
      const before = store.getProject()
      const storageAssignment = before.assignments.find((assignment) => assignment.id === 3)!
      const beforeSlot = store.core.database.query(
        'SELECT resource_slot_id FROM component_assignments WHERE id = 3',
      ).get()
      const server = before.items['server:7']
      const project = store.updateInventoryItem({ type: 'server', id: 7 }, {
        ...server,
        name: 'Updated Example Micro Host',
        compatibility: {
          ...server.compatibility,
          host: {
            ...server.compatibility?.host,
            memory: { ...server.compatibility?.host?.memory, maxSpeedMt: 3200 },
          },
        },
      })

      expect(project.items['server:7'].name).toBe('Updated Example Micro Host')
      expect(project.items['server:7'].compatibility?.host?.memory?.maxSpeedMt).toBe(3200)
      expect(project.assignments.find((assignment) => assignment.id === 3)).toEqual(storageAssignment)
      expect(store.core.database.query(
        'SELECT resource_slot_id FROM component_assignments WHERE id = 3',
      ).get()).toEqual(beforeSlot)
    } finally {
      store.close()
    }
  })

  test('changes NAS power configuration through the dedicated atomic command', async () => {
    const store = await fixtureStore()
    try {
      const created = store.createInventoryItems({
        type: 'nas',
        name: 'Internal NAS',
        specs: { driveBays: 4, powerConfiguration: 'internal-psu' },
      })
      const nas = Object.values(created.items).find((item) => item.type === 'nas')!
      expect(nas.ports?.some((port) => port.type === 'ac-input')).toBe(true)

      const result = store.changeNasPowerConfiguration(
        { type: 'nas', id: nas.id },
        'external-adapter',
      ) as any
      expect(result.status).toBe('applied')
      expect(result.project.items[`nas:${nas.id}`]).toMatchObject({
        specs: { driveBays: 4, powerConfiguration: 'external-adapter' },
      })
      expect(result.project.items[`nas:${nas.id}`].ports ?? []).toEqual([])
    } finally {
      store.close()
    }
  })

  test('blocks a fixed-adapter topology update while a replaceable adapter is assigned', async () => {
    const store = await emptyFixtureStore()
    try {
      let project = store.createInventoryItems({
        type: 'nas',
        name: 'Replaceable adapter NAS',
        specs: { powerConfiguration: 'external-adapter' },
        compatibility: { host: { power: {
          configuration: 'external-adapter',
          adapterDisposition: 'replaceable',
          connector: 'barrel',
          adapterRequired: true,
        } } },
      })
      const nas = Object.values(project.items).find((item) => item.type === 'nas')!
      project = store.createInventoryItems({
        type: 'powerAdapter',
        name: 'NAS adapter',
        specs: { wattageWatts: 65, connector: 'barrel' },
      })
      const adapter = Object.values(project.items).find((item) => item.type === 'powerAdapter')!
      project = store.setProject({
        ...project,
        assignments: [{
          id: 1,
          serverId: `nas:${nas.id}`,
          itemId: `powerAdapter:${adapter.id}`,
          type: 'powerAdapter',
          assignedAt: '2026-08-14T00:00:00.000Z',
        }],
      })
      const current = project.items[`nas:${nas.id}`]

      expect(() => store.updateInventoryItem({ type: 'nas', id: nas.id }, {
        ...current,
        compatibility: { host: { ...current.compatibility?.host, power: {
          ...current.compatibility?.host?.power,
          configuration: 'external-adapter',
          adapterDisposition: 'fixed',
        } } },
      })).toThrow(/orphan.*assigned NAS power adapter/iu)
      expect(store.getProject().assignments).toHaveLength(1)
    } finally {
      store.close()
    }
  })

  test('atomically resolves a fixed-adapter Registry update without deleting its power cable', async () => {
    const store = await emptyFixtureStore()
    try {
      store.registryTransaction((draft: any) => {
        draft.sources = [{ id: 1, kind: 'official-connected', displayName: 'Official Catalog', enabled: true, createdAt: '2026-08-14T00:00:00.000Z' }]
        draft.snapshot = { sourceId: 1, revision: 1, generatedAt: '2026-08-14T00:00:00.000Z', expiresAt: null, activatedAt: '2026-08-14T00:00:00.000Z', digest: 'a'.repeat(64), templateCount: 1, keyId: 'test-key' }
      })
      const revision1 = await catalogTemplate({
        type: 'nas', name: 'Example NAS', manufacturer: 'Example', family: 'Example NAS', model: 'NAS-1',
        specs: { powerConfiguration: 'external-adapter', variantKey: 'standard', topologyCompleteness: 'complete' },
        compatibility: { host: {
          power: { configuration: 'external-adapter', adapterDisposition: 'replaceable', connector: 'barrel' },
          storageSlots: [{ id: 1, key: 'drive-bays', count: 6, interfaces: ['SATA'], formFactors: ['2.5-inch'] }],
        } },
        ports: [],
      }, 1, 'nas-example-nas-1', NAS_FINGERPRINT_VERSION)
      let project = store.createCatalogInventoryItems(revision1)
      const nas = Object.values(project.items).find((item) => item.type === 'nas')!
      project = store.createInventoryItems({ type: 'powerAdapter', name: 'OEM adapter', specs: { wattageWatts: 65, connector: 'barrel' } })
      const adapter = Object.values(project.items).find((item) => item.type === 'powerAdapter')!
      project = store.createInventoryItems({
        type: 'storage', name: 'NAS SSD', manufacturer: 'Example', model: 'SSD-1',
        specs: { capacityGb: 1000, interface: 'SATA', formFactor: '2.5-inch' },
      })
      const storage = Object.values(project.items).find((item) => item.type === 'storage')!
      project = store.createInventoryItems({ type: 'powerStrip', name: 'Power strip', specs: { outlets: 2 } })
      const strip = Object.values(project.items).find((item) => item.type === 'powerStrip')!
      project = store.setProject({
        ...project,
        assignments: [
          {
            id: 1, serverId: `nas:${nas.id}`, itemId: `powerAdapter:${adapter.id}`,
            type: 'powerAdapter', assignedAt: '2026-08-14T00:00:00.000Z',
          },
          {
            id: 2, serverId: `nas:${nas.id}`, itemId: `storage:${storage.id}`,
            type: 'storage', assignedAt: '2026-08-14T00:00:00.000Z',
            allocation: { resourceType: 'storage', resourceKey: 'drive-bays', groupId: 1, positions: [0] },
          },
        ],
        connections: [{
          id: 1, type: 'power', createdAt: '2026-08-14T00:00:00.000Z',
          from: { itemId: `powerStrip:${strip.id}`, portId: 2 },
          to: { itemId: `nas:${nas.id}`, hostedItemId: `powerAdapter:${adapter.id}`, portId: 1 },
        }],
      })
      const link = (store.getRegistryState() as any).links[0]
      const revision2 = await catalogTemplate({
        ...revision1.item,
        compatibility: { host: {
          power: { configuration: 'external-adapter', adapterDisposition: 'fixed', connector: 'barrel' },
          storageSlots: [{ id: 1, key: 'sata-bays', count: 6, interfaces: ['SATA'], formFactors: ['2.5-inch'] }],
        } },
      }, 2, revision1.templateKey, NAS_FINGERPRINT_VERSION)
      store.registryTransaction((draft: any) => {
        draft.snapshot.revision = 2
        Object.assign(draft.links[0], { state: 'update-available', availableRevision: 2, availableContentHash: revision2.contentHash })
      })
      const batch = store.evaluateCatalogUpdates([{ linkId: link.id, templateKey: link.templateKey }], [revision2])
      store.commitCatalogUpdateRun({
        sourceId: 1, catalogRevision: 2, evaluations: batch.evaluations, templates: [revision2], automatic: false,
        expectedProjectRevisions: batch.projectRevisions,
      })
      const beforeResolve = store.getProject()

      expect(() => store.resolveAndApplyRegistryUpdateGroup({
        linkId: link.id,
        template: revision2,
        expectedProjectRevisions: { 1: beforeResolve.revision - 1 },
      })).toThrow(/project changed/iu)
      expect(store.getProject()).toEqual(beforeResolve)

      const result = store.resolveAndApplyRegistryUpdateGroup({
        linkId: link.id,
        template: revision2,
        expectedProjectRevisions: { 1: beforeResolve.revision },
      }) as any

      const resolved = store.getProject()
      expect(result.affectedRelationships).toEqual({ connectionIds: [1], assignmentIds: [1, 2] })
      expect(resolved.assignments).toEqual([expect.objectContaining({
        id: 2,
        itemId: `storage:${storage.id}`,
        allocation: expect.objectContaining({
          resourceType: 'storage',
          resourceKey: 'sata-bays',
          groupId: 1,
          positions: [0],
        }),
      })])
      expect(resolved.connections).toEqual([expect.objectContaining({
        id: 1,
        from: { itemId: `powerStrip:${strip.id}`, portId: 2 },
        to: { itemId: `nas:${nas.id}`, portId: 1 },
      })])
      expect(resolved.items[`powerAdapter:${adapter.id}`]).toBeDefined()
      expect((store.getRegistryState() as any).links[0]).toMatchObject({ state: 'linked', importedRevision: 2 })
      expect(() => store.resolveAndApplyRegistryUpdateGroup({
        linkId: link.id,
        template: revision2,
        expectedProjectRevisions: { 1: beforeResolve.revision },
      })).toThrow(/refresh/iu)
    } finally {
      store.close()
    }
  })

  test('round-trips registry state and enforces optimistic settings updates', async () => {
    const store = await fixtureStore()
    try {
      const before = store.getRegistryState()
      expect(before).toMatchObject({
        settings: { mode: 'connected', showRegistryLinkIndicators: true },
        sources: [{ id: 1, displayName: 'Official Registry' }],
        links: [{ id: 1, itemType: 'cpu', itemId: 3, templateKey: 'cpu-example-cpu-100' }],
      })
      const updated = store.updateRegistrySettings(
        { mode: 'offline', defaultInventorySource: 'manual', automaticContributions: true },
        before.settings.updatedAt,
      )
      expect(updated.settings).toMatchObject({
        mode: 'offline',
        defaultInventorySource: 'manual',
        automaticContributions: false,
      })
      expect(() => store.updateRegistrySettings({}, before.settings.updatedAt)).toThrow(/another session/iu)
      expect(updated.links).toEqual(before.links)
    } finally {
      store.close()
    }
  })

  test('persists release and update metadata in SQLite', async () => {
    const store = await fixtureStore()
    try {
      expect(store.getUpdateMetadata()).toEqual({ skippedUpdateVersion: null, lastUpdateCheck: null })
      await store.skipUpdateVersion('0.13.0')
      await store.saveUpdateCheck({ currentVersion: '0.12.0', availableVersion: '0.13.0' })
      await store.markAppOpened()

      expect(store.getUpdateMetadata()).toEqual({
        skippedUpdateVersion: '0.13.0',
        lastUpdateCheck: { currentVersion: '0.12.0', availableVersion: '0.13.0' },
      })
      expect(store.isUpdateVersionSkipped('0.13.0')).toBe(true)
      expect(store.core.database.query(
        "SELECT value_json FROM application_metadata WHERE key = 'legacy.application-meta'",
      ).get()).toMatchObject({ value_json: expect.stringContaining('"appLastOpenedWith":"0.12.0"') })

      await store.clearSkippedUpdateVersion()
      expect(store.isUpdateVersionSkipped('0.13.0')).toBe(false)
    } finally {
      store.close()
    }
  })

  test('persists onboarding preferences without changing project topology', async () => {
    const store = await fixtureStore()
    try {
      const before = store.getProject()
      expect(store.getOnboardingStatus()).toMatchObject({ enabled: true, status: 'dismissed' })
      expect(store.restartOnboardingChecklist()).toMatchObject({ status: 'checklist_active' })
      expect(store.dismissOnboarding()).toMatchObject({ status: 'dismissed' })
      expect(store.getProject()).toEqual(before)
    } finally {
      store.close()
    }
  })

  test('loads and removes the onboarding example as one relational graph', async () => {
    const store = await emptyFixtureStore()
    try {
      expect(store.getOnboardingStatus()).toMatchObject({ status: 'available', eligibleForExample: true })
      const loaded = await store.loadOnboardingExample()
      expect(loaded.status).toMatchObject({ status: 'sample_active', walkthroughStep: 0 })
      expect(Object.keys(loaded.project.items).length).toBeGreaterThan(0)
      expect(loaded.project.assignments.length).toBeGreaterThan(0)
      expect(loaded.project.connections.length).toBeGreaterThan(0)
      expect(store.getOnboardingRemovalImpact()).toMatchObject({
        inventoryRecords: Object.keys(loaded.project.items).length,
        assignments: loaded.project.assignments.length,
        connections: loaded.project.connections.length,
        additionalRelationships: 0,
      })

      const removed = await store.finishOnboardingExample('remove')
      expect(removed.status).toMatchObject({ status: 'checklist_active', eligibleForExample: true })
      expect(removed.project.items).toEqual({})
      expect(removed.project.assignments).toEqual([])
      expect(removed.project.connections).toEqual([])
      expect(removed.project.placements).toEqual([])
    } finally {
      store.close()
    }
  })

  test('creates, sanitizes, exports, deletes, and imports private templates', async () => {
    const store = await fixtureStore()
    try {
      const created = await store.createPrivateTemplate({
        name: 'Reusable server',
        item: {
          type: 'server',
          name: 'Example server',
          manufacturer: 'Example',
          properties: { lanIp: '192.168.1.10' },
        },
      }) as any
      expect(created.privateTemplates[0]).toMatchObject({ id: 1, name: 'Reusable server' })
      expect(JSON.stringify(created)).not.toContain('192.168.1.10')

      const pack = await store.exportPrivateTemplates([1])
      expect(pack.checksum).toMatch(/^[a-f0-9]{64}$/)
      store.deletePrivateTemplate(1)
      expect((store.getRegistryState() as any).privateTemplates).toEqual([])
      expect(await store.previewPrivateTemplateImport(pack)).toMatchObject({ valid: true, errors: [] })
      expect(await store.importPrivateTemplates(pack)).toMatchObject({ imported: 1, skipped: 0 })
      expect((store.getRegistryState() as any).privateTemplates[0]).toMatchObject({ id: 1, name: 'Reusable server' })
    } finally {
      store.close()
    }
  })

  test('serializes concurrent private-template creation with unique numeric IDs', async () => {
    const store = await fixtureStore()
    try {
      await Promise.all(Array.from({ length: 8 }, (_, index) => store.createPrivateTemplate({
        name: `Template ${index + 1}`,
        item: { type: 'cpu', name: `CPU ${index + 1}`, manufacturer: 'Example', model: `C-${index + 1}` },
      })))
      expect((store.getRegistryState() as any).privateTemplates.map((template: any) => template.id)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8,
      ])
    } finally {
      store.close()
    }
  })

  test('imports catalog items with links and applies reviewed updates', async () => {
    const store = await fixtureStore()
    try {
      store.registryTransaction((draft: any) => {
        draft.snapshot = {
          sourceId: 1,
          revision: 1,
          generatedAt: '2026-08-12T00:00:00.000Z',
          expiresAt: null,
          activatedAt: '2026-08-12T00:00:00.000Z',
          digest: 'b'.repeat(64),
          templateCount: 1,
          keyId: 'test-key',
        }
      })
      const revision1 = await catalogTemplate({
        type: 'cpu', name: 'Example CPU 200', manufacturer: 'Example Silicon', model: 'CPU-200',
        specs: { cores: 8, threads: 16, socket: 'LGA1200' },
      })
      const project = store.createCatalogInventoryItems(revision1)
      const created = Object.values(project.items).find((item) => item.type === 'cpu' && item.model === 'CPU-200')!
      const link = (store.getRegistryState() as any).links.find((candidate: any) => candidate.itemId === created.id)
      expect(link).toMatchObject({ itemType: 'cpu', state: 'linked', importedRevision: 1 })

      const revision2 = await catalogTemplate({
        ...revision1.item,
        specs: { ...revision1.item.specs, boostClockGhz: 4.7 },
      }, 2)
      store.registryTransaction((draft: any) => {
        const target = draft.links.find((candidate: any) => candidate.id === link.id)
        target.state = 'update-available'
        target.availableRevision = revision2.revision
        target.availableContentHash = revision2.contentHash
      })
      expect(store.getCatalogUpdatePreview(link.id, revision2)).toMatchObject({
        linkId: link.id,
        availableRevision: 2,
        dependencyConflicts: [],
      })
      const updated = store.applyCatalogUpdate(link.id, revision2)
      expect(updated.items[`cpu:${created.id}`].specs?.boostClockGhz).toBe(4.7)
      expect((store.getRegistryState() as any).links.find((candidate: any) => candidate.id === link.id)).toMatchObject({
        state: 'linked', importedRevision: 2,
      })
    } finally {
      store.close()
    }
  })

  test('round-trips v10 fixed NAS topology without creating component inventory or assignments', async () => {
    const store = await emptyFixtureStore()
    try {
      store.registryTransaction((draft: any) => {
        draft.snapshot = {
          sourceId: 1, revision: 1, generatedAt: '2026-08-14T00:00:00.000Z',
          expiresAt: null, activatedAt: '2026-08-14T00:00:00.000Z',
          digest: 'c'.repeat(64), templateCount: 1, keyId: 'test-key',
        }
      })
      const template = await catalogTemplate({
        type: 'nas',
        name: 'Example Fixed NAS',
        manufacturer: 'Example',
        model: 'NAS-10',
        specs: {
          formFactor: 'Desktop',
          powerConfiguration: 'external-adapter',
          topologyCompleteness: 'complete',
        },
        fixedComponents: [{
          id: 1,
          componentType: 'cpu',
          disposition: 'soldered',
          label: 'Soldered processor',
          item: { type: 'cpu', name: 'Embedded CPU', model: 'E-1' },
        }],
        compatibility: { host: {
          memory: { slots: 0, generations: ['DDR4'], formFactors: ['Onboard'], moduleTypes: ['Onboard'], oemMaxCapacityMib: 2_048 },
          storageSlots: [], expansionSlots: [], optionalModuleSlots: [],
          power: { configuration: 'external-adapter', adapterDisposition: 'fixed', connector: 'barrel', supportedPowerMw: [36_000] },
        } },
      }, 1, 'nas-example-nas-10', NAS_FINGERPRINT_VERSION)

      const project = store.createCatalogInventoryItems(template)
      const nas = Object.values(project.items).find((item) => item.type === 'nas') as any
      expect(nas).toMatchObject({
        fixedComponents: [{ id: 1, componentType: 'cpu', disposition: 'soldered' }],
        compatibility: { host: { power: { adapterDisposition: 'fixed' } } },
      })
      expect(nas.ports).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: 'ac-input', type: 'ac-input' }),
      ]))
      expect(project.assignments).toEqual([])
      expect(store.core.database.query('SELECT count(*) AS count FROM host_fixed_components').get()).toEqual({ count: 1 })
      expect(store.core.database.query("SELECT count(*) AS count FROM inventory_identity_aliases WHERE legacy_type_key = 'cpu'").get()).toEqual({ count: 0 })

      const before = await store.snapshotStores()
      await store.replaceStoresAtomically(before)
      const restoredNas = Object.values(store.getProject().items).find((item) => item.type === 'nas') as any
      expect(restoredNas.fixedComponents).toEqual(nas.fixedComponents)
      expect(restoredNas.compatibility.host.power).toEqual(nas.compatibility.host.power)
    } finally {
      store.close()
    }
  })

  test('imports the frozen NAS v10 fixture into canonical relational columns', async () => {
    const store = await emptyFixtureStore()
    try {
      store.registryTransaction((draft: any) => {
        draft.snapshot = {
          sourceId: 1, revision: 1, generatedAt: '2026-08-14T00:00:00.000Z',
          expiresAt: null, activatedAt: '2026-08-14T00:00:00.000Z',
          digest: 'd'.repeat(64), templateCount: 1, keyId: 'test-key',
        }
      })
      const template = await catalogTemplate(
        nasV10Fixture.item,
        1,
        'nas-synology-ds620slim',
        NAS_FINGERPRINT_VERSION,
      )
      expect(template).toMatchObject({
        identityHash: nasV10Fixture.identityHash,
        contentHash: nasV10Fixture.contentHash,
      })

      const project = store.createCatalogInventoryItems(template)
      const nas = Object.values(project.items).find((item) => item.type === 'nas') as any
      const canonicalId = store.core.database.query(`
        SELECT item_id FROM inventory_identity_aliases
        WHERE legacy_type_key = 'nas' AND legacy_id = ?
      `).get(nas.id) as { item_id: number }

      expect(store.core.database.query(`
        SELECT platform_family, release_date_text, width_mm, height_mm, depth_mm, mass_grams
        FROM nas_systems WHERE id = ?
      `).get(canonicalId.item_id)).toEqual({
        platform_family: 'DSM',
        release_date_text: '2019-07-18',
        width_mm: 151,
        height_mm: 121,
        depth_mm: 175,
        mass_grams: 1_400,
      })
      expect(store.core.database.query(`
        SELECT slot_count, oem_max_capacity_mib, oem_max_module_capacity_mib,
               verified_max_capacity_mib, verified_max_module_capacity_mib
        FROM host_memory_profiles mp
        JOIN host_compatibility_profiles hp ON hp.id = mp.host_profile_id
        WHERE hp.host_item_id = ?
      `).get(canonicalId.item_id)).toEqual({
        slot_count: 2,
        oem_max_capacity_mib: 6_144,
        oem_max_module_capacity_mib: 4_096,
        verified_max_capacity_mib: 16_384,
        verified_max_module_capacity_mib: 8_192,
      })
      expect(store.core.database.query(`
        SELECT configuration, adapter_disposition, connector
        FROM host_power_profiles pp
        JOIN host_compatibility_profiles hp ON hp.id = pp.host_profile_id
        WHERE hp.host_item_id = ?
      `).get(canonicalId.item_id)).toEqual({
        configuration: 'external-adapter',
        adapter_disposition: 'fixed',
        connector: '4-pin DIN',
      })
      expect(store.core.database.query(`
        SELECT power_mw FROM host_power_supported_wattages
        WHERE power_profile_id = (
          SELECT pp.id FROM host_power_profiles pp
          JOIN host_compatibility_profiles hp ON hp.id = pp.host_profile_id
          WHERE hp.host_item_id = ?
        )
      `).all(canonicalId.item_id)).toEqual([{ power_mw: 65_000 }])
      expect(store.core.database.query(`
        SELECT slot_count FROM host_resource_groups
        WHERE host_item_id = ? AND resource_type = 'storage'
      `).get(canonicalId.item_id)).toEqual({ slot_count: 6 })
      expect(nas.fixedComponents).toEqual(nasV10Fixture.item.fixedComponents)
      expect(project.assignments).toEqual([])

      const backup = await store.snapshotStores()
      await store.replaceStoresAtomically(backup)
      const restored = Object.values(store.getProject().items).find((item) => item.type === 'nas') as any
      expect(restored.fixedComponents).toEqual(nas.fixedComponents)
      expect(restored.compatibility.host.storageSlots).toEqual(nas.compatibility.host.storageSlots)
    } finally {
      store.close()
    }
  })

  test('round-trips the frozen network v11 wired and radio fixtures through relational tables', async () => {
    const store = await emptyFixtureStore()
    try {
      store.registryTransaction((draft: any) => {
        draft.snapshot = {
          sourceId: 1, revision: 1, generatedAt: '2026-08-16T00:00:00.000Z',
          expiresAt: null, activatedAt: '2026-08-16T00:00:00.000Z',
          digest: 'e'.repeat(64), templateCount: 2, keyId: 'test-key',
        }
      })
      for (const fixture of networkV11Fixture.templates) {
        const template = await catalogTemplate(
          fixture.item,
          1,
          fixture.templateKey,
          NETWORK_FINGERPRINT_VERSION,
        )
        expect(template).toMatchObject({
          identityHash: fixture.identityHash,
          contentHash: fixture.contentHash,
        })
        store.createCatalogInventoryItems(template)
      }

      const adapters = Object.values(store.getProject().items)
        .filter((item) => item.type === 'network') as any[]
      const wired = adapters.find((item) => item.model === 'X710-DA2')
      const radio = adapters.find((item) => item.model === 'AX210.NGWG')
      expect(wired).toMatchObject(networkV11Fixture.templates[0].item)
      expect(radio).toMatchObject(networkV11Fixture.templates[1].item)
      expect(wired.ports).toHaveLength(2)
      expect(radio.ports).toBeUndefined()
      expect(store.core.database.query('SELECT count(*) AS count FROM network_adapter_ports').get()).toEqual({ count: 2 })
      expect(store.core.database.query('SELECT count(*) AS count FROM network_adapter_frequency_bands').get()).toEqual({ count: 3 })
      expect(store.core.database.query(`
        SELECT count(*) AS count FROM inventory_items WHERE extensions_json <> '{}'
      `).get()).toEqual({ count: 0 })

      const snapshot = await store.snapshotStores()
      await store.replaceStoresAtomically(snapshot)
      const restored = Object.values(store.getProject().items)
        .filter((item) => item.type === 'network') as any[]
      expect(restored.find((item) => item.model === 'X710-DA2')).toMatchObject(networkV11Fixture.templates[0].item)
      expect(restored.find((item) => item.model === 'AX210.NGWG')).toMatchObject(networkV11Fixture.templates[1].item)
    } finally {
      store.close()
    }
  })

  test('round-trips an unknown PCIe electrical minimum without inferring connector width', async () => {
    const store = await emptyFixtureStore()
    try {
      store.registryTransaction((draft: any) => {
        draft.snapshot = {
          sourceId: 1, revision: 21, generatedAt: '2026-08-16T00:00:00.000Z',
          expiresAt: null, activatedAt: '2026-08-16T00:00:00.000Z',
          digest: '2'.repeat(64), templateCount: 1, keyId: 'test-key',
        }
      })
      const item = structuredClone(networkV11Fixture.templates[0].item) as any
      delete item.specs.hostInterface.minimumElectricalLanes
      delete item.compatibility.requirements.expansion.minimumElectricalLanes
      const template = await catalogTemplate(
        item,
        3,
        'network-intel-x710-da2',
        NETWORK_FINGERPRINT_VERSION,
      )

      store.createCatalogInventoryItems(template)
      const snapshot = await store.snapshotStores()
      await store.replaceStoresAtomically(snapshot)

      const restored = Object.values(store.getProject().items)
        .find((entry) => entry.type === 'network') as any
      expect(restored.specs.hostInterface).toEqual(expect.objectContaining({
        family: 'pcie', connectorLanes: 8,
      }))
      expect(restored.specs.hostInterface).not.toHaveProperty('minimumElectricalLanes')
      expect(restored.compatibility.requirements.expansion)
        .not.toHaveProperty('minimumElectricalLanes')
      expect(store.core.database.query(`
        SELECT minimum_electrical_lanes AS minimumElectricalLanes
        FROM network_adapter_host_interfaces
      `).get()).toEqual({ minimumElectricalLanes: null })
    } finally {
      store.close()
    }
  })

  test('preserves unknown signed network v11 fields in typed relational extension rows', async () => {
    const store = await emptyFixtureStore()
    try {
      store.registryTransaction((draft: any) => {
        draft.snapshot = {
          sourceId: 1, revision: 1, generatedAt: '2026-08-16T00:00:00.000Z',
          expiresAt: null, activatedAt: '2026-08-16T00:00:00.000Z',
          digest: 'f'.repeat(64), templateCount: 1, keyId: 'test-key',
        }
      })
      const item = structuredClone(networkV11Fixture.templates[0].item) as any
      item.futureVendor = { certification: 'v-next' }
      item.specs.hostInterface.futureLink = { lanes: [1, 2], profiles: [] }
      item.ports[0].futureOptics = { profile: 'extended' }
      const template = await catalogTemplate(
        item,
        1,
        'network-intel-x710-da2-future',
        NETWORK_FINGERPRINT_VERSION,
      )
      const project = store.createCatalogInventoryItems(template)
      const adapter = Object.values(project.items).find((entry) => entry.type === 'network') as any

      expect(adapter.futureVendor).toEqual({ certification: 'v-next' })
      expect(adapter.specs.hostInterface.futureLink).toEqual({ lanes: [1, 2], profiles: [] })
      expect(adapter.ports[0].futureOptics).toEqual({ profile: 'extended' })
      const extensionContainerCount = store.core.database.query(`
        SELECT count(*) AS count FROM network_adapter_extension_values
        WHERE value_type IN ('object', 'array')
      `).get() as { count: number }
      expect(extensionContainerCount.count).toBeGreaterThan(0)
      expect(store.core.database.query(`
        SELECT count(*) AS count
        FROM inventory_items item
        JOIN network_adapters adapter ON adapter.id = item.id
        WHERE item.extensions_json <> '{}'
      `).get()).toEqual({ count: 0 })
    } finally {
      store.close()
    }
  })

  test('applies safe catalog updates to multiple links in one atomic project mutation', async () => {
    const store = await emptyFixtureStore()
    try {
      store.registryTransaction((draft: any) => {
        draft.sources = [{ id: 1, kind: 'official-connected', displayName: 'Official Catalog', enabled: true, createdAt: '2026-08-12T00:00:00.000Z' }]
        draft.snapshot = { sourceId: 1, revision: 1, generatedAt: '2026-08-12T00:00:00.000Z', expiresAt: null, activatedAt: '2026-08-12T00:00:00.000Z', digest: 'b'.repeat(64), templateCount: 1, keyId: 'test-key' }
      })
      const revision1 = await catalogTemplate({
        type: 'cpu', name: 'Example CPU 200', manufacturer: 'Example Silicon', model: 'CPU-200',
        specs: { cores: 8, threads: 16 },
      })
      const revision2 = await catalogTemplate({
        ...revision1.item,
        compatibility: { requirements: { cpu: { socket: 'LGA1200', generation: '10th Gen', tdpWatts: 35 } } },
      }, 2)
      store.createCatalogInventoryItems(revision1, 2)
      const beforeRevision = store.getProject().revision
      store.registryTransaction((draft: any) => {
        draft.snapshot.revision = 2
        for (const link of draft.links) {
          link.state = 'update-available'
          link.availableRevision = 2
          link.availableContentHash = revision2.contentHash
        }
      })
      const evaluations = (store.getRegistryState() as any).links.map((link: any) => ({
        ...store.evaluateCatalogUpdate(link.id, revision2),
        targetContentHash: revision2.contentHash,
      }))
      const result = store.commitCatalogUpdateRun({ sourceId: 1, catalogRevision: 2, evaluations, templates: [revision2], automatic: true })

      expect(result.applied).toBe(2)
      expect(store.getProject().revision).toBe(beforeRevision + 1)
      expect(result.affectedProjectIds).toEqual([1])
      expect(result.affectedProjectRevisions).toEqual({ 1: beforeRevision + 1 })
      expect((store.getRegistryState() as any).links).toEqual([
        expect.objectContaining({ importedRevision: 2, state: 'linked' }),
        expect.objectContaining({ importedRevision: 2, state: 'linked' }),
      ])
      expect(store.getRegistryUpdateGroups()).toEqual([
        expect.objectContaining({ status: 'applied', toRevision: 2, items: expect.arrayContaining([expect.any(Object), expect.any(Object)]) }),
      ])
      const revisionAfterApply = store.getProject().revision
      const repeated = store.applyRegistryUpdateGroups([revision2])
      expect(repeated.decisions).toEqual([{ templateKey: revision2.templateKey, toRevision: 2, status: 'applied' }])
      expect(repeated.affectedProjectIds).toEqual([])
      expect(store.getProject().revision).toBe(revisionAfterApply)
      const backupSnapshot = await store.snapshotStores()
      expect((backupSnapshot.registry as any).updateRuns).toEqual([
        expect.objectContaining({ catalogRevision: 2, appliedCount: 2, state: 'completed' }),
      ])
      expect((backupSnapshot.registry as any).updateEvaluations).toHaveLength(2)
      await store.replaceStoresAtomically({ registry: backupSnapshot.registry })
      expect((await store.snapshotStores()).registry).toEqual(backupSnapshot.registry)
    } finally {
      store.close()
    }
  })

  test('applies only the exact review members when one template also has blocked links', async () => {
    const store = await emptyFixtureStore()
    try {
      store.registryTransaction((draft: any) => {
        draft.sources = [{ id: 1, kind: 'official-connected', displayName: 'Official Catalog', enabled: true, createdAt: '2026-08-12T00:00:00.000Z' }]
        draft.snapshot = { sourceId: 1, revision: 2, generatedAt: '2026-08-12T00:00:00.000Z', expiresAt: null, activatedAt: '2026-08-12T00:00:00.000Z', digest: 'b'.repeat(64), templateCount: 1, keyId: 'test-key' }
      })
      const revision1 = await catalogTemplate({
        type: 'cpu', name: 'Example CPU 300', manufacturer: 'Example Silicon', model: 'CPU-300', specs: { cores: 4 },
      }, 1, 'cpu-example-cpu-300')
      const revision2 = await catalogTemplate({
        ...revision1.item, specs: { cores: 6 },
      }, 2, revision1.templateKey)
      store.createCatalogInventoryItems(revision1, 2)
      const links = (store.getRegistryState() as any).links
      store.registryTransaction((draft: any) => {
        for (const link of draft.links) Object.assign(link, {
          state: 'update-available', availableRevision: 2, availableContentHash: revision2.contentHash,
        })
      })
      const batch = store.evaluateCatalogUpdates(
        links.map((link: any) => ({ linkId: link.id, templateKey: link.templateKey })),
        [revision2],
      )
      batch.evaluations[0].classification = 'review-required'
      batch.evaluations[0].reasons = ['identity-change']
      batch.evaluations[1].classification = 'blocked'
      batch.evaluations[1].reasons = ['connected-port-change']
      store.commitCatalogUpdateRun({
        sourceId: 1, catalogRevision: 2, evaluations: batch.evaluations, templates: [revision2], automatic: false,
      })
      const reviewGroup = store.getRegistryUpdateGroups().find((group: any) => group.status === 'review') as any
      const blockedGroup = store.getRegistryUpdateGroups().find((group: any) => group.status === 'blocked') as any

      expect(reviewGroup.members.map((member: any) => member.linkId)).toEqual([links[0].id])
      expect(blockedGroup.members.map((member: any) => member.linkId)).toEqual([links[1].id])
      store.applyRegistryUpdateGroupById({
        groupId: reviewGroup.id,
        concurrencyToken: reviewGroup.concurrencyToken,
        template: revision2,
      })

      expect((store.getRegistryState() as any).links).toEqual([
        expect.objectContaining({ id: links[0].id, state: 'linked', importedRevision: 2 }),
        expect.objectContaining({ id: links[1].id, state: 'update-available', importedRevision: 1, availableRevision: 2 }),
      ])
      expect(store.getRegistryUpdateGroups()).toEqual(expect.arrayContaining([
        expect.objectContaining({ status: 'applied', members: [expect.objectContaining({ linkId: links[0].id })] }),
        expect.objectContaining({ status: 'blocked', members: [expect.objectContaining({ linkId: links[1].id })] }),
      ]))
    } finally {
      store.close()
    }
  })

  test('persists a same-revision catalog adoption without treating it as a rollback', async () => {
    const store = await emptyFixtureStore()
    try {
      store.registryTransaction((draft: any) => {
        draft.sources = [{ id: 1, kind: 'official-connected', displayName: 'Official Catalog', enabled: true, createdAt: '2026-08-12T00:00:00.000Z' }]
        draft.snapshot = { sourceId: 1, revision: 17, generatedAt: '2026-08-12T00:00:00.000Z', expiresAt: null, activatedAt: '2026-08-12T00:00:00.000Z', digest: 'b'.repeat(64), templateCount: 1, keyId: 'test-key' }
      })
      const template = await catalogTemplate({
        type: 'cpu', name: 'Adopted CPU', manufacturer: 'Example', model: 'CPU-ADOPT', specs: { cores: 4 },
      })
      store.createCatalogInventoryItems(template)
      const link = (store.getRegistryState() as any).links[0]
      store.registryTransaction((draft: any) => Object.assign(draft.links[0], {
        state: 'adoption-available',
        availableRevision: 1,
        availableContentHash: template.contentHash,
      }))
      const batch = store.evaluateCatalogUpdates([{ linkId: link.id, templateKey: link.templateKey }], [template])
      const result = store.commitCatalogUpdateRun({
        sourceId: 1,
        catalogRevision: 17,
        evaluations: batch.evaluations,
        templates: [template],
        automatic: true,
        expectedProjectRevisions: batch.projectRevisions,
      })

      expect(result.applied).toBe(1)
      expect((store.getRegistryState() as any).links[0]).toMatchObject({
        state: 'linked', importedRevision: 1,
      })
      expect(store.getRegistryUpdateGroups()).toEqual([
        expect.objectContaining({ status: 'applied', fromRevision: 1, toRevision: 1 }),
      ])
    } finally {
      store.close()
    }
  })

  test('evaluates and advances every project containing a shared registry item', async () => {
    const store = await emptyFixtureStore()
    try {
      store.registryTransaction((draft: any) => {
        draft.sources = [{ id: 1, kind: 'official-connected', displayName: 'Official Catalog', enabled: true, createdAt: '2026-08-12T00:00:00.000Z' }]
        draft.snapshot = { sourceId: 1, revision: 2, generatedAt: '2026-08-12T00:00:00.000Z', expiresAt: null, activatedAt: '2026-08-12T00:00:00.000Z', digest: 'b'.repeat(64), templateCount: 1, keyId: 'test-key' }
      })
      const revision1 = await catalogTemplate({
        type: 'cpu', name: 'Shared CPU', manufacturer: 'Example', model: 'CPU-SHARED', specs: { cores: 4 },
      })
      const revision2 = await catalogTemplate({
        ...revision1.item, specs: { ...revision1.item.specs, threads: 8 },
      }, 2)
      store.createCatalogInventoryItems(revision1)
      const link = (store.getRegistryState() as any).links[0]
      const second = store.createProject({ name: 'Secondary lab' })
      store.addGlobalInventoryMembership(second.project.id, { type: link.itemType, id: link.itemId })
      store.registryTransaction((draft: any) => Object.assign(draft.links[0], {
        state: 'update-available',
        availableRevision: 2,
        availableContentHash: revision2.contentHash,
      }))
      const before = new Map(store.listProjects().map((project) => [project.id, project.revision]))
      const batch = store.evaluateCatalogUpdates([{ linkId: link.id, templateKey: link.templateKey }], [revision2])

      expect(batch.projectRevisions).toEqual({
        1: before.get(1),
        [second.project.id]: before.get(second.project.id),
      })
      store.commitCatalogUpdateRun({
        sourceId: 1,
        catalogRevision: 2,
        evaluations: batch.evaluations,
        templates: [revision2],
        automatic: true,
        expectedProjectRevisions: batch.projectRevisions,
      })

      const after = new Map(store.listProjects().map((project) => [project.id, project.revision]))
      expect(after.get(1)).toBe(before.get(1)! + 1)
      expect(after.get(second.project.id)).toBe(before.get(second.project.id)! + 1)
      expect(store.getWorkspace(second.project.id, second.defaultWorkspaceId).items[`cpu:${link.itemId}`].specs?.threads).toBe(8)
    } finally {
      store.close()
    }
  })

  test('updates a registry-linked item owned only by a non-default project', async () => {
    const store = await emptyFixtureStore()
    try {
      store.registryTransaction((draft: any) => {
        draft.sources = [{ id: 1, kind: 'official-connected', displayName: 'Official Catalog', enabled: true, createdAt: '2026-08-12T00:00:00.000Z' }]
        draft.snapshot = { sourceId: 1, revision: 2, generatedAt: '2026-08-12T00:00:00.000Z', expiresAt: null, activatedAt: '2026-08-12T00:00:00.000Z', digest: 'b'.repeat(64), templateCount: 1, keyId: 'test-key' }
      })
      const second = store.createProject({ name: 'Secondary lab' })
      const scoped = store.forWorkspace(second.project.id, second.defaultWorkspaceId)
      const revision1 = await catalogTemplate({
        type: 'cpu', name: 'Project CPU', manufacturer: 'Example', model: 'CPU-PROJECT', specs: { cores: 4 },
      })
      const revision2 = await catalogTemplate({ ...revision1.item, specs: { ...revision1.item.specs, threads: 8 } }, 2)
      scoped.createCatalogInventoryItems(revision1, 1, { scope: 'project' })
      const link = (store.getRegistryState() as any).links[0]
      store.registryTransaction((draft: any) => Object.assign(draft.links[0], {
        state: 'update-available', availableRevision: 2, availableContentHash: revision2.contentHash,
      }))
      const rootRevision = store.getProject().revision
      const secondaryRevision = store.getWorkspace(second.project.id, second.defaultWorkspaceId).revision
      const batch = store.evaluateCatalogUpdates([{ linkId: link.id, templateKey: link.templateKey }], [revision2])

      store.commitCatalogUpdateRun({
        sourceId: 1, catalogRevision: 2, evaluations: batch.evaluations, templates: [revision2], automatic: true,
        expectedProjectRevisions: batch.projectRevisions,
      })

      expect(store.getProject().revision).toBe(rootRevision)
      expect(store.getWorkspace(second.project.id, second.defaultWorkspaceId)).toMatchObject({
        revision: secondaryRevision + 1,
        items: { [`cpu:${link.itemId}`]: expect.objectContaining({ specs: expect.objectContaining({ threads: 8 }) }) },
      })
    } finally {
      store.close()
    }
  })

  test('declines only the current catalog revision and reoffers a newer revision', async () => {
    const store = await emptyFixtureStore()
    try {
      store.registryTransaction((draft: any) => {
        draft.sources = [{ id: 1, kind: 'official-connected', displayName: 'Official Catalog', enabled: true, createdAt: '2026-08-12T00:00:00.000Z' }]
        draft.snapshot = { sourceId: 1, revision: 2, generatedAt: '2026-08-12T00:00:00.000Z', expiresAt: null, activatedAt: '2026-08-12T00:00:00.000Z', digest: 'b'.repeat(64), templateCount: 1, keyId: 'test-key' }
      })
      const revision1 = await catalogTemplate({ type: 'cpu', name: 'Example CPU 200', manufacturer: 'Example', model: 'CPU-200', specs: { cores: 4 } })
      const revision2 = await catalogTemplate({ ...revision1.item, specs: { cores: 6 } }, 2)
      const revision3 = await catalogTemplate({ ...revision1.item, specs: { cores: 8 } }, 3)
      store.createCatalogInventoryItems(revision1)
      const link = (store.getRegistryState() as any).links[0]
      store.registryTransaction((draft: any) => Object.assign(draft.links[0], { state: 'update-available', availableRevision: 2, availableContentHash: revision2.contentHash }))
      const evaluate = (template: any) => [{ ...store.evaluateCatalogUpdate(link.id, template), targetContentHash: template.contentHash }]
      store.commitCatalogUpdateRun({ sourceId: 1, catalogRevision: 2, evaluations: evaluate(revision2), templates: [revision2], automatic: false })
      expect((store.getRegistryState() as any).updateRuns[0]).toMatchObject({ appliedCount: 0, reviewCount: 1, skippedCount: 0 })
      const reviewGroup = store.getRegistryUpdateGroups().find((group: any) => group.status === 'review') as any
      store.updateInventoryItemProperties({ type: link.itemType, id: link.itemId }, { localNote: 'keep local' })
      expect(() => store.decideRegistryUpdateGroupById({
        groupId: reviewGroup.id,
        concurrencyToken: reviewGroup.concurrencyToken,
        decision: 'declined',
      })).toThrow(/refresh before continuing/iu)
      const refreshedGroup = store.getRegistryUpdateGroups().find((group: any) => group.status === 'review') as any
      const receipt = store.decideRegistryUpdateGroupById({
        groupId: refreshedGroup.id,
        concurrencyToken: refreshedGroup.concurrencyToken,
        decision: 'declined',
      })
      expect(receipt).toMatchObject({
        decisions: [{ previousGroupId: refreshedGroup.id, status: 'declined' }],
        affectedProjectIds: [],
      })
      expect((store.getRegistryState() as any).updateRuns[0]).toMatchObject({ appliedCount: 0, reviewCount: 0, skippedCount: 1 })
      const declinedState = await store.snapshotStores()
      store.decideRegistryUpdateGroups({
        groups: [{ templateKey: revision2.templateKey, toRevision: 2 }],
        decision: 'declined',
      })
      expect((await store.snapshotStores()).registry).toEqual(declinedState.registry)
      store.commitCatalogUpdateRun({ sourceId: 1, catalogRevision: 2, evaluations: evaluate(revision2), templates: [revision2], automatic: true })
      expect(store.getRegistryUpdateGroups()).toEqual([expect.objectContaining({ status: 'declined', toRevision: 2 })])

      store.registryTransaction((draft: any) => {
        draft.snapshot.revision = 3
        Object.assign(draft.links[0], { state: 'update-available', availableRevision: 3, availableContentHash: revision3.contentHash })
      })
      store.commitCatalogUpdateRun({ sourceId: 1, catalogRevision: 3, evaluations: evaluate(revision3), templates: [revision3], automatic: false })
      expect(store.getRegistryUpdateGroups()).toEqual(expect.arrayContaining([
        expect.objectContaining({ status: 'declined', toRevision: 2 }),
        expect.objectContaining({ status: 'review', toRevision: 3 }),
      ]))
      store.decideRegistryUpdateGroups({
        groups: [{ templateKey: revision2.templateKey, toRevision: 2 }],
        decision: 'pending',
      })
      const reconsideredState = await store.snapshotStores()
      store.decideRegistryUpdateGroups({
        groups: [{ templateKey: revision2.templateKey, toRevision: 2 }],
        decision: 'pending',
      })
      expect((await store.snapshotStores()).registry).toEqual(reconsideredState.registry)
    } finally {
      store.close()
    }
  })

  test('persists bounded retry state for failed catalog evaluation runs', async () => {
    const store = await emptyFixtureStore()
    try {
      store.registryTransaction((draft: any) => {
        draft.sources = [{ id: 1, kind: 'official-connected', displayName: 'Official Catalog', enabled: true, createdAt: '2026-08-12T00:00:00.000Z' }]
      })
      store.recordCatalogUpdateFailure({ sourceId: 1, catalogRevision: 4, error: new Error('temporary catalog failure') })
      expect(store.getRegistryUpdateStatus()).toMatchObject({
        catalogRevision: 4,
        state: 'failed',
        attemptCount: 1,
        retryAfter: '2026-08-12T01:01:00.000Z',
        error: 'temporary catalog failure',
      })
      store.recordCatalogUpdateFailure({ sourceId: 1, catalogRevision: 4, error: new Error('still unavailable') })
      expect(store.getRegistryUpdateStatus()).toMatchObject({
        state: 'failed',
        attemptCount: 2,
        retryAfter: '2026-08-12T01:02:00.000Z',
        error: 'still unavailable',
      })
    } finally {
      store.close()
    }
  })

  test('rejects a mixed catalog update batch without partially applying valid groups', async () => {
    const store = await emptyFixtureStore()
    try {
      store.registryTransaction((draft: any) => {
        draft.sources = [{ id: 1, kind: 'official-connected', displayName: 'Official Catalog', enabled: true, createdAt: '2026-08-12T00:00:00.000Z' }]
        draft.snapshot = { sourceId: 1, revision: 2, generatedAt: '2026-08-12T00:00:00.000Z', expiresAt: null, activatedAt: '2026-08-12T00:00:00.000Z', digest: 'b'.repeat(64), templateCount: 1, keyId: 'test-key' }
      })
      const revision1 = await catalogTemplate({ type: 'cpu', name: 'Example CPU 200', manufacturer: 'Example', model: 'CPU-200', specs: { cores: 4 } })
      const revision2 = await catalogTemplate({ ...revision1.item, specs: { cores: 6 } }, 2)
      const unavailableRevision = await catalogTemplate({ ...revision1.item, specs: { cores: 8 } }, 3)
      store.createCatalogInventoryItems(revision1)
      store.registryTransaction((draft: any) => Object.assign(draft.links[0], {
        state: 'update-available',
        availableRevision: 2,
        availableContentHash: revision2.contentHash,
      }))
      const beforeRevision = store.getProject().revision

      expect(() => store.applyRegistryUpdateGroups([revision2, unavailableRevision])).toThrow('One or more registry update groups were not found.')
      expect(store.getProject().revision).toBe(beforeRevision)
      expect((store.getRegistryState() as any).links[0]).toMatchObject({ state: 'update-available', importedRevision: 1, availableRevision: 2 })
    } finally {
      store.close()
    }
  })

  test('rolls back a catalog import when its registry link cannot persist', async () => {
    const store = await fixtureStore()
    try {
      store.registryTransaction((draft: any) => {
        draft.snapshot = {
          sourceId: 1,
          revision: 1,
          generatedAt: '2026-08-12T00:00:00.000Z',
          expiresAt: null,
          activatedAt: '2026-08-12T00:00:00.000Z',
          digest: 'b'.repeat(64),
          templateCount: 1,
          keyId: 'test-key',
        }
      })
      const template = await catalogTemplate({
        type: 'cpu', name: 'Rollback CPU', manufacturer: 'Example', model: 'ROLLBACK-1',
        specs: { cores: 4, threads: 8, socket: 'LGA1200' },
      })
      const beforeProject = store.getProject()
      const beforeRegistry = store.getRegistryState()
      store.core.database.exec(`
        CREATE TEMP TRIGGER reject_catalog_link
        BEFORE INSERT ON registry_links
        BEGIN
          SELECT RAISE(ABORT, 'injected registry failure');
        END;
      `)

      expect(() => store.createCatalogInventoryItems(template)).toThrow(/injected registry failure/iu)
      expect(store.getProject()).toEqual(beforeProject)
      expect(store.getRegistryState()).toEqual(beforeRegistry)
    } finally {
      store.close()
    }
  })

  test('round-trips authentication and backup management transactions', async () => {
    const store = await fixtureStore()
    try {
      const authentication = store.updateAuthentication((draft: any) => {
        draft.configuration.localEnabled = true
        draft.configuration.enabled = true
        draft.configuration.updatedAt = '2026-08-12T01:00:00.000Z'
      })
      expect(authentication.configuration).toMatchObject({ enabled: true, localEnabled: true })
      expect(authentication.accounts).toHaveLength(1)
      expect(authentication.accounts[0]).toMatchObject({ id: 1, username: 'owner' })

      const backups = store.updateBackupManagement((draft: any) => {
        draft.schedule.time = '04:15'
        draft.schedule.retention = 21
      })
      expect(backups.schedule).toMatchObject({ time: '04:15', retention: 21 })
      expect(backups.backups).toHaveLength(1)
      expect(backups.restores).toEqual([])
    } finally {
      store.close()
    }
  })

  test('preserves public agent IDs and supports enrollment through heartbeat', async () => {
    const store = await fixtureStore()
    try {
      expect(store.findAgentDevice({ deviceId: 4, hostType: 'server', hostId: 7, protocolMajor: 1 })).toMatchObject({
        id: 4,
        hostType: 'server',
        hostId: 7,
      })
      const tokenHash = 'a'.repeat(64)
      const enrollment = store.createAgentEnrollment({
        hostType: 'server',
        hostId: 7,
        protocolMajor: 1,
        tokenHash,
        endpoint: 'https://inventory.example.test',
        createdAt: '2026-08-12T01:00:00.000Z',
        expiresAt: '2026-08-12T02:00:00.000Z',
      })
      expect(store.findAgentEnrollment({
        hostType: 'server', hostId: 7, protocolMajor: 1, tokenHash,
        nowMs: Date.parse('2026-08-12T01:30:00.000Z'),
      })).toMatchObject({ id: enrollment.id })

      const activated = store.activateAgentEnrollment({
        enrollmentId: enrollment.id,
        device: {
          hostType: 'server',
          hostId: 7,
          protocolMajor: 1,
          publicKey: 'replacement-agent-public-key',
          agentVersion: '0.2.0',
          capabilities: { hardware: true },
          createdAt: '2026-08-12T01:05:00.000Z',
          lastSeenAt: null,
          lastSequence: 0,
        },
      })
      expect(activated.revokedDeviceIds).toEqual([4])
      expect(activated.device.id).toBe(5)
      const heartbeat = store.recordAgentHeartbeat({
        deviceId: 5,
        host: { hostType: 'server', hostId: 7 },
        sequence: 1,
        status: {
          lastSeenAt: '2026-08-12T01:06:00.000Z',
          agentVersion: '0.2.0',
          hostname: 'fixture-host',
        },
      })
      expect(heartbeat.device.lastSequence).toBe(1)
      expect(store.getAgentStatusSummary({ now: Date.parse('2026-08-12T01:06:30.000Z') }).hosts['server:7']).toMatchObject({
        hostname: 'fixture-host', state: 'online', connected: true,
      })
    } finally {
      store.close()
    }
  })

  test('exports logical backup sections without runtime relationship keys', async () => {
    const store = await fixtureStore()
    try {
      const snapshot = await store.snapshotStores()
      expect(snapshot.meta.schemaVersion).toBe(29)
      expect(snapshot.project.placements[0]).toMatchObject({ itemType: 'server', itemId: 7 })
      expect(snapshot.project.assignments[0]).toMatchObject({ hostType: 'server', hostId: 7 })
      expect(snapshot.project.connections[0].from).toMatchObject({ itemType: 'switch', itemId: 1 })
      expect(Number.isSafeInteger(snapshot.project.connections[0].to.itemId)).toBe(true)
      expect(snapshot.project.placements.every((placement: any) => (
        Number.isSafeInteger(placement.itemId) && typeof placement.itemType === 'string'
      ))).toBe(true)
    } finally {
      store.close()
    }
  })

  test('restores one inventory section through an isolated SQLite file swap', async () => {
    const store = await fixtureStore()
    try {
      const before = await store.snapshotStores()
      const projectBefore = structuredClone(before.project)
      const server = store.getProject().items['server:7'] as any
      store.updateInventoryItem({ type: 'server', id: 7 }, { ...server, name: 'Temporary name' })
      const projectImmediatelyBeforeRestore = (await store.snapshotStores()).project

      const restored = await store.replaceStoresAtomically({ inventory: before.inventory })

      expect((store.getProject().items['server:7'] as any).name).toBe(server.name)
      expect((await store.snapshotStores()).project).toEqual(projectImmediatelyBeforeRestore)
      expect(projectImmediatelyBeforeRestore).not.toEqual(projectBefore)
      expect(restored.inventory).toEqual(before.inventory)
      expect((await stat(store.core.filePath)).mode & 0o777).toBe(0o600)
      expect(store.getPersistenceHealth()).toMatchObject({ ok: true, engine: 'sqlite' })
    } finally {
      store.close()
    }
  })

  test('restores routing cache without changing authoritative project state', async () => {
    const store = await fixtureStore()
    try {
      const before = await store.snapshotStores()
      store.setRoutingCache({ plannerVersion: 'temporary', geometryFingerprint: 'temporary', entries: [] })

      await store.replaceStoresAtomically({ routingCache: before.routingCache })

      const { workspaces: _workspaces, ...activeCache } = before.routingCache
      expect(store.getRoutingCache()).toEqual(activeCache)
      expect((await store.snapshotStores()).project).toEqual(before.project)
    } finally {
      store.close()
    }
  })

  test('rejects a selective inventory restore that would orphan untouched relationships', async () => {
    const store = await fixtureStore()
    try {
      const before = await store.snapshotStores()
      const invalidInventory = structuredClone(before.inventory)
      invalidInventory.servers = invalidInventory.servers.filter((server: any) => server.id !== 7)

      await expect(store.replaceStoresAtomically({ inventory: invalidInventory })).rejects.toThrow()

      expect(await store.snapshotStores()).toEqual(before)
      expect(store.getPersistenceHealth()).toMatchObject({ ok: true })
    } finally {
      store.close()
    }
  })

  test('round-trips a complete logical core snapshot with relational integrity', async () => {
    const store = await fixtureStore()
    try {
      const before = await store.snapshotStores()

      await store.replaceStoresAtomically(before)

      expect(await store.snapshotStores()).toEqual(before)
      expect(store.getPersistenceHealth()).toMatchObject({ ok: true })
    } finally {
      store.close()
    }
  })

  test('rebuilds selected dependent domains before removing obsolete inventory hosts', async () => {
    const store = await fixtureStore((snapshot) => {
      snapshot.notificationState.incidents = []
      snapshot.notificationState.deliveryJobs = []
    })
    try {
      const replacement = await store.snapshotStores()
      replacement.inventory.servers = replacement.inventory.servers.filter((server: any) => server.id !== 7)
      replacement.project.placements = replacement.project.placements.filter((placement: any) => (
        placement.itemType !== 'server' || placement.itemId !== 7
      ))
      replacement.project.assignments = replacement.project.assignments.filter((assignment: any) => (
        assignment.hostType !== 'server' || assignment.hostId !== 7
      ))
      replacement.project.connections = replacement.project.connections.filter((connection: any) => (
        ![connection.from, connection.to].some((endpoint: any) => (
          (endpoint.itemType === 'server' && endpoint.itemId === 7)
          || (endpoint.hostedItemType === 'server' && endpoint.hostedItemId === 7)
        ))
      ))
      replacement.project.compatibilityPolicy = { disabledHosts: [], ignoredWarningIds: [] }
      delete replacement.project.workbooks
      replacement.agents = { enrollments: {}, devices: {}, hardwareSnapshots: {}, hardwareEvents: {} }
      replacement.agentStatus = { hosts: {} }

      await store.replaceStoresAtomically(replacement)

      expect(store.getProject().items['server:7']).toBeUndefined()
      expect(store.getProject().assignments).toEqual([])
      expect(store.getAgentStatusSummary().registeredHosts).toEqual([])
      expect(store.getPersistenceHealth()).toMatchObject({ ok: true })
    } finally {
      store.close()
    }
  })
})
