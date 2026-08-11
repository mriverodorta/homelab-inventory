import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { digestCatalogTemplate } from '../../packages/catalog-protocol/src/index.ts'
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

async function catalogTemplate(item: Record<string, unknown>, revision = 1, templateKey = 'cpu-example-cpu-200') {
  const projection = await digestCatalogTemplate(item)
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
      expect(store.getDatabaseStatus()).toMatchObject({ schemaVersion: 10 })
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
})
