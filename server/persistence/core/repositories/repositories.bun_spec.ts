import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CORE_MIGRATIONS } from '../migrations/manifest.ts'
import { buildLegacyProjectProjection } from '../projections/legacy-project.ts'
import { schema29ProductionShapeFixture } from '../../fixtures/schema-29-production-shape.ts'
import { buildCanonicalIdentityPlan } from '../../legacy/identity-plan.ts'
import { importLegacyCore } from '../../migration/core-importer.ts'
import { closeManagedDatabase, openManagedDatabase } from '../../sqlite/database.ts'
import { applyCommittedMigrations } from '../../sqlite/migrator.ts'
import { createAgentRepository } from './agent-repository.ts'
import { createAuthRepository } from './auth-repository.ts'
import { createBackupRepository } from './backup-repository.ts'
import { createInventoryRepository } from './inventory-repository.ts'
import { createNotificationRepository } from './notification-repository.ts'
import { createProjectRepository } from './project-repository.ts'
import { createRegistryRepository } from './registry-repository.ts'
import { createRepositoryContext } from './repository-context.ts'
import { createRoutingRepository } from './routing-repository.ts'
import { createTopologyRepository } from './topology-repository.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixtureContext() {
  const root = await mkdtemp(join(tmpdir(), 'homelab-inventory-repository-'))
  roots.push(root)
  const handle = await openManagedDatabase({ filePath: join(root, 'core.sqlite'), schemaName: 'core' })
  await applyCommittedMigrations(handle, await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
    id: migration.id,
    sha256: migration.sha256,
    sql: await readFile(resolve(import.meta.dir, '../migrations/generated', migration.file), 'utf8'),
  }))))
  const snapshot = schema29ProductionShapeFixture()
  importLegacyCore({ database: handle.database, snapshot, identityPlan: buildCanonicalIdentityPlan(snapshot) })
  return { handle, context: createRepositoryContext(handle.database, () => Date.parse('2026-08-12T00:00:00.000Z')), snapshot }
}

describe('relational persistence repositories', () => {
  test('provides project and workspace CRUD with independent revisions', async () => {
    const { handle, context } = await fixtureContext()
    try {
      const repository = createProjectRepository(context)
      handle.database.query(`
        UPDATE inventory_items SET scope = 'global', owner_project_id = NULL WHERE id = 1
      `).run()
      expect(() => repository.update(1, { includesGlobalInventory: false })).toThrow(/global membership/iu)
      expect(repository.getWorkbook(1)).toMatchObject({
        project: { id: 1, name: 'Default Project' },
        defaultWorkspaceId: 2,
        workspaces: [
          { id: 1, type: 'systems', name: 'Systems', sortOrder: 0 },
          { id: 2, type: 'canvas', name: 'Canvas', sortOrder: 1 },
        ],
      })
      const created = repository.create({ name: 'Downsize plan', includesGlobalInventory: false })
      expect(created.project.id).toBe(2)
      expect(repository.listWorkspaces(2).map(({ type }) => type)).toEqual(['systems', 'canvas'])
      const secondary = repository.createWorkspace(2, { type: 'canvas', name: 'Network', iconKey: 'network', colorKey: 'green' })
      repository.setDefaultWorkspace(2, secondary.id)
      expect(repository.get(2)).toMatchObject({ revision: 1, workbookRevision: 3 })
      repository.update(2, { name: 'Smaller homelab' })
      expect(repository.get(2)).toMatchObject({
        name: 'Smaller homelab',
        revision: 1,
        workbookRevision: 4,
      })
      expect(() => repository.updateWorkspace(2, created.systemsWorkspaceId, { name: 'Hosts' })).toThrow(/Systems/iu)
      repository.updateWorkspace(2, secondary.id, { name: 'Network plan', iconKey: 'route', colorKey: 'cyan' })
      repository.updateCanvasConfiguration(2, secondary.id, {
        settings: { snapItemsToGrid: true, networkCablesVisible: false },
        viewport: { x: 12.4, y: -25.6, zoom: 0.75 },
      })
      expect(repository.getWorkbook(2).workspaces.at(-1)).toMatchObject({
        id: secondary.id,
        name: 'Network plan',
        iconKey: 'route',
        colorKey: 'cyan',
        settings: { snapItemsToGrid: true, networkCablesVisible: false },
        viewportX: 12,
        viewportY: -26,
        viewportZoomBasisPoints: 7500,
      })
      expect(() => repository.updateCanvasConfiguration(2, created.systemsWorkspaceId, {
        settings: { snapItemsToGrid: true },
      })).toThrow(/Only Canvas/iu)
      expect(() => repository.updateCanvasConfiguration(2, secondary.id, {
        viewport: { x: 0, y: 0, zoom: 3 },
      })).toThrow(/viewport/iu)
      repository.reorderWorkspaces(2, [secondary.id, created.canvasWorkspaceId])
      expect(repository.listWorkspaces(2).map(({ id, sortOrder }) => ({ id, sortOrder }))).toEqual([
        { id: created.systemsWorkspaceId, sortOrder: 0 },
        { id: secondary.id, sortOrder: 1 },
        { id: created.canvasWorkspaceId, sortOrder: 2 },
      ])
      repository.archiveWorkspace(2, secondary.id)
      expect(repository.getWorkbook(2).defaultWorkspaceId).toBe(created.canvasWorkspaceId)
      expect(() => repository.archiveWorkspace(2, created.canvasWorkspaceId)).toThrow(/at least one Canvas/iu)
      expect(() => repository.archiveWorkspace(2, created.systemsWorkspaceId)).toThrow(/Systems/iu)
      repository.update(2, { name: 'Compact homelab' })
      expect(repository.get(2)?.name).toBe('Compact homelab')
      repository.archive(2)
      expect(repository.listActive().map(({ id }) => id)).toEqual([1])
      repository.restore(2)
      expect(repository.listActive().map(({ id }) => id)).toEqual([1, 2])
      expect(() => repository.archive(1)).toThrow(/default project/iu)
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('previews and permanently deletes only archived projects without removing global inventory', async () => {
    const { handle, context } = await fixtureContext()
    try {
      const projects = createProjectRepository(context)
      const inventory = createInventoryRepository(context)
      const created = projects.create({ name: 'Disposable plan' })
      const projectId = created.project.id
      const projectItem = inventory.create({
        type: 'server',
        name: 'Planning host',
        scope: 'project',
        ownerProjectId: projectId,
        projectIds: [projectId],
      })
      const globalItem = inventory.create({
        type: 'cpu',
        name: 'Shared CPU',
        scope: 'global',
        projectIds: [projectId],
      })
      const agent = handle.database.query(`
        INSERT INTO agents (public_key, protocol_major, agent_version, capabilities_json, created_at_ms)
        VALUES ('project-delete-agent', 1, '0.1.0', '{}', 1)
        RETURNING id
      `).get() as { id: number }
      handle.database.query(`
        INSERT INTO agent_host_bindings (agent_id, host_item_id, state, bound_at_ms)
        VALUES (?, ?, 'active', 1)
      `).run(agent.id, projectItem.id)

      projects.archive(projectId)
      expect(projects.listArchived().map(({ id }) => id)).toContain(projectId)
      expect(projects.deletionImpact(projectId)).toMatchObject({
        projectBoundItems: 1,
        globalMemberships: 1,
        activeAgentBindings: 1,
        externalProjectDependencies: 0,
      })
      expect(() => projects.removeArchived(projectId)).toThrow(/agent.*remain linked/iu)

      handle.database.query(`
        UPDATE agent_host_bindings
        SET state = 'unlinked', unbound_at_ms = 2
        WHERE agent_id = ?
      `).run(agent.id)
      expect(projects.removeArchived(projectId)).toMatchObject({
        projectId,
        projectBoundItems: 1,
        historicalAgentBindings: 1,
      })
      expect(projects.get(projectId)).toBeNull()
      expect(inventory.get(projectItem.id)).toBeNull()
      expect(inventory.get(globalItem.id)?.scope).toBe('global')
      expect(() => projects.removeArchived(1)).toThrow(/default project/iu)
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('supports typed inventory CRUD, optimistic versions, aliases, and dependency-aware removal', async () => {
    const { handle, context } = await fixtureContext()
    try {
      const repository = createInventoryRepository(context)
      expect(repository.resolveAlias('server', 7)).toBe(1)
      const created = repository.create({ type: 'cpu', name: 'Planning CPU', scope: 'project', ownerProjectId: 1, projectIds: [1] })
      expect(created.type).toBe('cpu')
      expect(repository.listForProject(1).some(({ id }) => id === created.id)).toBeTrue()
      expect(repository.update(created.id, 1, { model: 'Prototype' }).rowVersion).toBe(2)
      expect(() => repository.update(created.id, 1, { model: 'Stale' })).toThrow(/has changed/iu)
      repository.archive(created.id)
      expect(repository.get(created.id)?.archivedAtMs).not.toBeNull()
      repository.remove(created.id)
      expect(repository.get(created.id)).toBeNull()
      expect(() => repository.remove(repository.resolveAlias('cpu', 3)!)).toThrow(/dependencies/iu)
      expect(() => handle.database.query('UPDATE inventory_identity_aliases SET legacy_id = 99 WHERE legacy_type_key = ? AND legacy_id = ?').run('cpu', 3)).toThrow(/immutable/iu)
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('enforces exact slots and port availability at the topology boundary', async () => {
    const { handle, context } = await fixtureContext()
    try {
      const topology = createTopologyRepository(context)
      expect(topology.listAssignments(1, 2)).toHaveLength(4)
      const cpuId = createInventoryRepository(context).resolveAlias('cpu', 3)!
      const occupiedSlot = topology.listAssignments(1, 2)[0].resourceSlotId!
      expect(() => topology.assignComponent({ projectId: 1, workspaceId: 2, hostItemId: 1, componentItemId: cpuId, resourceSlotId: occupiedSlot })).toThrow()
      const usedPort = handle.database.query(`SELECT port_id, endpoint_face_id FROM connection_endpoints WHERE connection_id = 1 AND role = 'source'`).get() as { port_id: number; endpoint_face_id: number | null }
      expect(topology.portAvailability(2, usedPort.port_id, usedPort.endpoint_face_id)?.available).toBeFalse()
      expect(() => topology.createConnection({
        projectId: 1,
        workspaceId: 2,
        type: 'network',
        sourcePortId: usedPort.port_id,
        targetPortId: usedPort.port_id,
        sourceSide: 'left',
        targetSide: 'right',
      })).toThrow()
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('removes topology parents with dependent rows and keeps missing-record checks strict', async () => {
    const { handle, context } = await fixtureContext()
    try {
      const topology = createTopologyRepository(context)
      const projectRevision = () => (
        handle.database.query('SELECT revision FROM projects WHERE id = 1').get() as { revision: number }
      ).revision

      const assignmentId = 3
      const assignmentRevision = projectRevision()
      expect(handle.database.query(`
        SELECT count(*) AS count FROM component_assignment_slots WHERE assignment_id = ?
      `).get(assignmentId)).toEqual({ count: 1 })
      topology.unassignComponent(1, 2, assignmentId)
      expect(topology.listAssignments(1, 2).some((assignment) => assignment.id === assignmentId)).toBe(false)
      expect(handle.database.query(`
        SELECT count(*) AS count FROM component_assignment_slots WHERE assignment_id = ?
      `).get(assignmentId)).toEqual({ count: 0 })
      expect(projectRevision()).toBe(assignmentRevision + 1)
      expect(() => topology.unassignComponent(1, 2, assignmentId)).toThrow(/was not found/iu)
      expect(projectRevision()).toBe(assignmentRevision + 1)

      const connectionId = 1
      const connectionRevision = projectRevision()
      expect(handle.database.query(`
        SELECT count(*) AS count FROM connection_endpoints WHERE connection_id = ?
      `).get(connectionId)).toEqual({ count: 2 })
      topology.removeConnection(1, 2, connectionId)
      expect(handle.database.query(`
        SELECT count(*) AS count FROM connection_endpoints WHERE connection_id = ?
      `).get(connectionId)).toEqual({ count: 0 })
      expect(projectRevision()).toBe(connectionRevision + 1)
      expect(() => topology.removeConnection(1, 2, connectionId)).toThrow(/was not found/iu)
      expect(projectRevision()).toBe(connectionRevision + 1)
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('keeps route-cache writes outside project and workspace revisions', async () => {
    const { handle, context } = await fixtureContext()
    try {
      const routing = createRoutingRepository(context)
      const before = handle.database.query('SELECT p.revision AS project_revision, w.revision AS workspace_revision FROM projects p JOIN workspaces w ON w.id = 2 WHERE p.id = 1').get()
      routing.putRouteCache({ projectId: 1, workspaceId: 2, connectionId: 1, engineVersion: 'test', layoutFingerprint: 'layout-2', routeFingerprint: 'route-2', route: { points: [[1, 2]] } })
      const afterCache = handle.database.query('SELECT p.revision AS project_revision, w.revision AS workspace_revision FROM projects p JOIN workspaces w ON w.id = 2 WHERE p.id = 1').get()
      expect(afterCache).toEqual(before)
      expect(routing.getRouteCache(1, 2, 1)?.route).toEqual({ points: [[1, 2]] })
      routing.setPlacement({ projectId: 1, workspaceId: 2, itemId: 1, x: 144, y: 252 })
      const afterPlacement = handle.database.query('SELECT p.revision AS project_revision, w.revision AS workspace_revision FROM projects p JOIN workspaces w ON w.id = 2 WHERE p.id = 1').get() as { project_revision: number; workspace_revision: number }
      expect(afterPlacement.project_revision).toBe((before as any).project_revision + 1)
      expect(afterPlacement.workspace_revision).toBe((before as any).workspace_revision + 1)
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('exposes focused registry, agent, auth, notification, and backup reads', async () => {
    const { handle, context } = await fixtureContext()
    try {
      expect(createRegistryRepository(context).listLinks()).toHaveLength(1)
      expect(createAgentRepository(context).getActiveForHost(1)?.agentVersion).toBe('0.1.8')
      expect(createAuthRepository(context).getUser(1)?.protectedOwner).toBeTrue()
      expect(createNotificationRepository(context).getSettings()?.enabled).toBeTrue()
      expect(createBackupRepository(context).getSchedule()?.retentionCount).toBe(14)
    } finally {
      closeManagedDatabase(handle)
    }
  })
})

describe('legacy project projection', () => {
  test('reconstructs the existing API identity, topology, compatibility, and route shape', async () => {
    const { handle } = await fixtureContext()
    try {
      const project = buildLegacyProjectProjection({ database: handle.database, projectId: 1 })
      expect(project.id).toBe('default')
      expect(project.revision).toBe(8)
      expect(project.metadata).toEqual({ name: 'Default Project', version: 4, updatedAt: '2026-08-11T12:00:00.000Z' })
      expect(Object.keys(project.items).sort()).toEqual([
        'server:7', 'cpu:3', 'ram:9', 'storage:4', 'powerAdapter:2', 'switch:1', 'patchPanel:1', 'powerStrip:1',
      ].sort())
      expect(project.items['server:7'].compatibility?.host?.storageSlots).toEqual([{
        id: 1, key: 'm2-storage', label: 'M.2 storage', count: 1, interfaces: ['NVMe'], formFactors: ['2280'], pcieGeneration: 3,
      }])
      expect(project.placements).toContainEqual({ serverId: 'server:7', x: 120, y: 240 })
      expect(project.assignments[0]).toMatchObject({ serverId: 'server:7', itemId: 'cpu:3', type: 'cpu', allocation: { resourceType: 'cpu', resourceKey: 'cpu', positions: [0] } })
      expect(project.connections[0]).toMatchObject({
        from: { itemId: 'switch:1', portId: 1 },
        to: { itemId: 'patchPanel:1', portId: 1, endpointId: 2 },
        route: { sourceSide: 'bottom', targetSide: 'top', bendPoints: [{ x: 660, y: 300 }], avoidCableOverlap: true },
      })
      expect(project.connections[1]).toMatchObject({
        to: { itemId: 'server:7', hostedItemId: 'powerAdapter:2', portId: 1 },
      })
      expect(project.compatibilityPolicy).toEqual({ disabledHosts: [{ hostType: 'server', hostId: 7 }], ignoredWarningIds: ['compatibility:server:7:cpu'] })
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('round-trips conventional-server v6 controller, power, cooling, and management topology', async () => {
    const root = await mkdtemp(join(tmpdir(), 'homelab-inventory-v6-projection-'))
    roots.push(root)
    const handle = await openManagedDatabase({ filePath: join(root, 'core.sqlite'), schemaName: 'core' })
    try {
      await applyCommittedMigrations(handle, await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
        id: migration.id,
        sha256: migration.sha256,
        sql: await readFile(resolve(import.meta.dir, '../migrations/generated', migration.file), 'utf8'),
      }))))
      const corpus = JSON.parse(await readFile(resolve(import.meta.dir, '../../../../test/fixtures/catalog-import/oem/server-specs-inventory-server-v6.json'), 'utf8'))
      const snapshot = schema29ProductionShapeFixture()
      const server = structuredClone(corpus.platformCases[0].item)
      server.compatibility.host.storageSlots[0].pcieGeneration = 4
      server.compatibility.host.expansionSlots[0].slotType = 'PCIe x16'
      snapshot.inventory.servers.push({ ...server, id: 8 })
      importLegacyCore({ database: handle.database, snapshot, identityPlan: buildCanonicalIdentityPlan(snapshot) })

      const host = buildLegacyProjectProjection({ database: handle.database, projectId: 1 }).items['server:8'].compatibility?.host
      expect(host?.cpu).toMatchObject({ socketCount: 2, populationModes: [1, 2] })
      expect(host?.memory).toMatchObject({ slots: 24, slotsPerCpu: 12, moduleTypes: ['LRDIMM', 'RDIMM'] })
      expect(host?.storageSlots?.[0]).toMatchObject({ pcieGeneration: 4, hotSwap: true, controllerSlotIds: [1], directConnect: false })
      expect(host?.expansionSlots?.[0]).toMatchObject({
        slotType: 'PCIe x16',
        pcieGeneration: 3,
        mechanicalLanes: 16,
        electricalLanes: 16,
      })
      expect(host?.controllerSlots?.[0]).toMatchObject({ id: 1, acceptedControllerKinds: ['hba', 'raid-controller'], dedicated: true })
      expect(host?.bootDeviceSlots?.[0]).toMatchObject({ controllerSlotId: 1, acceptedDeviceKinds: ['boot-controller', 'boot-storage'] })
      expect(host?.power).toMatchObject({ psuBayCount: 2, supportedWattagesWatts: [750, 1100], redundancyModes: ['1+0', '1+1'] })
      expect(host?.coolingProfiles).toHaveLength(2)
      expect(host?.management).toMatchObject({ controllerFamily: 'iDRAC', controllerGeneration: 'iDRAC9', dedicatedPort: true })
    } finally {
      closeManagedDatabase(handle)
    }
  })
})
