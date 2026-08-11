import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CORE_MIGRATIONS } from './core/migrations/manifest.ts'
import { schema29ProductionShapeFixture } from './fixtures/schema-29-production-shape.ts'
import { buildCanonicalIdentityPlan } from './legacy/identity-plan.ts'
import { importLegacyCore } from './migration/core-importer.ts'
import { openManagedDatabase } from './sqlite/database.ts'
import { applyCommittedMigrations } from './sqlite/migrator.ts'
import { SqliteHomelabInventoryStore } from './sqlite-store.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixtureStore() {
  const root = await mkdtemp(join(tmpdir(), 'homelab-inventory-sqlite-store-'))
  roots.push(root)
  const handle = await openManagedDatabase({ filePath: join(root, 'core.sqlite'), schemaName: 'core' })
  await applyCommittedMigrations(handle, await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
    id: migration.id,
    sha256: migration.sha256,
    sql: await readFile(resolve(import.meta.dir, 'core/migrations/generated', migration.file), 'utf8'),
  }))))
  const snapshot = schema29ProductionShapeFixture()
  importLegacyCore({ database: handle.database, snapshot, identityPlan: buildCanonicalIdentityPlan(snapshot) })
  return new SqliteHomelabInventoryStore({
    core: handle,
    now: () => Date.parse('2026-08-12T01:00:00.000Z'),
  })
}

describe('SQLite Homelab Inventory store facade', () => {
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
      expect(store.getDatabaseStatus()).toMatchObject({ schemaVersion: 7 })
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
})
