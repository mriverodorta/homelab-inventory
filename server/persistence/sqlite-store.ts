import type { Database } from 'bun:sqlite'
import type { ProjectPatch, TopologyEndpointRef } from '../../shared/engine/protocol.mjs'
import { withCanonicalPowerPorts } from '../../shared/power-ports.mjs'
import type { ProjectState } from '../../src/types/inventory.ts'
import {
  buildDuplicateRecord,
  buildQuantityRecords,
  InventoryLifecycleError,
  normalizeInventoryRef,
} from '../db/inventory-lifecycle.mjs'
import { createEngineSnapshot } from '../engine/snapshot.mjs'
import { INVENTORY_TYPES, type InventoryType } from './core/inventory/field-contract.ts'
import { buildLegacyProjectProjection } from './core/projections/legacy-project.ts'
import { createRepositoryContext } from './core/repositories/index.ts'
import { insertLegacyInventoryItem } from './migration/core-importer.ts'
import { databaseStatus, type ManagedDatabase } from './sqlite/database.ts'
import { databaseQuickCheck } from './sqlite/integrity.ts'

type ProjectCommitEvent = Readonly<{
  type: 'project-commit' | 'canonical-invalidated'
  baseRevision: number
  revision: number
  responseBytes?: Uint8Array
}>

type SqliteStoreOptions = Readonly<{
  core: ManagedDatabase
  projectId?: number
  workspaceId?: number
  now?: () => number
}>

type Row = Record<string, any>

const RESOURCE_TYPE_BY_ALLOCATION: Readonly<Record<string, string>> = {
  cpu: 'cpu',
  cooling: 'cooling',
  memory: 'memory',
  storage: 'storage',
  expansion: 'expansion',
  motherboard: 'motherboard',
  case: 'case',
  power: 'power',
  powerAdapter: 'powerAdapter',
  optionalModule: 'optionalModule',
  controllerSlot: 'controllerSlot',
  bootDeviceSlot: 'bootDeviceSlot',
}

const INVENTORY_TYPE_SET = new Set<string>(INVENTORY_TYPES)

function lifecycleError(message: string, code: string, status: number) {
  return new InventoryLifecycleError(message, { code, status })
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return structuredClone(fallback)
  return JSON.parse(value) as T
}

function positiveId(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw lifecycleError(`${label} must be a positive safe integer.`, 'invalid-engine-patch', 500)
  }
  return Number(value)
}

function finiteCoordinate(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw lifecycleError(`${label} must be finite.`, 'invalid-engine-patch', 500)
  }
  return value
}

function toMilliseconds(value: unknown, fallback: number) {
  if (typeof value !== 'string') return fallback
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toBitsPerSecond(value: unknown) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw lifecycleError('Negotiated speed is invalid.', 'invalid-engine-patch', 500)
  }
  return Math.round(value * 1_000_000)
}

function hasWorkspacePatch(patch: ProjectPatch): boolean {
  if (patch.kind === 'batch') return patch.payload.patches.some(hasWorkspacePatch)
  return patch.kind === 'patch-placements' || patch.kind === 'set-connection-route'
}

function parseRuntimeItemKey(value: unknown, label: string) {
  if (typeof value !== 'string') {
    throw lifecycleError(`${label} is invalid.`, 'invalid-project', 400)
  }
  const separator = value.lastIndexOf(':')
  const type = separator > 0 ? value.slice(0, separator) : ''
  const id = separator > 0 ? Number(value.slice(separator + 1)) : Number.NaN
  if (!type || !Number.isSafeInteger(id) || id <= 0) {
    throw lifecycleError(`${label} is invalid.`, 'invalid-project', 400)
  }
  return { type, id }
}

function metadata(database: Database, key: string, fallback: unknown) {
  const row = database.query('SELECT value_json FROM application_metadata WHERE key = ?').get(key) as { value_json: string } | null
  return parseJson(row?.value_json, fallback)
}

function putMetadata(database: Database, key: string, value: unknown, now: number) {
  database.query(`
    INSERT INTO application_metadata (key, value_json, updated_at_ms)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at_ms = excluded.updated_at_ms
  `).run(key, JSON.stringify(value), now)
}

export class SqliteHomelabInventoryStore {
  readonly core: ManagedDatabase
  readonly projectId: number
  readonly workspaceId: number
  readonly now: () => number
  readonly context: ReturnType<typeof createRepositoryContext>
  private readonly projectCommitListeners = new Set<(event: ProjectCommitEvent) => void>()

  constructor({ core, projectId = 1, workspaceId = 2, now = Date.now }: SqliteStoreOptions) {
    if (core.schemaName !== 'core') throw new Error('SQLite store requires the core database.')
    if (core.readonly) throw new Error('SQLite store requires a writable core database.')
    this.core = core
    this.projectId = positiveId(projectId, 'Project ID')
    this.workspaceId = positiveId(workspaceId, 'Workspace ID')
    this.now = now
    this.context = createRepositoryContext(core.database, now)
  }

  getProject(): ProjectState {
    return buildLegacyProjectProjection({
      database: this.core.database,
      projectId: this.projectId,
      workspaceId: this.workspaceId,
    })
  }

  getEngineSnapshot() {
    return createEngineSnapshot(this.getProject())
  }

  getEngineRevision() {
    const row = this.core.database.query(
      'SELECT revision FROM projects WHERE id = ? AND archived_at_ms IS NULL',
    ).get(this.projectId) as { revision: number } | null
    if (!row) throw new Error(`Active project ${this.projectId} was not found.`)
    return row.revision
  }

  setProject(submitted: ProjectState) {
    const baseRevision = this.getEngineRevision()
    const submittedRevision = submitted.revision ?? baseRevision
    if (submittedRevision !== baseRevision) {
      throw lifecycleError(
        `Project revision ${submittedRevision} is stale; current revision is ${baseRevision}.`,
        'revision-conflict',
        409,
      )
    }
    const current = this.getProject()
    if (JSON.stringify(Object.keys(submitted.items).sort()) !== JSON.stringify(Object.keys(current.items).sort())) {
      throw lifecycleError(
        'Inventory membership cannot be changed through the project endpoint.',
        'invalid-project',
        400,
      )
    }
    const now = this.now()
    const revision = baseRevision + 1
    this.core.database.transaction(() => {
      const name = submitted.metadata?.name?.trim() || 'Homelab Inventory'
      this.core.database.query(`
        UPDATE projects SET name = ?, revision = ?, updated_at_ms = ?
        WHERE id = ? AND revision = ? AND archived_at_ms IS NULL
      `).run(name, revision, now, this.projectId, baseRevision)
      putMetadata(
        this.core.database,
        'legacy.project-metadata',
        { ...submitted.metadata, name, updatedAt: new Date(now).toISOString() },
        now,
      )
      putMetadata(
        this.core.database,
        'legacy.compatibility-policy',
        submitted.compatibilityPolicy ?? { disabledHosts: [], ignoredWarningIds: [] },
        now,
      )

      this.core.database.query(
        'DELETE FROM workspace_placements WHERE project_id = ? AND workspace_id = ?',
      ).run(this.projectId, this.workspaceId)
      const insertPlacement = this.core.database.query(`
        INSERT INTO workspace_placements (
          project_id, workspace_id, item_id, x, y, orientation, z_index, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const placement of submitted.placements ?? []) {
        const item = parseRuntimeItemKey(placement.serverId, 'Placement item')
        insertPlacement.run(
          this.projectId,
          this.workspaceId,
          this.resolveItem(item.type, item.id),
          finiteCoordinate(placement.x, 'Placement x'),
          finiteCoordinate(placement.y, 'Placement y'),
          (placement as Row).orientation ?? null,
          (placement as Row).zIndex ?? 0,
          now,
          now,
        )
      }

      this.core.database.query('DELETE FROM component_assignments WHERE project_id = ?').run(this.projectId)
      for (const assignment of submitted.assignments ?? []) {
        const host = parseRuntimeItemKey(assignment.serverId, 'Assignment host')
        const item = parseRuntimeItemKey(assignment.itemId, 'Assignment item')
        this.upsertAssignment({
          id: assignment.id,
          host: { item_type: host.type, id: host.id },
          item: { item_type: item.type, id: item.id },
          component_type: assignment.type,
          assigned_at: assignment.assignedAt,
          allocation: assignment.allocation ? {
            resource_type: assignment.allocation.resourceType,
            group_id: assignment.allocation.groupId ?? null,
            positions: assignment.allocation.positions,
          } : null,
        })
      }

      this.core.database.query('DELETE FROM project_connections WHERE project_id = ?').run(this.projectId)
      for (const connection of submitted.connections ?? []) {
        this.insertConnection({
          id: connection.id,
          from: this.runtimeEndpoint(connection.from),
          to: this.runtimeEndpoint(connection.to),
          connection_type: connection.type,
          negotiated_speed_mbps: connection.negotiatedSpeedMbps ?? null,
          label: connection.label ?? null,
          route: connection.route ? {
            source_side: connection.route.sourceSide ?? null,
            target_side: connection.route.targetSide ?? null,
            bend_points: connection.route.bendPoints ?? [],
            avoid_cable_overlap: connection.route.avoidCableOverlap === true,
          } : null,
          created_at: connection.createdAt,
        }, now)
      }

      this.core.database.query(`
        UPDATE workspaces SET revision = revision + 1, updated_at_ms = ?
        WHERE id = ? AND project_id = ?
      `).run(now, this.workspaceId, this.projectId)
    }).immediate()
    const event: ProjectCommitEvent = {
      type: 'canonical-invalidated',
      baseRevision,
      revision,
    }
    for (const listener of this.projectCommitListeners) listener(event)
    return this.getProject()
  }

  createInventoryItems(input: Row, quantity = 1) {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw lifecycleError('Quantity must be an integer between 1 and 100.', 'invalid-quantity', 400)
    }
    const type = String(input?.type ?? '').trim()
    if (!INVENTORY_TYPE_SET.has(type)) {
      throw lifecycleError('Inventory item type is not supported.', 'unsupported-inventory-type', 400)
    }
    const inventoryType = type as InventoryType
    const currentItems = Object.values(this.getProject().items).filter((item) => item.type === inventoryType)
    const startingId = this.nextLegacyInventoryId(inventoryType)
    const records = buildQuantityRecords({
      input,
      type: inventoryType,
      quantity,
      startingId,
      existingRecords: currentItems,
    }).map((item: Row) => withCanonicalPowerPorts({ ...item, type: inventoryType }))
    this.commitCanonicalMutation(() => {
      for (const item of records) {
        insertLegacyInventoryItem({
          database: this.core.database,
          projectId: this.projectId,
          type: inventoryType,
          item,
          now: this.now(),
        })
      }
    })
    return this.getProject()
  }

  addInventoryItem(input: Row) {
    return this.createInventoryItems(input, 1)
  }

  duplicateInventoryItem(rawRef: Row, quantity = 1) {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw lifecycleError('Quantity must be an integer between 1 and 100.', 'invalid-quantity', 400)
    }
    const ref = normalizeInventoryRef(rawRef)
    const source = this.projectItem(ref.type, ref.id)
    if (source.archivedAt) {
      throw lifecycleError('Restore the item before duplicating it.', 'inventory-item-archived', 409)
    }
    const existingRecords = Object.values(this.getProject().items).filter((item) => item.type === ref.type)
    let nextId = this.nextLegacyInventoryId(ref.type as InventoryType)
    const records: Row[] = []
    for (let index = 0; index < quantity; index += 1) {
      const record = buildDuplicateRecord({ source, type: ref.type, nextId, existingRecords: [...existingRecords, ...records] })
      records.push(withCanonicalPowerPorts({ ...record, type: ref.type }))
      nextId += 1
    }
    this.commitCanonicalMutation(() => {
      for (const item of records) {
        insertLegacyInventoryItem({
          database: this.core.database,
          projectId: this.projectId,
          type: ref.type as InventoryType,
          item,
          now: this.now(),
        })
      }
    })
    return this.getProject()
  }

  getInventoryDependencies(rawRef: Row) {
    const ref = normalizeInventoryRef(rawRef)
    const item = this.projectItem(ref.type, ref.id)
    const itemId = this.resolveItem(ref.type, ref.id)
    const reasons: Row[] = []
    const related = (sql: string) => this.core.database.query(sql).all(this.projectId, itemId) as Row[]
    const placements = related('SELECT workspace_id AS workspaceId FROM workspace_placements WHERE project_id = ? AND item_id = ?')
    const assignments = related('SELECT id FROM component_assignments WHERE project_id = ? AND component_item_id = ?')
    const hosted = related('SELECT id FROM component_assignments WHERE project_id = ? AND host_item_id = ?')
    const connections = related(`
      SELECT DISTINCT e.connection_id AS id
      FROM connection_endpoints e
      JOIN project_connections c ON c.id = e.connection_id
      JOIN inventory_ports p ON p.id = e.port_id
      WHERE c.project_id = ? AND p.item_id = ?
    `)
    const agents = this.core.database.query(`
      SELECT b.agent_id AS id FROM agent_host_bindings b
      JOIN agents a ON a.id = b.agent_id
      WHERE b.host_item_id = ? AND b.state = 'active' AND a.revoked_at_ms IS NULL
    `).all(itemId) as Row[]
    if (placements.length) reasons.push({ kind: 'canvas-placement', count: placements.length, message: 'Item is placed on the canvas.', related: placements })
    if (assignments.length) reasons.push({ kind: 'host-assignment', count: assignments.length, message: 'Item is assigned to a host.', related: assignments })
    if (hosted.length) reasons.push({ kind: 'hosted-components', count: hosted.length, message: 'Host contains assigned components.', related: hosted })
    if (connections.length) reasons.push({ kind: 'port-connections', count: connections.length, message: 'Item has connected ports.', related: connections })
    if (agents.length) reasons.push({ kind: 'agent-registration', count: agents.length, message: 'Host has active agent registration data.', related: agents })
    return { item: { type: ref.type, id: ref.id, name: item.name }, blocked: reasons.length > 0, reasons }
  }

  getInventoryDependencyReports(rawRefs: Row[]) {
    return this.normalizeInventoryRefs(rawRefs).map((ref) => this.getInventoryDependencies(ref))
  }

  archiveInventoryItems(rawRefs: Row[]) {
    const refs = this.normalizeInventoryRefs(rawRefs)
    const reports = refs.map((ref) => this.getInventoryDependencies(ref))
    this.assertDependencyFree(reports, 'archive')
    const archivedAt = new Date(this.now()).toISOString()
    this.commitCanonicalMutation(() => {
      for (const ref of refs) {
        this.core.database.query('UPDATE inventory_items SET archived_at_ms = ?, row_version = row_version + 1, updated_at_ms = ? WHERE id = ?')
          .run(Date.parse(archivedAt), this.now(), this.resolveItem(ref.type, ref.id))
      }
    })
    return this.getProject()
  }

  restoreInventoryItems(rawRefs: Row[]) {
    const refs = this.normalizeInventoryRefs(rawRefs)
    this.commitCanonicalMutation(() => {
      for (const ref of refs) {
        this.projectItem(ref.type, ref.id)
        this.core.database.query('UPDATE inventory_items SET archived_at_ms = NULL, row_version = row_version + 1, updated_at_ms = ? WHERE id = ?')
          .run(this.now(), this.resolveItem(ref.type, ref.id))
      }
    })
    return this.getProject()
  }

  deleteInventoryItems(rawRefs: Row[]) {
    const refs = this.normalizeInventoryRefs(rawRefs)
    const active = refs.map((ref) => ({ ref, item: this.projectItem(ref.type, ref.id) })).filter(({ item }) => !item.archivedAt)
    if (active.length) {
      throw new InventoryLifecycleError('Archive inventory items before deleting them.', {
        code: 'inventory-item-not-archived',
        status: 409,
        details: { items: active.map(({ ref, item }) => ({ ...ref, name: item.name })) },
      })
    }
    const reports = refs.map((ref) => this.getInventoryDependencies(ref))
    this.assertDependencyFree(reports, 'delete')
    this.commitCanonicalMutation(() => {
      const deletedHosts = new Set(refs.filter((ref) => ['server', 'nas', 'pcBuild'].includes(ref.type)).map((ref) => `${ref.type}:${ref.id}`))
      if (deletedHosts.size) {
        const policy = metadata(this.core.database, 'legacy.compatibility-policy', { disabledHosts: [], ignoredWarningIds: [] }) as Row
        putMetadata(this.core.database, 'legacy.compatibility-policy', {
          ...policy,
          disabledHosts: (policy.disabledHosts ?? []).filter((host: Row) => !deletedHosts.has(`${host.hostType}:${host.hostId}`)),
        }, this.now())
      }
      for (const ref of refs) {
        const itemId = this.resolveItem(ref.type, ref.id)
        this.core.database.query('DELETE FROM registry_links WHERE item_id = ?').run(itemId)
        this.core.database.query('DELETE FROM project_inventory_memberships WHERE project_id = ? AND item_id = ?').run(this.projectId, itemId)
        this.core.database.query('DELETE FROM port_identity_aliases WHERE port_id IN (SELECT id FROM inventory_ports WHERE item_id = ?)').run(itemId)
        this.core.database.query('DELETE FROM resource_identity_aliases WHERE resource_id IN (SELECT id FROM inventory_resources WHERE item_id = ?)').run(itemId)
        this.core.database.query('DELETE FROM inventory_identity_aliases WHERE item_id = ?').run(itemId)
        this.core.database.query('DELETE FROM inventory_items WHERE id = ?').run(itemId)
      }
    })
    return this.getProject()
  }

  updateInventoryItemProperties(rawRef: Row, rawProperties: unknown) {
    const ref = normalizeInventoryRef(rawRef)
    if (!rawProperties || typeof rawProperties !== 'object' || Array.isArray(rawProperties)) {
      throw lifecycleError('Inventory item properties must be a plain object.', 'invalid-inventory-properties', 400)
    }
    const item = this.projectItem(ref.type, ref.id)
    if (item.archivedAt) throw lifecycleError('Restore the item before editing it.', 'inventory-item-archived', 409)
    const itemId = this.resolveItem(ref.type, ref.id)
    this.commitCanonicalMutation(() => {
      const insert = this.core.database.query(`
        INSERT INTO inventory_item_properties (item_id, key, value, created_at_ms, updated_at_ms)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(item_id, key) DO UPDATE SET value = excluded.value, updated_at_ms = excluded.updated_at_ms
      `)
      for (const [key, value] of Object.entries(rawProperties as Row)) {
        if (value === undefined || value === null || value === '') {
          this.core.database.query('DELETE FROM inventory_item_properties WHERE item_id = ? AND key = ?').run(itemId, key)
        } else {
          insert.run(itemId, key, typeof value === 'string' ? value : JSON.stringify(value), this.now(), this.now())
        }
      }
      this.core.database.query('UPDATE inventory_items SET row_version = row_version + 1, updated_at_ms = ? WHERE id = ?').run(this.now(), itemId)
    })
    return this.getProject()
  }

  getDatabaseStatus() {
    const status = databaseStatus(this.core)
    const lastMigration = this.core.database.query(`
      SELECT migration_key AS migrationKey, source_engine AS sourceEngine,
             target_engine AS targetEngine, state, backup_path AS backupPath,
             source_digest AS sourceDigest, target_digest AS targetDigest,
             started_at_ms AS startedAtMs, completed_at_ms AS completedAtMs
      FROM migration_runs
      ORDER BY id DESC LIMIT 1
    `).get() as Row | null
    return {
      schemaVersion: status.schemaVersion,
      lastMigration: lastMigration ? {
        ...lastMigration,
        startedAt: new Date(lastMigration.startedAtMs).toISOString(),
        completedAt: lastMigration.completedAtMs == null
          ? null
          : new Date(lastMigration.completedAtMs).toISOString(),
      } : null,
    }
  }

  getPersistenceHealth() {
    const status = databaseStatus(this.core)
    return {
      ok: status.integrity === 'ok',
      engine: 'sqlite',
      database: status,
      lastError: null,
    }
  }

  getRoutingCache() {
    const envelope = metadata(this.core.database, 'legacy.routing-cache-envelope', {}) as Row
    const entries = this.core.database.query(`
      SELECT route_payload_json
      FROM workspace_route_cache
      WHERE project_id = ? AND workspace_id = ?
      ORDER BY connection_id
    `).all(this.projectId, this.workspaceId) as Array<{ route_payload_json: string }>
    return structuredClone({
      ...envelope,
      entries: entries.map((entry) => JSON.parse(entry.route_payload_json)),
    })
  }

  setRoutingCache(cache: Row) {
    const entries = Array.isArray(cache.entries) ? cache.entries : []
    const now = this.now()
    this.core.database.transaction(() => {
      this.core.database.query(
        'DELETE FROM workspace_route_cache WHERE project_id = ? AND workspace_id = ?',
      ).run(this.projectId, this.workspaceId)
      const insert = this.core.database.query(`
        INSERT INTO workspace_route_cache (
          project_id, workspace_id, connection_id, engine_version,
          layout_fingerprint, route_fingerprint, route_payload_json, calculated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const entry of entries) {
        const connectionId = positiveId(
          entry?.input?.request?.definition?.connection_id,
          'Routing cache connection ID',
        )
        insert.run(
          this.projectId,
          this.workspaceId,
          connectionId,
          String(cache.plannerVersion ?? 'unknown'),
          String(cache.geometryFingerprint ?? 'unknown'),
          `connection:${connectionId}`,
          JSON.stringify(entry),
          now,
        )
      }
      const { entries: _entries, ...envelope } = cache
      putMetadata(this.core.database, 'legacy.routing-cache-envelope', {
        ...envelope,
        updatedAt: new Date(now).toISOString(),
      }, now)
    }).immediate()
    return this.getRoutingCache()
  }

  subscribeToProjectCommits(listener: (event: ProjectCommitEvent) => void) {
    this.projectCommitListeners.add(listener)
    return () => this.projectCommitListeners.delete(listener)
  }

  async applyEnginePatch({
    baseRevision,
    patchSet,
    responseBytes,
  }: {
    baseRevision: number
    patchSet: { revision: number; forward: ProjectPatch; inverse?: ProjectPatch }
    responseBytes: Uint8Array
  }) {
    const currentRevision = this.getEngineRevision()
    if (currentRevision !== baseRevision) {
      throw lifecycleError(
        `Project revision ${baseRevision} is stale; current revision is ${currentRevision}.`,
        'revision-conflict',
        409,
      )
    }
    if (patchSet.revision !== baseRevision + 1) {
      throw lifecycleError('Engine patch revision is not sequential.', 'invalid-engine-patch', 500)
    }

    const now = this.now()
    this.core.database.transaction(() => {
      this.applyProjectPatch(patchSet.forward, now)
      const result = this.core.database.query(`
        UPDATE projects SET revision = ?, updated_at_ms = ?
        WHERE id = ? AND revision = ? AND archived_at_ms IS NULL
      `).run(patchSet.revision, now, this.projectId, baseRevision)
      if (result.changes !== 1) {
        throw lifecycleError('Project changed while applying the engine patch.', 'revision-conflict', 409)
      }
      if (hasWorkspacePatch(patchSet.forward)) {
        this.core.database.query(`
          UPDATE workspaces SET revision = revision + 1, updated_at_ms = ?
          WHERE id = ? AND project_id = ? AND archived_at_ms IS NULL
        `).run(now, this.workspaceId, this.projectId)
      }
    }).immediate()

    const event: ProjectCommitEvent = {
      type: 'project-commit',
      baseRevision,
      revision: patchSet.revision,
      responseBytes: Uint8Array.from(responseBytes),
    }
    for (const listener of this.projectCommitListeners) listener(event)
    return this.getProject()
  }

  async flush() {
    if (this.core.closed) return
    databaseQuickCheck(this.core.database)
    this.core.database.exec('PRAGMA wal_checkpoint(PASSIVE);')
  }

  close() {
    this.projectCommitListeners.clear()
    this.core.close()
  }

  private applyProjectPatch(patch: ProjectPatch, now: number): void {
    if (patch.kind === 'batch') {
      if (!patch.payload.patches.length) {
        throw lifecycleError('Engine patch batch must not be empty.', 'invalid-engine-patch', 500)
      }
      for (const child of patch.payload.patches) this.applyProjectPatch(child, now)
      return
    }

    if (patch.kind === 'set-project-name') {
      const name = patch.payload.name.trim()
      if (!name) throw lifecycleError('Project name is required.', 'invalid-engine-patch', 500)
      this.core.database.query('UPDATE projects SET name = ? WHERE id = ?').run(name, this.projectId)
      return
    }

    if (patch.kind === 'add-connection') {
      this.insertConnection(patch.payload.connection, now)
      return
    }

    if (patch.kind === 'remove-connection') {
      const connectionId = positiveId(patch.payload.connection.id, 'Connection ID')
      const result = this.core.database.query(
        'DELETE FROM project_connections WHERE project_id = ? AND id = ?',
      ).run(this.projectId, connectionId)
      if (result.changes !== 1) {
        throw lifecycleError(`Connection ${connectionId} does not exist.`, 'invalid-engine-patch', 500)
      }
      return
    }

    if (patch.kind === 'set-connection-label') {
      this.updateConnection(patch.payload.connection_id, 'label = ?', [patch.payload.label])
      return
    }

    if (patch.kind === 'set-connection-route') {
      const connectionId = positiveId(patch.payload.connection_id, 'Connection ID')
      const route = patch.payload.route
      const current = this.connection(connectionId)
      this.updateConnection(connectionId, 'source_side = ?, target_side = ?, avoid_cable_overlap = ?, updated_at_ms = ?', [
        route?.source_side ?? current.source_side,
        route?.target_side ?? current.target_side,
        Number(route?.avoid_cable_overlap === true),
        now,
      ])
      this.replaceBends(connectionId, route?.bend_points ?? [])
      return
    }

    if (patch.kind === 'set-connection-derived') {
      for (const state of patch.payload.states) {
        this.updateConnection(state.connection_id, 'connection_type = ?, negotiated_speed_bps = ?, updated_at_ms = ?', [
          state.connection_type,
          toBitsPerSecond(state.negotiated_speed_mbps),
          now,
        ])
      }
      return
    }

    if (patch.kind === 'patch-placements') {
      const upsert = this.core.database.query(`
        INSERT INTO workspace_placements (
          project_id, workspace_id, item_id, x, y, orientation, z_index, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?)
        ON CONFLICT(workspace_id, item_id) DO UPDATE SET
          x = excluded.x, y = excluded.y, updated_at_ms = excluded.updated_at_ms
      `)
      for (const placement of patch.payload.upsert) {
        upsert.run(
          this.projectId,
          this.workspaceId,
          this.resolveItem(placement.item.item_type, placement.item.id),
          finiteCoordinate(placement.x, 'Placement x'),
          finiteCoordinate(placement.y, 'Placement y'),
          now,
          now,
        )
      }
      for (const item of patch.payload.remove_items) {
        this.core.database.query(
          'DELETE FROM workspace_placements WHERE workspace_id = ? AND item_id = ?',
        ).run(this.workspaceId, this.resolveItem(item.item_type, item.id))
      }
      return
    }

    if (patch.kind === 'patch-assignments') {
      for (const assignmentId of patch.payload.remove_assignment_ids) {
        const result = this.core.database.query(
          'DELETE FROM component_assignments WHERE project_id = ? AND id = ?',
        ).run(this.projectId, positiveId(assignmentId, 'Assignment ID'))
        if (result.changes !== 1) {
          throw lifecycleError(`Assignment ${assignmentId} does not exist.`, 'invalid-engine-patch', 500)
        }
      }
      for (const assignment of patch.payload.upsert) this.upsertAssignment(assignment)
      return
    }

    const exhaustive: never = patch
    throw lifecycleError(`Unsupported engine patch ${(exhaustive as ProjectPatch).kind}.`, 'unsupported-engine-patch', 500)
  }

  private projectItem(type: string, id: number) {
    const item = this.getProject().items[`${type}:${positiveId(id, 'Inventory item ID')}`]
    if (!item) throw lifecycleError(`Inventory item ${type}:${id} was not found.`, 'inventory-item-not-found', 404)
    return item as Row
  }

  private nextLegacyInventoryId(type: InventoryType) {
    const row = this.core.database.query(`
      SELECT coalesce(max(legacy_id), 0) + 1 AS id
      FROM inventory_identity_aliases
      WHERE legacy_type_key = ?
    `).get(type) as { id: number }
    return positiveId(row.id, 'Next inventory item ID')
  }

  private normalizeInventoryRefs(rawRefs: Row[]) {
    if (!Array.isArray(rawRefs) || rawRefs.length === 0) {
      throw lifecycleError('At least one inventory item is required.', 'empty-inventory-selection', 400)
    }
    const refs = new Map<string, ReturnType<typeof normalizeInventoryRef>>()
    for (const rawRef of rawRefs) {
      const ref = normalizeInventoryRef(rawRef)
      refs.set(`${ref.type}:${ref.id}`, ref)
    }
    return [...refs.values()]
  }

  private assertDependencyFree(reports: Row[], action: string) {
    if (!reports.some((report) => report.blocked)) return
    throw new InventoryLifecycleError(`Cannot ${action} inventory items with dependencies.`, {
      code: 'inventory-dependencies',
      status: 409,
      details: { reports },
    })
  }

  private commitCanonicalMutation(operation: () => void) {
    const baseRevision = this.getEngineRevision()
    const revision = baseRevision + 1
    const now = this.now()
    this.core.database.transaction(() => {
      operation()
      const result = this.core.database.query(`
        UPDATE projects SET revision = ?, updated_at_ms = ?
        WHERE id = ? AND revision = ? AND archived_at_ms IS NULL
      `).run(revision, now, this.projectId, baseRevision)
      if (result.changes !== 1) {
        throw lifecycleError('Project changed while applying the inventory mutation.', 'revision-conflict', 409)
      }
    }).immediate()
    const event: ProjectCommitEvent = { type: 'canonical-invalidated', baseRevision, revision }
    for (const listener of this.projectCommitListeners) listener(event)
  }

  private resolveItem(type: string, legacyId: number) {
    const row = this.core.database.query(`
      SELECT item_id FROM inventory_identity_aliases
      WHERE legacy_type_key = ? AND legacy_id = ?
    `).get(type, positiveId(legacyId, 'Inventory item ID')) as { item_id: number } | null
    if (!row) throw lifecycleError(`Inventory item ${type}:${legacyId} does not exist.`, 'invalid-engine-patch', 500)
    return row.item_id
  }

  private resolvePort(endpoint: TopologyEndpointRef) {
    const owner = endpoint.hosted_item ?? endpoint.item
    const row = this.core.database.query(`
      SELECT pia.port_id
      FROM port_identity_aliases pia
      WHERE pia.legacy_item_type_key = ?
        AND pia.legacy_item_id = ?
        AND pia.legacy_port_id = ?
    `).get(owner.item_type, positiveId(owner.id, 'Endpoint item ID'), positiveId(endpoint.port_id, 'Port ID')) as { port_id: number } | null
    if (!row) throw lifecycleError('Connection endpoint references a missing port.', 'invalid-engine-patch', 500)
    let endpointFaceId: number | null = null
    if (endpoint.endpoint_id !== null) {
      const face = this.core.database.query(`
        SELECT id FROM port_endpoint_faces
        WHERE port_id = ? AND endpoint_number = ?
      `).get(row.port_id, positiveId(endpoint.endpoint_id, 'Endpoint face ID')) as { id: number } | null
      if (!face) throw lifecycleError('Connection endpoint references a missing port face.', 'invalid-engine-patch', 500)
      endpointFaceId = face.id
    }
    return { portId: row.port_id, endpointFaceId }
  }

  private runtimeEndpoint(endpoint: Row): TopologyEndpointRef {
    const item = parseRuntimeItemKey(endpoint.itemId, 'Connection endpoint item')
    const hosted = endpoint.hostedItemId
      ? parseRuntimeItemKey(endpoint.hostedItemId, 'Hosted connection endpoint item')
      : null
    return {
      item: { item_type: item.type, id: item.id },
      port_id: positiveId(endpoint.portId, 'Connection endpoint port ID'),
      endpoint_id: endpoint.endpointId == null ? null : positiveId(endpoint.endpointId, 'Connection endpoint face ID'),
      hosted_item: hosted ? { item_type: hosted.type, id: hosted.id } : null,
    }
  }

  private insertConnection(connection: any, now: number) {
    const connectionId = positiveId(connection.id, 'Connection ID')
    const route = connection.route
    this.core.database.query(`
      INSERT INTO project_connections (
        id, project_id, connection_type, negotiated_speed_bps, label,
        source_side, target_side, avoid_cable_overlap, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      connectionId,
      this.projectId,
      connection.connection_type,
      toBitsPerSecond(connection.negotiated_speed_mbps),
      connection.label,
      route?.source_side ?? 'right',
      route?.target_side ?? 'left',
      Number(route?.avoid_cable_overlap === true),
      toMilliseconds(connection.created_at, now),
      now,
    )
    const source = this.resolvePort(connection.from)
    const target = this.resolvePort(connection.to)
    const insertEndpoint = this.core.database.query(`
      INSERT INTO connection_endpoints (connection_id, role, port_id, endpoint_face_id)
      VALUES (?, ?, ?, ?)
    `)
    insertEndpoint.run(connectionId, 'source', source.portId, source.endpointFaceId)
    insertEndpoint.run(connectionId, 'target', target.portId, target.endpointFaceId)
    this.replaceBends(connectionId, route?.bend_points ?? [])
  }

  private connection(connectionId: number) {
    const row = this.core.database.query(`
      SELECT * FROM project_connections WHERE project_id = ? AND id = ?
    `).get(this.projectId, positiveId(connectionId, 'Connection ID')) as Row | null
    if (!row) throw lifecycleError(`Connection ${connectionId} does not exist.`, 'invalid-engine-patch', 500)
    return row
  }

  private updateConnection(connectionId: number, clause: string, values: unknown[]) {
    const id = positiveId(connectionId, 'Connection ID')
    const result = this.core.database.query(
      `UPDATE project_connections SET ${clause} WHERE project_id = ? AND id = ?`,
    ).run(...values, this.projectId, id)
    if (result.changes !== 1) {
      throw lifecycleError(`Connection ${id} does not exist.`, 'invalid-engine-patch', 500)
    }
  }

  private replaceBends(connectionId: number, points: Array<{ x: number; y: number }>) {
    this.core.database.query(`
      DELETE FROM workspace_manual_bend_points
      WHERE project_id = ? AND workspace_id = ? AND connection_id = ?
    `).run(this.projectId, this.workspaceId, connectionId)
    const insert = this.core.database.query(`
      INSERT INTO workspace_manual_bend_points (
        project_id, workspace_id, connection_id, position, x, y
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (const [position, point] of points.entries()) {
      insert.run(
        this.projectId,
        this.workspaceId,
        connectionId,
        position,
        finiteCoordinate(point.x, 'Bend point x'),
        finiteCoordinate(point.y, 'Bend point y'),
      )
    }
  }

  private upsertAssignment(assignment: any) {
    const assignmentId = positiveId(assignment.id, 'Assignment ID')
    const hostItemId = this.resolveItem(assignment.host.item_type, assignment.host.id)
    const componentItemId = this.resolveItem(assignment.item.item_type, assignment.item.id)
    const slotIds = assignment.allocation
      ? assignment.allocation.positions.map((position: number) => this.resolveResourceSlot(
          hostItemId,
          assignment.allocation.resource_type,
          assignment.allocation.group_id,
          position,
        ))
      : []
    this.core.database.query(`
      INSERT INTO component_assignments (
        id, project_id, host_item_id, component_item_id, resource_slot_id, assigned_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        host_item_id = excluded.host_item_id,
        component_item_id = excluded.component_item_id,
        resource_slot_id = excluded.resource_slot_id,
        assigned_at_ms = excluded.assigned_at_ms
    `).run(
      assignmentId,
      this.projectId,
      hostItemId,
      componentItemId,
      slotIds[0] ?? null,
      toMilliseconds(assignment.assigned_at, this.now()),
    )
    this.core.database.query('DELETE FROM component_assignment_slots WHERE assignment_id = ?').run(assignmentId)
    const insertSlot = this.core.database.query(`
      INSERT INTO component_assignment_slots (
        project_id, assignment_id, host_item_id, resource_slot_id, position
      ) VALUES (?, ?, ?, ?, ?)
    `)
    slotIds.forEach((slotId: number, position: number) => {
      insertSlot.run(this.projectId, assignmentId, hostItemId, slotId, position)
    })
  }

  private resolveResourceSlot(
    hostItemId: number,
    allocationType: string,
    legacyGroupId: number | null,
    zeroBasedPosition: number,
  ) {
    if (!Number.isSafeInteger(zeroBasedPosition) || zeroBasedPosition < 0) {
      throw lifecycleError('Assignment slot position is invalid.', 'invalid-engine-patch', 500)
    }
    const resourceType = RESOURCE_TYPE_BY_ALLOCATION[allocationType] ?? allocationType
    const group = legacyGroupId == null
      ? this.core.database.query(`
          SELECT g.id
          FROM host_resource_groups g
          WHERE g.host_item_id = ? AND g.resource_type = ?
          ORDER BY g.id LIMIT 1
        `).get(hostItemId, resourceType) as { id: number } | null
      : this.core.database.query(`
          SELECT g.id
          FROM host_resource_groups g
          JOIN resource_identity_aliases a ON a.resource_id = g.resource_identity_id
          WHERE g.host_item_id = ? AND g.resource_type = ?
            AND a.legacy_resource_group_id = ?
        `).get(hostItemId, resourceType, positiveId(legacyGroupId, 'Resource group ID')) as { id: number } | null
    if (!group) throw lifecycleError('Assignment references a missing resource group.', 'invalid-engine-patch', 500)
    const slot = this.core.database.query(`
      SELECT id FROM host_resource_slots
      WHERE host_item_id = ? AND resource_group_id = ? AND position = ?
    `).get(hostItemId, group.id, zeroBasedPosition + 1) as { id: number } | null
    if (!slot) throw lifecycleError('Assignment references a missing resource slot.', 'invalid-engine-patch', 500)
    return slot.id
  }
}
