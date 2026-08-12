import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CORE_MIGRATIONS } from '../core/migrations/manifest.ts'
import { schema29ProductionShapeFixture } from '../fixtures/schema-29-production-shape.ts'
import { buildCanonicalIdentityPlan } from '../legacy/identity-plan.ts'
import { importLegacyCore } from '../migration/core-importer.ts'
import { openManagedDatabase } from '../sqlite/database.ts'
import { applyCommittedMigrations } from '../sqlite/migrator.ts'
import { SqliteHomelabInventoryStore } from '../sqlite-store.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixtureStore() {
  const root = await mkdtemp(join(tmpdir(), 'hli-multi-project-recovery-'))
  roots.push(root)
  const core = await openManagedDatabase({
    filePath: join(root, 'homelab-inventory.sqlite'),
    schemaName: 'core',
  })
  await applyCommittedMigrations(core, await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
    id: migration.id,
    sha256: migration.sha256,
    sql: await readFile(resolve(import.meta.dir, '../core/migrations/generated', migration.file), 'utf8'),
  }))))
  const snapshot = schema29ProductionShapeFixture()
  importLegacyCore({ database: core.database, snapshot, identityPlan: buildCanonicalIdentityPlan(snapshot) })
  return new SqliteHomelabInventoryStore({
    core,
    dataDir: root,
    appVersion: '0.12.0',
    now: () => Date.parse('2026-08-12T03:00:00.000Z'),
  })
}

describe('multi-project logical recovery', () => {
  test('round-trips projects, workspaces, scopes, memberships, layouts, and topology', async () => {
    const store = await fixtureStore()
    try {
      const secondCanvas = store.createWorkspace(1, {
        type: 'canvas',
        name: 'Network plan',
        iconKey: 'network',
        colorKey: 'cyan',
      }).workspaces.find((workspace) => workspace.name === 'Network plan')!
      store.updateCanvasWorkspaceConfiguration(1, secondCanvas.id, {
        viewport: { x: 144, y: -48, zoom: 0.85 },
        settings: { snapItemsToGrid: true, networkCablesVisible: false },
      })
      const secondCanvasState = store.getWorkspace(1, secondCanvas.id)
      secondCanvasState.placements = [{ serverId: 'server:7', x: 720, y: 360 }]
      store.setWorkspace(1, secondCanvas.id, secondCanvasState)

      const downsized = store.createProject({ name: 'Downsize plan' })
      const projectId = downsized.project.id
      const canvasId = downsized.defaultWorkspaceId
      store.addGlobalInventoryMembership(projectId, { type: 'server', id: 7 })
      const sourceCpu = Object.values(store.getWorkspace(1, 2).items)
        .find((item: any) => item.type === 'cpu') as any
      const duplicated = store.duplicateInventoryToProject(1, projectId, {
        type: 'cpu',
        id: sourceCpu.id,
      })
      const duplicateCpu = Object.values(duplicated.project.items).find((item: any) => (
        item.type === 'cpu' && item.id !== sourceCpu.id
      )) as any
      expect(duplicateCpu).toMatchObject({ scope: 'project', ownerProjectId: projectId })

      const duplicatedSwitchProject = store.duplicateInventoryToProject(1, projectId, { type: 'switch', id: 1 }).project
      const duplicateSwitch = Object.values(duplicatedSwitchProject.items).find((item: any) => (
        item.type === 'switch' && item.id !== 1
      )) as any
      const duplicatedPatchProject = store.duplicateInventoryToProject(1, projectId, { type: 'patchPanel', id: 1 }).project
      const duplicatePatch = Object.values(duplicatedPatchProject.items).find((item: any) => (
        item.type === 'patchPanel' && item.id !== 1
      )) as any

      const sourceConnection = store.getWorkspace(1, 2).connections[0]
      const downsizedState = store.getWorkspace(projectId, canvasId)
      const switchPort = duplicateSwitch.ports[0]
      const patchPort = duplicatePatch.ports[0]
      downsizedState.placements = [
        { serverId: 'server:7', x: 120, y: 96 },
        { serverId: `switch:${duplicateSwitch.id}`, x: 540, y: 96 },
        { serverId: `patchPanel:${duplicatePatch.id}`, x: 540, y: 360 },
      ]
      downsizedState.connections = [{
        ...structuredClone(sourceConnection),
        id: 100,
        from: { itemId: `switch:${duplicateSwitch.id}`, portId: switchPort.id },
        to: {
          itemId: `patchPanel:${duplicatePatch.id}`,
          portId: patchPort.id,
          ...(patchPort.endpoints?.[0]?.id === undefined ? {} : { endpointId: patchPort.endpoints[0].id }),
        },
        route: {
          ...structuredClone(sourceConnection.route),
          bendPoints: [{ x: 420, y: 180 }, { x: 420, y: 300 }],
        },
      }]
      downsizedState.assignments = []
      downsizedState.compatibilityPolicy = {
        disabledHosts: [{ hostType: 'server', hostId: 7 }],
        ignoredWarningIds: ['downsize:known-warning'],
      }
      store.setWorkspace(projectId, canvasId, downsizedState)

      const before = await store.snapshotStores()
      expect(before.project.workbooks.tables.projects).toHaveLength(2)
      expect(before.project.workbooks.tables.canvas_workspaces).toHaveLength(3)
      expect(before.project.workbooks.tables.project_inventory_memberships.some((row: any) => (
        row.project_id === projectId
      ))).toBe(true)

      store.updateProject(projectId, { name: 'Temporary name', includesGlobalInventory: true })
      store.updateWorkspaceMetadata(1, secondCanvas.id, { name: 'Temporary canvas' })
      store.updateCanvasWorkspaceConfiguration(1, secondCanvas.id, {
        viewport: { x: 0, y: 0, zoom: 1 },
        settings: { snapItemsToGrid: false },
      })

      await store.replaceStoresAtomically({
        inventory: before.inventory,
        project: before.project,
        routingCache: before.routingCache,
      })

      const after = await store.snapshotStores()
      expect(after.inventory).toEqual(before.inventory)
      expect(after.project).toEqual(before.project)
      expect(after.routingCache).toEqual(before.routingCache)
      expect(store.getProjectWorkbook(projectId).project.name).toBe('Downsize plan')
      expect(store.getProjectWorkbook(1).workspaces.find((workspace) => workspace.id === secondCanvas.id))
        .toMatchObject({
          name: 'Network plan',
          viewportX: 144,
          viewportY: -48,
          viewportZoomBasisPoints: 8500,
          settings: { snapItemsToGrid: true, networkCablesVisible: false },
        })
      const restoredDownsize = store.getWorkspace(projectId, canvasId)
      expect(restoredDownsize.placements).toContainEqual({ serverId: 'server:7', x: 120, y: 96 })
      expect(restoredDownsize.connections.some((connection) => connection.id === 100)).toBe(true)
      expect(restoredDownsize.compatibilityPolicy).toEqual({
          disabledHosts: [{ hostType: 'server', hostId: 7 }],
          ignoredWarningIds: ['downsize:known-warning'],
      })
      expect(store.getPersistenceHealth()).toMatchObject({ ok: true })
    } finally {
      store.close()
    }
  })
})
