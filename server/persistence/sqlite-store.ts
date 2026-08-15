import type { Database } from 'bun:sqlite'
import { dirname } from 'node:path'
import type { ProjectPatch, TopologyEndpointRef } from '../../shared/engine/protocol.mjs'
import {
  nasPowerTopology,
  withCanonicalPowerPorts,
  withNasPowerConfiguration,
} from '../../shared/power-ports.mjs'
import { evaluateProjectCompatibility, planHostAllocations } from '../../shared/compatibility/index.mjs'
import type { ProjectState } from '../../src/types/inventory.ts'
import { getReleaseNotesBetween } from '../../src/release-notes.ts'
import {
  buildDuplicateRecord,
  buildQuantityRecords,
  InventoryLifecycleError,
  normalizeInventoryRef,
  referencedPortIds,
} from '../db/inventory-lifecycle.mjs'
import { cleanItemForStore, normalizeInventoryItemInput } from '../db/inventory-input.mjs'
import { assertAuthenticationStoreShape, normalizeAuthenticationStore } from '../auth/model.mjs'
import {
  agentStatusTiming,
  DEFAULT_AGENT_HEARTBEAT_INTERVAL_SECONDS,
  resolveAgentStatusState,
} from '../agents/status-model.mjs'
import { assertBackupManagementStoreShape, normalizeBackupManagementStore } from '../backup/backup-model.mjs'
import { timingSafeEqualString } from '../db/agent-auth.mjs'
import { inspectNasPowerConfigurationChange } from '../db/nas-power-configuration.mjs'
import { createEngineSnapshot } from '../engine/snapshot.mjs'
import {
  assertRegistryStoreShape,
  createPrivateTemplatePack,
  createPrivateTemplateRecord,
  previewPrivateTemplatePack,
} from '../registry/model.mjs'
import {
  materializeCatalogItem,
  projectLocalItemForCatalog,
} from '../registry/local-catalog-mapping.mjs'
import { catalogFieldDiff, mergeCatalogUpdate } from '../registry/update-service.mjs'
import { planCatalogUpdate } from '../registry/catalog-update-semantics.mjs'
import { classifyCatalogUpdate } from '../registry/catalog-update-policy.mjs'
import {
  applyCatalogResolutionPlan,
  buildCatalogResolutionPlan,
} from '../registry/catalog-update-resolution.mjs'
import {
  canonicalCatalogFieldChanges,
  registryUpdateCounts,
  registryUpdateGroups as projectRegistryUpdateGroups,
} from '../registry/catalog-update-projection.mjs'
import { assertOnboardingState, createOnboardingState } from '../onboarding/model.mjs'
import {
  finishExampleInDraft,
  loadExampleIntoDraft,
  publicOnboardingStatus,
  sampleRemovalImpact,
  setOnboardingStatusInDraft,
  setWalkthroughStepInDraft,
} from '../onboarding/lifecycle.mjs'
import { INVENTORY_TYPES, type InventoryType } from './core/inventory/field-contract.ts'
import { createInventoryScopeService } from './core/inventory/inventory-scope-service.ts'
import type { CacheStore } from './cache/cache-store.ts'
import { MemoryCacheStore } from './cache/memory-cache.ts'
import {
  persistAuthenticationState,
  persistBackupManagementState,
  persistRegistryState,
  persistAgentExtendedState,
  projectAgentState,
  projectAgentStatusState,
  projectAuthenticationState,
  projectBackupManagementState,
  projectRegistryState,
} from './core/projections/legacy-domains.ts'
import { buildWorkspaceReadModel } from './core/read-model/workspace-read-model.ts'
import { buildLegacyInventoryProjection } from './core/projections/legacy-project.ts'
import {
  bumpProjectRevision,
  createProjectRepository,
  createRepositoryContext,
} from './core/repositories/index.ts'
import { insertLegacyInventoryItem, replaceLegacyInventoryItem } from './migration/core-importer.ts'
import { LEGACY_TABLE_BY_TYPE } from './legacy/identity-plan.ts'
import { databaseStatus, type ManagedDatabase } from './sqlite/database.ts'
import { databaseQuickCheck } from './sqlite/integrity.ts'
import { buildLogicalStoreSnapshot } from '../backup/sqlite-section-exporter.ts'
import { stageAndActivateSqliteRestore } from '../backup/sqlite-restore-staging.ts'

type ProjectCommitEvent = Readonly<{
  type: 'project-commit' | 'canonical-invalidated'
  baseRevision: number
  revision: number
  responseBytes?: Uint8Array
}>

type SqliteStoreOptions = Readonly<{
  core: ManagedDatabase
  dataDir?: string
  projectId?: number
  workspaceId?: number
  appVersion?: string
  cache?: CacheStore
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

function projectCompatibilityPolicy(database: Database, projectId: number) {
  const row = database.query(
    'SELECT policy_json FROM project_compatibility_policies WHERE project_id = ?',
  ).get(projectId) as { policy_json: string } | null
  return parseJson(
    row?.policy_json ?? (projectId === 1
      ? JSON.stringify(metadata(database, 'legacy.compatibility-policy', { disabledHosts: [], ignoredWarningIds: [] }))
      : null),
    { disabledHosts: [], ignoredWarningIds: [] },
  ) as Row
}

function putProjectCompatibilityPolicy(
  database: Database,
  projectId: number,
  policy: unknown,
  now: number,
) {
  database.query(`
    INSERT INTO project_compatibility_policies (project_id, policy_json, updated_at_ms)
    VALUES (?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      policy_json = excluded.policy_json,
      updated_at_ms = excluded.updated_at_ms
  `).run(projectId, JSON.stringify(policy), now)
  if (projectId === 1) putMetadata(database, 'legacy.compatibility-policy', policy, now)
}

function nextPublicId(records: Row[]) {
  return records.reduce((maximum, record) => Math.max(maximum, Number(record.id) || 0), 0) + 1
}

function motherboardCatalogUpdateConflicts(project: Row, itemId: number, nextItem: Row) {
  const motherboardKey = `motherboard:${itemId}`
  const hostIds = [...new Set(
    (project.assignments ?? [])
      .filter((assignment: Row) => assignment.itemId === motherboardKey && assignment.type === 'motherboard')
      .map((assignment: Row) => assignment.serverId),
  )]
  if (hostIds.length === 0) return []
  const nextProject = structuredClone(project)
  nextProject.items[motherboardKey] = { ...structuredClone(nextItem), id: itemId, key: motherboardKey, type: 'motherboard' }
  return hostIds.flatMap((hostId) => {
    const before = planHostAllocations(project, hostId as string)
    const after = planHostAllocations(nextProject, hostId as string)
    const previous = new Map(before.results.map((result: Row) => [result.assignmentId, result]))
    return after.results.flatMap((result: Row) => {
      if (result.status !== 'incompatible' || previous.get(result.assignmentId)?.status === 'incompatible') return []
      return [{
        hostId,
        assignmentId: result.assignmentId,
        itemId: result.itemId,
        findings: result.findings.filter((finding: Row) => finding.severity === 'error'),
      }]
    })
  })
}

export class SqliteHomelabInventoryStore {
  readonly core: ManagedDatabase
  readonly dataDir: string
  readonly projectId: number
  readonly workspaceId: number
  readonly now: () => number
  readonly appVersion: string
  readonly cache: CacheStore
  context: ReturnType<typeof createRepositoryContext>
  projects: ReturnType<typeof createProjectRepository>
  inventoryScope: ReturnType<typeof createInventoryScopeService>
  private readonly projectCommitListeners = new Set<(event: ProjectCommitEvent) => void>()
  private registryMutationTail: Promise<void> = Promise.resolve()

  constructor({
    core,
    dataDir = dirname(core.filePath),
    projectId = 1,
    workspaceId = 2,
    appVersion = '0.0.0',
    cache = new MemoryCacheStore(),
    now = Date.now,
  }: SqliteStoreOptions) {
    if (core.schemaName !== 'core') throw new Error('SQLite store requires the core database.')
    if (core.readonly) throw new Error('SQLite store requires a writable core database.')
    this.core = core
    this.dataDir = dataDir
    this.projectId = positiveId(projectId, 'Project ID')
    this.workspaceId = positiveId(workspaceId, 'Workspace ID')
    this.now = now
    this.appVersion = appVersion
    this.cache = cache
    this.context = createRepositoryContext(core.database, now)
    this.projects = createProjectRepository(this.context)
    this.inventoryScope = createInventoryScopeService(this.context)
  }

  private rebindRepositories() {
    this.context = createRepositoryContext(this.core.database, this.now)
    this.projects = createProjectRepository(this.context)
    this.inventoryScope = createInventoryScopeService(this.context)
  }

  private applicationMeta() {
    const value = metadata(this.core.database, 'legacy.application-meta', {}) as Row
    return {
      ...value,
      onboarding: value.onboarding ?? createOnboardingState('dismissed'),
    }
  }

  private updateApplicationMeta(mutator: (draft: Row) => void) {
    const draft = this.applicationMeta()
    mutator(draft)
    assertOnboardingState(draft.onboarding)
    putMetadata(this.core.database, 'legacy.application-meta', draft, this.now())
    return draft
  }

  private legacyInventory(project = this.getProject()) {
    const inventory = Object.fromEntries(
      Object.values(LEGACY_TABLE_BY_TYPE).map((table) => [table, [] as Row[]]),
    ) as Row
    for (const item of Object.values(project.items) as Row[]) {
      const table = LEGACY_TABLE_BY_TYPE[item.type as InventoryType]
      if (table) inventory[table].push(cleanItemForStore(withCanonicalPowerPorts(item)))
    }
    return inventory
  }

  private legacyDomainDraft() {
    const project = this.getProject()
    const persistedEndpoint = (endpoint: Row) => {
      const item = parseRuntimeItemKey(endpoint.itemId, 'Connection endpoint item')
      const hosted = endpoint.hostedItemId
        ? parseRuntimeItemKey(endpoint.hostedItemId, 'Hosted connection endpoint item')
        : null
      return {
        itemType: item.type,
        itemId: item.id,
        portId: endpoint.portId,
        ...(endpoint.endpointId === undefined ? {} : { endpointId: endpoint.endpointId }),
        ...(hosted ? { hostedItemType: hosted.type, hostedItemId: hosted.id } : {}),
      }
    }
    return {
      meta: { onboarding: structuredClone(this.applicationMeta().onboarding) },
      inventory: this.legacyInventory(project),
      project: {
        id: project.id,
        revision: project.revision,
        metadata: structuredClone(project.metadata),
        placements: project.placements.map((placement: Row) => {
          const item = parseRuntimeItemKey(placement.serverId, 'Placement item')
          return { itemType: item.type, itemId: item.id, x: placement.x, y: placement.y }
        }),
        assignments: project.assignments.map((assignment: Row) => {
          const host = parseRuntimeItemKey(assignment.serverId, 'Assignment host')
          const item = parseRuntimeItemKey(assignment.itemId, 'Assignment item')
          return {
            id: assignment.id,
            hostType: host.type,
            hostId: host.id,
            itemType: item.type,
            itemId: item.id,
            type: assignment.type,
            assignedAt: assignment.assignedAt,
            ...(assignment.allocation ? { allocation: structuredClone(assignment.allocation) } : {}),
          }
        }),
        connections: project.connections.map((connection: Row) => ({
          ...structuredClone(connection),
          from: persistedEndpoint(connection.from),
          to: persistedEndpoint(connection.to),
        })),
        compatibilityPolicy: structuredClone(project.compatibilityPolicy),
      },
      agents: projectAgentState(this.core.database),
      agentStatus: projectAgentStatusState(this.core.database),
    }
  }

  private serializeRegistryMutation<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.registryMutationTail.then(operation, operation)
    this.registryMutationTail = result.then(() => undefined, () => undefined)
    return result
  }

  async markAppOpened() {
    this.updateApplicationMeta((draft) => {
      draft.appLastOpenedWith = this.appVersion
    })
  }

  getReleaseNotesStatus(releaseNotes: unknown[]) {
    const current = this.applicationMeta()
    const lastSeenVersion = current.lastSeenReleaseNotesVersion ?? this.appVersion
    const entries = getReleaseNotesBetween(releaseNotes as any, lastSeenVersion, this.appVersion)
    return { currentVersion: this.appVersion, lastSeenVersion, hasUnseen: entries.length > 0, entries }
  }

  async acknowledgeReleaseNotes() {
    this.updateApplicationMeta((draft) => {
      draft.lastSeenReleaseNotesVersion = this.appVersion
    })
    return { currentVersion: this.appVersion, lastSeenVersion: this.appVersion, hasUnseen: false, entries: [] }
  }

  getUpdateMetadata() {
    const current = this.applicationMeta()
    return {
      skippedUpdateVersion: current.skippedUpdateVersion ?? null,
      lastUpdateCheck: current.lastUpdateCheck ? structuredClone(current.lastUpdateCheck) : null,
    }
  }

  isUpdateVersionSkipped(version: string) {
    return this.applicationMeta().skippedUpdateVersion === version
  }

  async saveUpdateCheck(result: unknown) {
    this.updateApplicationMeta((draft) => {
      draft.lastUpdateCheck = structuredClone(result)
    })
  }

  async skipUpdateVersion(version: string) {
    this.updateApplicationMeta((draft) => {
      draft.skippedUpdateVersion = version
    })
  }

  async clearSkippedUpdateVersion() {
    this.updateApplicationMeta((draft) => {
      draft.skippedUpdateVersion = null
    })
  }

  getOnboardingStatus({ enabled = true } = {}) {
    const project = this.getProject()
    return publicOnboardingStatus({
      meta: { onboarding: this.applicationMeta().onboarding },
      inventory: this.legacyInventory(project),
      project,
      agents: projectAgentState(this.core.database),
      enabled,
    })
  }

  private updateOnboardingMetadata(mutator: (draft: Row) => void) {
    this.updateApplicationMeta((meta) => {
      const draft = this.legacyDomainDraft()
      draft.meta.onboarding = structuredClone(meta.onboarding)
      mutator(draft)
      meta.onboarding = draft.meta.onboarding
    })
    return this.getOnboardingStatus()
  }

  startOnboardingEmpty() {
    if (this.applicationMeta().onboarding.status === 'sample_active') {
      throw lifecycleError('Keep or remove the active example before starting empty.', 'onboarding-sample-active', 409)
    }
    return this.updateOnboardingMetadata((draft) => setOnboardingStatusInDraft(draft, 'checklist_active'))
  }

  async loadOnboardingExample() {
    const current = this.applicationMeta().onboarding
    if (current.status === 'sample_active') {
      return { status: this.getOnboardingStatus(), project: this.getProject() }
    }
    const draft = this.legacyDomainDraft()
    loadExampleIntoDraft(draft, new Date(this.now()).toISOString())
    const records = (Object.entries(LEGACY_TABLE_BY_TYPE) as [InventoryType, string][])
      .flatMap(([type, table]) => (draft.inventory[table] ?? []).map((item: Row) => ({ type, item })))
    this.commitCanonicalMutation(() => {
      for (const { type, item } of records) {
        insertLegacyInventoryItem({
          database: this.core.database,
          projectId: this.projectId,
          type,
          item: withCanonicalPowerPorts({ ...item, type }),
          now: this.now(),
        })
      }
      const insertPlacement = this.core.database.query(`
        INSERT INTO workspace_placements (
          project_id, workspace_id, item_id, x, y, orientation, z_index, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const placement of draft.project.placements) {
        insertPlacement.run(
          this.projectId,
          this.workspaceId,
          this.resolveItem(placement.itemType, placement.itemId),
          placement.x,
          placement.y,
          placement.orientation ?? null,
          placement.zIndex ?? 0,
          this.now(),
          this.now(),
        )
      }
      for (const assignment of draft.project.assignments) {
        this.upsertAssignment({
          id: assignment.id,
          host: { item_type: assignment.hostType, id: assignment.hostId },
          item: { item_type: assignment.itemType, id: assignment.itemId },
          component_type: assignment.type,
          assigned_at: assignment.assignedAt,
          allocation: assignment.allocation ? {
            resource_type: assignment.allocation.resourceType,
            group_id: assignment.allocation.groupId ?? null,
            positions: assignment.allocation.positions,
          } : null,
        })
      }
      for (const connection of draft.project.connections) {
        this.insertConnection({
          id: connection.id,
          from: {
            item: { item_type: connection.from.itemType, id: connection.from.itemId },
            port_id: connection.from.portId,
            endpoint_id: connection.from.endpointId ?? null,
            hosted_item: connection.from.hostedItemType ? {
              item_type: connection.from.hostedItemType,
              id: connection.from.hostedItemId,
            } : null,
          },
          to: {
            item: { item_type: connection.to.itemType, id: connection.to.itemId },
            port_id: connection.to.portId,
            endpoint_id: connection.to.endpointId ?? null,
            hosted_item: connection.to.hostedItemType ? {
              item_type: connection.to.hostedItemType,
              id: connection.to.hostedItemId,
            } : null,
          },
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
        }, this.now())
      }
      putMetadata(this.core.database, 'legacy.application-meta', {
        ...this.applicationMeta(),
        onboarding: draft.meta.onboarding,
      }, this.now())
    })
    return { status: this.getOnboardingStatus(), project: this.getProject() }
  }

  getOnboardingRemovalImpact() {
    return sampleRemovalImpact(this.legacyDomainDraft())
  }

  async finishOnboardingExample(action: string) {
    const draft = this.legacyDomainDraft()
    const sampleRefs = structuredClone(draft.meta.onboarding.sampleInventoryRefs ?? []) as Row[]
    finishExampleInDraft(draft, action, new Date(this.now()).toISOString())
    if (action === 'keep') {
      const status = this.updateOnboardingMetadata((currentDraft) => {
        currentDraft.meta.onboarding = draft.meta.onboarding
      })
      return { status, project: this.getProject() }
    }
    const canonicalIds = sampleRefs.map((ref) => this.resolveItem(ref.type, ref.id))
    this.commitCanonicalMutation(() => {
      for (const itemId of canonicalIds) {
        this.core.database.query(`
          DELETE FROM project_connections
          WHERE project_id = ? AND id IN (
            SELECT DISTINCT e.connection_id FROM connection_endpoints e
            JOIN inventory_ports p ON p.id = e.port_id
            WHERE p.item_id = ?
          )
        `).run(this.projectId, itemId)
        this.core.database.query(
          'DELETE FROM component_assignments WHERE project_id = ? AND (host_item_id = ? OR component_item_id = ?)',
        ).run(this.projectId, itemId, itemId)
        this.core.database.query(
          'DELETE FROM workspace_placements WHERE project_id = ? AND item_id = ?',
        ).run(this.projectId, itemId)
        this.core.database.query('DELETE FROM registry_links WHERE item_id = ?').run(itemId)
        this.core.database.query('DELETE FROM project_inventory_memberships WHERE project_id = ? AND item_id = ?')
          .run(this.projectId, itemId)
        this.core.database.query('UPDATE inventory_items SET archived_at_ms = ?, updated_at_ms = ? WHERE id = ?')
          .run(this.now(), this.now(), itemId)
        this.core.database.query('DELETE FROM port_identity_aliases WHERE port_id IN (SELECT id FROM inventory_ports WHERE item_id = ?)')
          .run(itemId)
        this.core.database.query('DELETE FROM resource_identity_aliases WHERE resource_id IN (SELECT id FROM inventory_resources WHERE item_id = ?)')
          .run(itemId)
        this.core.database.query('DELETE FROM inventory_identity_aliases WHERE item_id = ?').run(itemId)
        this.core.database.query('DELETE FROM inventory_items WHERE id = ?').run(itemId)
      }
      putProjectCompatibilityPolicy(
        this.core.database,
        this.projectId,
        draft.project.compatibilityPolicy,
        this.now(),
      )
      putMetadata(this.core.database, 'legacy.application-meta', {
        ...this.applicationMeta(),
        onboarding: draft.meta.onboarding,
      }, this.now())
    })
    return { status: this.getOnboardingStatus(), project: this.getProject() }
  }

  dismissOnboarding() {
    if (this.applicationMeta().onboarding.status === 'sample_active') {
      throw lifecycleError('Keep or remove the active example before dismissing onboarding.', 'onboarding-sample-active', 409)
    }
    return this.updateOnboardingMetadata((draft) => setOnboardingStatusInDraft(draft, 'dismissed'))
  }

  restartOnboardingChecklist() {
    if (this.applicationMeta().onboarding.status === 'sample_active') {
      throw lifecycleError('Finish the active example before restarting the checklist.', 'onboarding-sample-active', 409)
    }
    return this.updateOnboardingMetadata((draft) => setOnboardingStatusInDraft(draft, 'checklist_active'))
  }

  setOnboardingWalkthroughStep(step: number) {
    return this.updateOnboardingMetadata((draft) => setWalkthroughStepInDraft(draft, step))
  }

  getProject(): ProjectState {
    return buildWorkspaceReadModel({
      database: this.core.database,
      cache: this.cache,
      projectId: this.projectId,
      workspaceId: this.workspaceId,
    })
  }

  forWorkspace(projectId: number, workspaceId: number) {
    this.projects.getWorkbook(projectId)
    const workspace = this.projects.listWorkspaces(projectId)
      .find((candidate) => candidate.id === workspaceId)
    if (!workspace) throw new Error(`Active workspace ${workspaceId} was not found in project ${projectId}.`)
    if (workspace.type !== 'canvas') {
      throw new Error(`Workspace ${workspaceId} does not provide Canvas project state.`)
    }
    return new SqliteHomelabInventoryStore({
      core: this.core,
      dataDir: this.dataDir,
      projectId,
      workspaceId,
      appVersion: this.appVersion,
      cache: this.cache,
      now: this.now,
    })
  }

  listProjects() {
    return this.projects.listActive()
  }

  listArchivedProjects() {
    return this.projects.listArchived()
  }

  getProjectWorkbook(projectId: number) {
    return this.projects.getWorkbook(projectId)
  }

  createProject(input: Parameters<typeof this.projects.create>[0]) {
    const created = this.projects.create(input)
    this.invalidateProjectReadModels(created.project.id, created.canvasWorkspaceId)
    return this.projects.getWorkbook(created.project.id)
  }

  updateProject(projectId: number, changes: Parameters<typeof this.projects.update>[1]) {
    this.projects.update(projectId, changes)
    this.invalidateProjectReadModels(projectId)
    return this.projects.getWorkbook(projectId)
  }

  archiveProject(projectId: number) {
    this.projects.archive(projectId)
    this.invalidateProjectReadModels(projectId)
  }

  restoreProject(projectId: number) {
    this.projects.restore(projectId)
    return this.projects.getWorkbook(projectId)
  }

  getProjectDeletionImpact(projectId: number) {
    return this.projects.deletionImpact(projectId)
  }

  deleteArchivedProject(projectId: number) {
    const impact = this.projects.removeArchived(projectId)
    this.invalidateProjectReadModels(projectId)
    return impact
  }

  createWorkspace(projectId: number, input: Parameters<typeof this.projects.createWorkspace>[1]) {
    const workspace = this.projects.createWorkspace(projectId, input)
    this.invalidateProjectReadModels(projectId, workspace.id)
    return this.projects.getWorkbook(projectId)
  }

  updateWorkspaceMetadata(
    projectId: number,
    workspaceId: number,
    changes: Parameters<typeof this.projects.updateWorkspace>[2],
  ) {
    this.projects.updateWorkspace(projectId, workspaceId, changes)
    this.invalidateProjectReadModels(projectId, workspaceId)
    return this.projects.getWorkbook(projectId)
  }

  updateCanvasWorkspaceConfiguration(
    projectId: number,
    workspaceId: number,
    input: Parameters<typeof this.projects.updateCanvasConfiguration>[2],
  ) {
    const workbook = this.projects.updateCanvasConfiguration(projectId, workspaceId, input)
    this.invalidateProjectReadModels(projectId, workspaceId)
    return workbook
  }

  reorderWorkspaces(projectId: number, workspaceIds: readonly number[]) {
    this.projects.reorderWorkspaces(projectId, workspaceIds)
    return this.projects.getWorkbook(projectId)
  }

  archiveWorkspace(projectId: number, workspaceId: number) {
    const workbook = this.projects.archiveWorkspace(projectId, workspaceId)
    this.invalidateProjectReadModels(projectId, workspaceId)
    return workbook
  }

  setDefaultWorkspace(projectId: number, workspaceId: number) {
    this.projects.setDefaultWorkspace(projectId, workspaceId)
    return this.projects.getWorkbook(projectId)
  }

  getWorkspace(projectId: number, workspaceId: number): ProjectState {
    const workbook = this.projects.getWorkbook(projectId)
    const workspace = workbook.workspaces.find((candidate) => candidate.id === workspaceId)
    if (!workspace) {
      throw new Error(`Active workspace ${workspaceId} was not found in project ${projectId}.`)
    }
    if (workspace.type !== 'canvas') {
      throw new Error(`Workspace ${workspaceId} does not provide Canvas project state.`)
    }
    const project = buildWorkspaceReadModel({
      database: this.core.database,
      cache: this.cache,
      projectId,
      workspaceId,
    })
    return {
      ...project,
      metadata: { ...project.metadata, projectId, workspaceId },
    }
  }

  setWorkspace(projectId: number, workspaceId: number, submitted: ProjectState): ProjectState {
    const workspace = this.projects.getWorkbook(projectId).workspaces
      .find((candidate) => candidate.id === workspaceId)
    if (!workspace) throw new Error(`Active workspace ${workspaceId} was not found in project ${projectId}.`)
    if (workspace.type !== 'canvas') throw new Error(`Workspace ${workspaceId} does not provide Canvas project state.`)
    const scopedStore = new SqliteHomelabInventoryStore({
      core: this.core,
      dataDir: this.dataDir,
      projectId,
      workspaceId,
      appVersion: this.appVersion,
      cache: this.cache,
      now: this.now,
    })
    scopedStore.setProject(submitted)
    return this.getWorkspace(projectId, workspaceId)
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
      putProjectCompatibilityPolicy(
        this.core.database,
        this.projectId,
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
    this.invalidateProjectReadModels()
    const event: ProjectCommitEvent = {
      type: 'canonical-invalidated',
      baseRevision,
      revision,
    }
    for (const listener of this.projectCommitListeners) listener(event)
    return this.getProject()
  }

  createInventoryItems(input: Row, quantity = 1) {
    const { type, records } = this.prepareInventoryCreation(input, quantity, this.projectId)
    this.commitCanonicalMutation(() => this.insertInventoryRecords(type, records, this.projectId, 'global'))
    return this.getProject()
  }

  createInventoryItemsForProject(projectId: number, input: Row, quantity = 1) {
    const workbook = this.projects.getWorkbook(projectId)
    const scope = input?.scope === 'global' ? 'global' : 'project'
    if (scope === 'global' && !workbook.project.includesGlobalInventory) {
      throw lifecycleError(
        `Project ${projectId} does not allow global inventory.`,
        'inventory-scope-conflict',
        409,
      )
    }
    const { type, records } = this.prepareInventoryCreation(input, quantity, projectId)
    const at = this.now()
    this.core.database.transaction(() => {
      this.insertInventoryRecords(type, records, projectId, scope)
      bumpProjectRevision(this.context, projectId, at)
    }).immediate()
    this.invalidateProjectReadModels(projectId)
    return this.getWorkspace(projectId, workbook.defaultWorkspaceId)
  }

  createScopedInventoryItems(input: Row, quantity = 1) {
    const scope = input?.scope === 'global' ? 'global' : 'project'
    const workbook = this.projects.getWorkbook(this.projectId)
    if (scope === 'global' && !workbook.project.includesGlobalInventory) {
      throw lifecycleError(
        `Project ${this.projectId} does not allow global inventory.`,
        'inventory-scope-conflict',
        409,
      )
    }
    const { type, records } = this.prepareInventoryCreation(input, quantity, this.projectId)
    this.commitCanonicalMutation(() => {
      this.insertInventoryRecords(type, records, this.projectId, scope)
    })
    return this.getProject()
  }

  setInventoryScope(ref: Row, target: { scope: 'global' | 'project'; projectId?: number }) {
    const normalized = normalizeInventoryRef(ref)
    const itemId = this.inventoryScope.resolve(normalized.type as InventoryType, normalized.id)
    try {
      const item = this.inventoryScope.setScope(itemId, target)
      this.cache.clear()
      return {
        item,
        memberships: this.inventoryScope.memberships(itemId),
        project: this.getProject(),
      }
    } catch (error) {
      throw lifecycleError(
        error instanceof Error ? error.message : 'Unable to change inventory scope.',
        'inventory-scope-conflict',
        409,
      )
    }
  }

  listAvailableGlobalInventory(projectId: number) {
    return this.inventoryScope.listAvailableGlobal(projectId)
  }

  addGlobalInventoryMembership(projectId: number, ref: Row) {
    const normalized = normalizeInventoryRef(ref)
    const itemId = this.inventoryScope.resolve(normalized.type as InventoryType, normalized.id)
    try {
      const memberships = this.inventoryScope.addGlobalMembership(itemId, projectId)
      this.invalidateProjectReadModels(projectId)
      return {
        memberships,
        project: projectId === this.projectId
          ? this.getProject()
          : this.getWorkspace(projectId, this.projects.getWorkbook(projectId).defaultWorkspaceId),
      }
    } catch (error) {
      throw lifecycleError(
        error instanceof Error ? error.message : 'Unable to add global inventory to the project.',
        'inventory-membership-conflict',
        409,
      )
    }
  }

  removeGlobalInventoryMembership(projectId: number, ref: Row) {
    const normalized = normalizeInventoryRef(ref)
    const itemId = this.inventoryScope.resolve(normalized.type as InventoryType, normalized.id)
    try {
      const memberships = this.inventoryScope.removeGlobalMembership(itemId, projectId)
      this.invalidateProjectReadModels(projectId)
      return {
        memberships,
        project: projectId === this.projectId
          ? this.getProject()
          : this.getWorkspace(projectId, this.projects.getWorkbook(projectId).defaultWorkspaceId),
      }
    } catch (error) {
      throw lifecycleError(
        error instanceof Error ? error.message : 'Unable to remove global inventory from the project.',
        'inventory-membership-conflict',
        409,
      )
    }
  }

  duplicateInventoryToProject(sourceProjectId: number, targetProjectId: number, ref: Row) {
    const normalized = normalizeInventoryRef(ref)
    const type = normalized.type as InventoryType
    if (!INVENTORY_TYPE_SET.has(type)) {
      throw lifecycleError('Inventory item type is not supported.', 'unsupported-inventory-type', 400)
    }
    const sourceWorkbook = this.projects.getWorkbook(sourceProjectId)
    const targetWorkbook = this.projects.getWorkbook(targetProjectId)
    const source = this.getWorkspace(sourceProjectId, sourceWorkbook.defaultWorkspaceId)
      .items[`${type}:${normalized.id}`] as Row | undefined
    if (!source) {
      throw lifecycleError(
        `Inventory item ${type}:${normalized.id} is not available in project ${sourceProjectId}.`,
        'inventory-item-not-found',
        404,
      )
    }
    const target = this.getWorkspace(targetProjectId, targetWorkbook.defaultWorkspaceId)
    const existingRecords = Object.values(target.items).filter((item) => item.type === type)
    const nextId = this.nextLegacyInventoryId(type)
    const duplicate = buildDuplicateRecord({ source, type, nextId, existingRecords })
    const at = this.now()
    this.core.database.transaction(() => {
      insertLegacyInventoryItem({
        database: this.core.database,
        projectId: targetProjectId,
        type,
        item: duplicate,
        scope: 'project',
        ownerProjectId: targetProjectId,
        now: at,
      })
      bumpProjectRevision(this.context, targetProjectId, at)
    }).immediate()
    this.invalidateProjectReadModels(targetProjectId)
    return {
      item: { type, id: nextId },
      project: this.getWorkspace(targetProjectId, targetWorkbook.defaultWorkspaceId),
    }
  }

  private prepareInventoryCreation(input: Row, quantity: number, projectId = this.projectId) {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw lifecycleError('Quantity must be an integer between 1 and 100.', 'invalid-quantity', 400)
    }
    const type = String(input?.type ?? '').trim()
    if (!INVENTORY_TYPE_SET.has(type)) {
      throw lifecycleError('Inventory item type is not supported.', 'unsupported-inventory-type', 400)
    }
    const inventoryType = type as InventoryType
    const workbook = this.projects.getWorkbook(projectId)
    const currentItems = Object.values(this.getWorkspace(projectId, workbook.defaultWorkspaceId).items)
      .filter((item) => item.type === inventoryType)
    const startingId = this.nextLegacyInventoryId(inventoryType)
    const records = buildQuantityRecords({
      input,
      type: inventoryType,
      quantity,
      startingId,
      existingRecords: currentItems,
    }).map((item: Row) => withCanonicalPowerPorts({ ...item, type: inventoryType }))
    return { type: inventoryType, records }
  }

  private insertInventoryRecords(
    type: InventoryType,
    records: Row[],
    projectId = this.projectId,
    scope: 'global' | 'project' = 'global',
  ) {
    for (const item of records) {
      insertLegacyInventoryItem({
        database: this.core.database,
        projectId,
        type,
        item,
        scope,
        ownerProjectId: scope === 'project' ? projectId : null,
        now: this.now(),
      })
    }
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
        const policy = projectCompatibilityPolicy(this.core.database, this.projectId)
        putProjectCompatibilityPolicy(this.core.database, this.projectId, {
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

  updateInventoryItem(rawRef: Row, input: Row) {
    const { ref, record } = this.prepareInventoryUpdate(rawRef, input)
    this.commitCanonicalMutation(() => {
      this.replaceInventoryRecord(ref, record)
    })
    return this.getProject()
  }

  private prepareInventoryUpdate(
    rawRef: Row,
    input: Row,
    project: ProjectState = this.getProject(),
    options: { allowNasPowerTopologyChange?: boolean; allowConnectedPortTopologyChange?: boolean } = {},
  ) {
    const ref = normalizeInventoryRef(rawRef)
    const current = project.items[`${ref.type}:${ref.id}`] as Row | undefined
    if (!current) throw lifecycleError(`Inventory item ${ref.type}:${ref.id} was not found.`, 'inventory-item-not-found', 404)
    if (current.archivedAt) {
      throw lifecycleError('Restore the item before editing it.', 'inventory-item-archived', 409)
    }
    const { item } = normalizeInventoryItemInput({ ...input, type: ref.type }, ref.id)
    const record = cleanItemForStore(item)
    if (
      ref.type === 'nas'
      && current.specs?.powerConfiguration !== record.specs?.powerConfiguration
      && !options.allowNasPowerTopologyChange
    ) {
      throw lifecycleError(
        'Use the NAS power configuration command to change power modes.',
        'nas-power-configuration-command-required',
        409,
      )
    }
    if (ref.type === 'nas') {
      const previousPower = nasPowerTopology(current)
      const nextPower = nasPowerTopology(record)
      const releasesAssignedAdapter = previousPower.configuration === 'external-adapter'
        && previousPower.adapterDisposition === 'replaceable'
        && (
          nextPower.configuration !== 'external-adapter'
          || nextPower.adapterDisposition !== 'replaceable'
        )
      if (releasesAssignedAdapter && !options.allowNasPowerTopologyChange) {
        const assignedAdapter = project.assignments.find((assignment) => (
          assignment.serverId === `${ref.type}:${ref.id}` && assignment.type === 'powerAdapter'
        ))
        if (assignedAdapter) {
          throw new InventoryLifecycleError(
            'This update would orphan the assigned NAS power adapter. Remove or release the adapter before applying it.',
            {
              code: 'nas-power-adapter-orphan',
              status: 409,
              details: { assignmentId: assignedAdapter.id },
            },
          )
        }
      }
    }
    if (!options.allowConnectedPortTopologyChange) {
      const connectedPortIds = referencedPortIds(project, ref)
      const portPlan = planCatalogUpdate(current, { ...record, type: ref.type }).portPlan
      const materialPortChanges = [...portPlan.attachmentChanges, ...portPlan.capabilityChanges]
      for (const portId of connectedPortIds) {
        if (materialPortChanges.some((change: Row) => (
          change.path === `ports[${portId}]` || change.path.startsWith(`ports[${portId}].`)
        ))) {
          throw new InventoryLifecycleError(`Connected port ${portId} cannot be removed or materially changed.`, {
            code: 'connected-port-change', status: 409, details: { portId },
          })
        }
      }
    }
    return { ref, record }
  }

  private replaceInventoryRecord(
    ref: { type: string; id: number },
    record: Row,
    projectId = this.projectId,
    options: { resourceKeyRemaps?: Row[] } = {},
  ) {
    replaceLegacyInventoryItem({
      database: this.core.database,
      projectId,
      type: ref.type as InventoryType,
      item: record,
      itemId: this.resolveItem(ref.type, ref.id),
      resourceKeyRemaps: options.resourceKeyRemaps,
      now: this.now(),
    })
  }

  changeNasPowerConfiguration(rawRef: Row, target: unknown, confirmed = false) {
    const ref = normalizeInventoryRef(rawRef)
    const project = this.getProject()
    const inventory = Object.fromEntries(
      Object.values(LEGACY_TABLE_BY_TYPE).map((table) => [table, [] as Row[]]),
    ) as Row
    for (const item of Object.values(project.items) as Row[]) {
      const table = LEGACY_TABLE_BY_TYPE[item.type as InventoryType]
      if (table) inventory[table].push(cleanItemForStore(item))
    }
    const impact = inspectNasPowerConfigurationChange({ inventory, project }, ref, target)
    if (impact.requiresConfirmation && !confirmed) {
      return { status: 'confirmation-required', impact: impact.publicImpact }
    }
    if (impact.from === impact.to) return { status: 'applied', project }

    const current = this.projectItem(ref.type, ref.id)
    const migrated = withCanonicalPowerPorts(withNasPowerConfiguration({
      ...current,
      type: 'nas',
    }, impact.to))
    const record = cleanItemForStore(migrated)
    this.commitCanonicalMutation(() => {
      for (const connectionId of impact.connectionIds) {
        this.core.database.query(
          'DELETE FROM project_connections WHERE project_id = ? AND id = ?',
        ).run(this.projectId, connectionId)
      }
      if (impact.assignmentId !== null) {
        this.core.database.query(
          'DELETE FROM component_assignments WHERE project_id = ? AND id = ?',
        ).run(this.projectId, impact.assignmentId)
      }
      replaceLegacyInventoryItem({
        database: this.core.database,
        projectId: this.projectId,
        type: 'nas',
        item: record,
        itemId: this.resolveItem('nas', ref.id),
        now: this.now(),
      })
    })
    return { status: 'applied', project: this.getProject() }
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
      cache: this.cache.diagnostics(),
      lastError: null,
    }
  }

  getRegistryState() {
    return structuredClone(projectRegistryState(this.core.database))
  }

  updateRegistrySettings(patch: Row, expectedUpdatedAt?: string) {
    const current = this.getRegistryState() as Row
    if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== current.settings.updatedAt) {
      throw lifecycleError('Registry settings changed in another session.', 'registry-settings-conflict', 409)
    }
    return this.registryTransaction((draft: Row) => {
      const mode = patch?.mode ?? draft.settings.mode
      const defaultInventorySource = patch?.defaultInventorySource ?? draft.settings.defaultInventorySource
      if (!['disabled', 'offline', 'connected'].includes(mode)) {
        throw lifecycleError('Registry mode is unsupported.', 'invalid-registry-settings', 400)
      }
      if (!['catalog', 'manual', 'private-templates'].includes(defaultInventorySource)) {
        throw lifecycleError('Default inventory source is unsupported.', 'invalid-registry-settings', 400)
      }
      draft.settings = {
        ...draft.settings,
        mode,
        defaultInventorySource,
        showRegistryLinkIndicators: patch?.showRegistryLinkIndicators ?? draft.settings.showRegistryLinkIndicators,
        automaticSafeUpdates: patch?.automaticSafeUpdates ?? draft.settings.automaticSafeUpdates,
        automaticContributions: mode === 'connected'
          ? patch?.automaticContributions ?? draft.settings.automaticContributions
          : false,
        updatedAt: new Date(this.now()).toISOString(),
      }
    })
  }

  registryTransaction(mutator: (draft: unknown) => void) {
    const draft = this.getRegistryState() as Row
    mutator(draft)
    assertRegistryStoreShape(draft)
    this.core.database.transaction(() => {
      persistRegistryState(
        this.core.database,
        draft,
        this.now(),
        (type, id) => this.resolveItem(type, id),
      )
    }).immediate()
    return this.getRegistryState()
  }

  async createPrivateTemplate(input: Row) {
    return this.serializeRegistryMutation(async () => {
      let record
      try {
        record = await createPrivateTemplateRecord((this.getRegistryState() as Row).privateTemplates, input)
      } catch (error) {
        throw lifecycleError(
          error instanceof Error ? error.message : 'Private template is invalid.',
          'invalid-private-template',
          400,
        )
      }
      return this.registryTransaction((draft: any) => {
        draft.privateTemplates.push(record)
      })
    })
  }

  async duplicatePrivateTemplate(id: number) {
    return this.serializeRegistryMutation(async () => {
      const registry = this.getRegistryState() as Row
      const source = registry.privateTemplates.find((template: Row) => template.id === id)
      if (!source) throw lifecycleError('Private template was not found.', 'private-template-not-found', 404)
      const record = await createPrivateTemplateRecord(registry.privateTemplates, {
        name: `${source.name} copy`, description: source.description, item: source.item,
      })
      return this.registryTransaction((draft: any) => {
        draft.privateTemplates.push(record)
      })
    })
  }

  deletePrivateTemplate(id: number) {
    const registry = this.getRegistryState() as Row
    if (!registry.privateTemplates.some((template: Row) => template.id === id)) {
      throw lifecycleError('Private template was not found.', 'private-template-not-found', 404)
    }
    return this.registryTransaction((draft: any) => {
      draft.privateTemplates = draft.privateTemplates.filter((template: Row) => template.id !== id)
    })
  }

  async exportPrivateTemplates(ids?: number[]) {
    const registry = this.getRegistryState() as Row
    const selectedIds = Array.isArray(ids) && ids.length > 0 ? new Set(ids) : null
    const templates = registry.privateTemplates.filter(
      (template: Row) => selectedIds === null || selectedIds.has(template.id),
    )
    if (selectedIds && templates.length !== selectedIds.size) {
      throw lifecycleError('One or more private templates were not found.', 'private-template-not-found', 404)
    }
    return createPrivateTemplatePack(templates)
  }

  async previewPrivateTemplateImport(pack: unknown) {
    return previewPrivateTemplatePack(pack)
  }

  async importPrivateTemplates(pack: unknown) {
    return this.serializeRegistryMutation(async () => {
      const preview = await previewPrivateTemplatePack(pack) as Row
      if (!preview.valid) {
        throw new InventoryLifecycleError('Private template pack is invalid.', {
          code: 'invalid-private-template-pack', status: 400, details: preview.errors,
        })
      }
      const registry = this.getRegistryState() as Row
      const existingChecksums = new Set(registry.privateTemplates.map((template: Row) => template.checksum))
      const imported: Row[] = []
      let records = registry.privateTemplates
      for (const template of preview.templates) {
        if (existingChecksums.has(template.checksum)) continue
        const record = await createPrivateTemplateRecord(records, template)
        imported.push(record)
        records = [...records, record]
        existingChecksums.add(record.checksum)
      }
      const nextRegistry = this.registryTransaction((draft: any) => {
        draft.privateTemplates.push(...imported)
      })
      return { registry: nextRegistry, imported: imported.length, skipped: preview.templates.length - imported.length }
    })
  }

  createCatalogInventoryItems(template: Row, quantity = 1, options: Row = {}) {
    const registry = this.getRegistryState() as Row
    const sourceId = registry.snapshot?.sourceId
    if (!Number.isSafeInteger(sourceId) || sourceId < 1) {
      throw lifecycleError('A verified catalog snapshot must be active before importing hardware.', 'catalog-unavailable', 409)
    }
    const prepared = this.prepareInventoryCreation(
      materializeCatalogItem(template.item, { usageRole: options.usageRole }),
      quantity,
    )
    const draft = structuredClone(registry)
    let linkId = nextPublicId(draft.links)
    for (const item of prepared.records) {
      draft.links.push({
          id: linkId,
          itemType: prepared.type,
          itemId: item.id,
          sourceId,
          templateKey: template.templateKey,
          importedRevision: template.revision,
          importedContentHash: template.contentHash,
          importedFingerprintVersion: template.fingerprintVersion,
          ...(template.productFamily ? { productFamily: template.productFamily } : {}),
          ...(template.variantEvidence ? { variantEvidence: template.variantEvidence } : {}),
          ...(template.identityAliases ? { identityAliases: template.identityAliases } : {}),
          state: 'linked',
          linkedAt: new Date(this.now()).toISOString(),
      })
      linkId += 1
    }
    assertRegistryStoreShape(draft)
    const scope = options.scope === 'project' ? 'project' : 'global'
    if (scope === 'global' && !this.projects.getWorkbook(this.projectId).project.includesGlobalInventory) {
      throw lifecycleError(
        `Project ${this.projectId} does not allow global inventory.`,
        'inventory-scope-conflict',
        409,
      )
    }
    this.commitCanonicalMutation(() => {
      this.insertInventoryRecords(prepared.type, prepared.records, this.projectId, scope)
      persistRegistryState(
        this.core.database,
        draft,
        this.now(),
        (type, id) => this.resolveItem(type, id),
      )
    })
    return this.getProject()
  }

  reconcileCatalogLink(rawRef: Row, contentHash: string) {
    const ref = normalizeInventoryRef(rawRef)
    const registry = this.getRegistryState() as Row
    const link = registry.links.find((candidate: Row) => candidate.itemType === ref.type && candidate.itemId === ref.id)
    if (!link) return registry
    return this.registryTransaction((draft: any) => {
      const current = draft.links.find((candidate: Row) => candidate.id === link.id)
      if (!current || current.importedContentHash === contentHash) return
      current.state = 'detached'
      current.detachedAt = new Date(this.now()).toISOString()
      delete current.availableRevision
      delete current.availableContentHash
    })
  }

  updateInventoryItemAndReconcileCatalog(rawRef: Row, input: Row, contentHash: string) {
    const { ref, record } = this.prepareInventoryUpdate(rawRef, input)
    const draft = this.getRegistryState() as Row
    const link = draft.links.find((candidate: Row) => candidate.itemType === ref.type && candidate.itemId === ref.id)
    if (link && link.importedContentHash !== contentHash) {
      link.state = 'detached'
      link.detachedAt = new Date(this.now()).toISOString()
      delete link.availableRevision
      delete link.availableContentHash
    }
    assertRegistryStoreShape(draft)
    this.commitCanonicalMutation(() => {
      this.replaceInventoryRecord(ref, record)
      persistRegistryState(
        this.core.database,
        draft,
        this.now(),
        (type, id) => this.resolveItem(type, id),
      )
    })
    return this.getProject()
  }

  getCatalogUpdates() {
    const registry = this.getRegistryState() as Row
    const project = this.getProject()
    const linked = registry.links
      .filter((link: Row) => ['update-available', 'adoption-available'].includes(link.state))
      .map((link: Row) => ({
        linkId: link.id,
        itemType: link.itemType,
        itemId: link.itemId,
        itemName: project.items[`${link.itemType}:${link.itemId}`]?.name ?? 'Missing inventory item',
        templateKey: link.templateKey,
        importedRevision: link.importedRevision,
        availableRevision: link.availableRevision,
        state: link.state,
      }))
    const variants = (registry.variantMatches ?? []).map((match: Row) => ({
      variantMatchId: match.id,
      itemType: match.itemType,
      itemId: match.itemId,
      itemName: project.items[`${match.itemType}:${match.itemId}`]?.name ?? 'Missing inventory item',
      state: 'variant-selection-required',
      productFamily: match.productFamily,
      candidates: match.candidates,
    }))
    return [...variants, ...linked]
  }

  selectCatalogVariant(variantMatchId: number, template: Row) {
    const registry = this.getRegistryState() as Row
    const match = (registry.variantMatches ?? []).find((candidate: Row) => candidate.id === variantMatchId)
    if (!match) throw lifecycleError('Catalog variant selection was not found.', 'catalog-variant-selection-not-found', 404)
    if (!match.candidates.some((candidate: Row) => candidate.templateKey === template.templateKey)) {
      throw lifecycleError('The selected template is not a candidate for this hardware variant.', 'catalog-variant-selection-invalid', 409)
    }
    return this.registryTransaction((draft: any) => {
      if (draft.links.some((link: Row) => link.itemType === match.itemType && link.itemId === match.itemId)) {
        throw lifecycleError('This inventory item already has a registry link.', 'catalog-link-already-exists', 409)
      }
      draft.links.push({
        id: nextPublicId(draft.links), itemType: match.itemType, itemId: match.itemId,
        sourceId: match.sourceId, templateKey: template.templateKey,
        importedRevision: template.revision, importedContentHash: match.localContentHash,
        importedFingerprintVersion: template.fingerprintVersion,
        ...(template.productFamily ? { productFamily: template.productFamily } : {}),
        ...(template.variantEvidence ? { variantEvidence: template.variantEvidence } : {}),
        ...(template.identityAliases ? { identityAliases: template.identityAliases } : {}),
        state: 'adoption-available', linkedAt: new Date(this.now()).toISOString(),
        availableRevision: template.revision, availableContentHash: template.contentHash,
      })
      draft.variantMatches = draft.variantMatches.filter((candidate: Row) => candidate.id !== variantMatchId)
    })
  }

  getCatalogUpdatePreview(linkId: number, template: Row) {
    const registry = this.getRegistryState() as Row
    const link = registry.links.find((candidate: Row) => candidate.id === linkId)
    if (!link || !['update-available', 'adoption-available'].includes(link.state)) {
      throw lifecycleError('Catalog update was not found.', 'catalog-update-not-found', 404)
    }
    const item = this.getProject().items[`${link.itemType}:${link.itemId}`] as Row | undefined
    if (!item) throw lifecycleError('Linked inventory item was not found.', 'linked-inventory-not-found', 409)
    const nextItem = materializeCatalogItem(
      mergeCatalogUpdate(projectLocalItemForCatalog(item, link.itemType), template.item, template.fingerprintVersion),
      { usageRole: item.usageRole },
    )
    const dependencyConflicts = link.itemType === 'motherboard'
      ? motherboardCatalogUpdateConflicts(this.getProject(), link.itemId, nextItem)
      : []
    return {
      linkId,
      itemType: link.itemType,
      itemId: link.itemId,
      itemName: item.name,
      templateKey: link.templateKey,
      importedRevision: link.importedRevision,
      availableRevision: template.revision,
      state: link.state,
      changes: catalogFieldDiff(projectLocalItemForCatalog(item, link.itemType), template.item, template.fingerprintVersion),
      dependencyConflicts,
      localFieldsPreserved: Object.keys(item).filter(
        (key) => key === 'name' || !['id', 'key', 'type', 'subtype', 'manufacturer', 'secondaryManufacturer', 'family', 'model', 'number', 'specs', 'ports', 'compatibility'].includes(key),
      ),
    }
  }

  evaluateCatalogUpdate(linkId: number, template: Row) {
    const batch = this.evaluateCatalogUpdates([{ linkId, templateKey: template.templateKey }], [template])
    if (batch.evaluations.length === 0) throw lifecycleError('Catalog update was not found.', 'catalog-update-not-found', 404)
    return batch.evaluations[0]
  }

  private catalogUpdateProjectContexts(links: Row[]) {
    const projectIdsByLinkId = new Map<number, number[]>()
    const projectIds = new Set<number>()
    for (const link of links) {
      const itemId = this.resolveItem(link.itemType, link.itemId)
      const rows = this.core.database.query(`
        SELECT p.id
        FROM projects p
        JOIN inventory_items i ON i.id = ?
        WHERE p.archived_at_ms IS NULL AND (
          i.owner_project_id = p.id OR EXISTS (
            SELECT 1 FROM project_inventory_memberships m
            WHERE m.project_id = p.id AND m.item_id = i.id
          )
        )
        ORDER BY p.id
      `).all(itemId) as Array<{ id: number }>
      const ids = rows.map((row) => row.id)
      projectIdsByLinkId.set(link.id, ids)
      for (const projectId of ids) projectIds.add(projectId)
    }
    const projects = new Map<number, ProjectState>()
    for (const projectId of projectIds) {
      const workbook = this.projects.getWorkbook(projectId)
      const canvas = workbook.workspaces.find((workspace) => (
        workspace.id === workbook.defaultWorkspaceId && workspace.type === 'canvas'
      )) ?? workbook.workspaces.find((workspace) => workspace.type === 'canvas')
      if (!canvas) throw lifecycleError(`Project ${projectId} has no active Canvas workspace.`, 'project-canvas-not-found', 409)
      projects.set(projectId, this.getWorkspace(projectId, canvas.id))
    }
    return { projectIdsByLinkId, projects }
  }

  evaluateCatalogUpdates(updates: Row[], templates: Row[]) {
    const registry = this.getRegistryState() as Row
    const templateByKey = new Map(templates.map((template: Row) => [template.templateKey, template]))
    const updateLinkIds = new Set(updates.map((update: Row) => update.linkId))
    const links = registry.links.filter((link: Row) => updateLinkIds.has(link.id))
    const { projectIdsByLinkId, projects } = this.catalogUpdateProjectContexts(links)
    const proposals = links.flatMap((link: Row) => {
      if (!updateLinkIds.has(link.id)) return []
      const template = templateByKey.get(link.templateKey)
      const itemKey = `${link.itemType}:${link.itemId}`
      const projectIds = projectIdsByLinkId.get(link.id) ?? []
      const current = projectIds.map((projectId) => projects.get(projectId)?.items[itemKey] as Row | undefined).find(Boolean)
      if (!template || !current || template.revision !== link.availableRevision) return []
      const nextItem = materializeCatalogItem(
        mergeCatalogUpdate(projectLocalItemForCatalog(current, link.itemType), template.item, template.fingerprintVersion),
        { usageRole: current.usageRole },
      )
      let validationError = null
      const dependencyConflicts = []
      for (const projectId of projectIds) {
        const project = projects.get(projectId)!
        try {
          this.prepareInventoryUpdate({ type: link.itemType, id: link.itemId }, nextItem, project)
        } catch (error) {
          validationError ??= { code: error instanceof InventoryLifecycleError ? error.code : 'validation-failed' }
        }
        if (link.itemType === 'motherboard') {
          dependencyConflicts.push(...motherboardCatalogUpdateConflicts(project, link.itemId, nextItem))
        }
      }
      return [{
        link,
        template,
        current,
        nextItem,
        projectIds,
        validationError,
        dependencyConflicts,
        changes: catalogFieldDiff(projectLocalItemForCatalog(current, link.itemType), template.item, template.fingerprintVersion),
        resolutionPlans: projectIds.map((projectId) => ({
          projectId,
          ...buildCatalogResolutionPlan({ current, next: nextItem, project: projects.get(projectId), link }),
        })),
      }]
    })
    const findingsByProject = new Map<number, { before: Row[]; after: Row[] }>()
    for (const [projectId, project] of projects) {
      const nextProject = structuredClone(project)
      for (const proposal of proposals) {
        if (proposal.projectIds.includes(projectId)) {
          nextProject.items[`${proposal.link.itemType}:${proposal.link.itemId}`] = proposal.nextItem
        }
      }
      findingsByProject.set(projectId, {
        before: evaluateProjectCompatibility(project),
        after: evaluateProjectCompatibility(nextProject),
      })
    }
    const evaluations = proposals.map((proposal) => {
      const itemKey = `${proposal.link.itemType}:${proposal.link.itemId}`
      const beforeFindings = []
      const afterFindings = []
      for (const projectId of proposal.projectIds) {
        const project = projects.get(projectId)!
        const affectedHostIds = new Set((project.assignments ?? []).flatMap((assignment: Row) => {
          if (assignment.serverId === itemKey) return [assignment.serverId]
          return assignment.itemId === itemKey ? [assignment.serverId] : []
        }))
        const relevant = (result: Row) => result.itemId === itemKey || result.hostId === itemKey || affectedHostIds.has(result.hostId)
        const findings = findingsByProject.get(projectId)!
        beforeFindings.push(...findings.before.filter(relevant))
        afterFindings.push(...findings.after.filter(relevant))
      }
      return {
        linkId: proposal.link.id,
        itemType: proposal.link.itemType,
        itemId: proposal.link.itemId,
        itemName: proposal.current.name,
        templateKey: proposal.link.templateKey,
        importedRevision: proposal.link.importedRevision,
        availableRevision: proposal.template.revision,
        state: proposal.link.state,
        changes: proposal.changes,
        dependencyConflicts: proposal.dependencyConflicts,
        resolution: {
          available: proposal.resolutionPlans.some((plan) => plan.available)
            && proposal.resolutionPlans.every((plan) => plan.available || plan.operations.length === 0),
          projects: proposal.resolutionPlans,
        },
        localFieldsPreserved: Object.keys(proposal.current).filter(
          (key) => key === 'name' || !['id', 'key', 'type', 'subtype', 'manufacturer', 'secondaryManufacturer', 'family', 'model', 'number', 'specs', 'ports', 'compatibility'].includes(key),
        ),
        ...classifyCatalogUpdate({
          itemType: proposal.link.itemType,
          changes: proposal.changes,
          dependencyConflicts: proposal.dependencyConflicts,
          beforeFindings,
          afterFindings,
          validationError: proposal.validationError,
        }),
        nextItem: proposal.nextItem,
        targetContentHash: proposal.template.contentHash,
      }
    })
    return {
      projectRevision: projects.get(this.projectId)?.revision ?? this.getEngineRevision(),
      projectRevisions: Object.fromEntries([...projects].map(([projectId, project]) => [projectId, project.revision])),
      evaluations,
    }
  }

  commitCatalogUpdateRun({ sourceId, catalogRevision, evaluations, templates, automatic = true, forceLinkIds = [], decidedByUserId = null, expectedProjectRevision = null, expectedProjectRevisions = null }: Row) {
    const registry = this.getRegistryState() as Row
    const expectedRevisions = expectedProjectRevisions
      ? new Map(Object.entries(expectedProjectRevisions).map(([projectId, revision]) => [Number(projectId), Number(revision)]))
      : expectedProjectRevision !== null ? new Map([[this.projectId, Number(expectedProjectRevision)]]) : new Map<number, number>()
    for (const [projectId, revision] of expectedRevisions) {
      const current = this.core.database.query('SELECT revision FROM projects WHERE id = ? AND archived_at_ms IS NULL').get(projectId) as Row | null
      if (!current || current.revision !== revision) {
        throw lifecycleError('Project changed while evaluating registry updates.', 'revision-conflict', 409)
      }
    }
    const now = this.now()
    const templateByKey = new Map((templates as Row[]).map((template) => [template.templateKey, template]))
    const priorDecisions = new Map((this.core.database.query(`
      SELECT e.link_id, e.to_revision, e.target_content_hash, e.decision
      FROM registry_update_evaluations e
      WHERE e.decision = 'declined'
    `).all() as Row[]).map((row) => [`${row.link_id}:${row.to_revision}:${row.target_content_hash}`, row.decision]))
    const forced = new Set(forceLinkIds as number[])
    const applicable = (evaluations as Row[]).map((evaluation) => ({
      ...evaluation,
      decision: priorDecisions.has(`${evaluation.linkId}:${evaluation.availableRevision}:${evaluation.targetContentHash}`)
        ? 'declined'
        : forced.has(evaluation.linkId) && evaluation.classification !== 'blocked'
          ? 'applied'
          : evaluation.classification === 'safe' && automatic ? 'applied' : 'pending',
    }))
    const prepared = applicable.filter((entry) => entry.decision === 'applied').map((entry) => {
      const link = registry.links.find((candidate: Row) => candidate.id === entry.linkId)
      const template = templateByKey.get(link?.templateKey)
      if (!link || !template || link.availableContentHash !== template.contentHash) {
        throw lifecycleError('Catalog update changed during evaluation.', 'catalog-update-stale', 409)
      }
      const { projects } = this.catalogUpdateProjectContexts([link])
      const currentProject = [...projects.values()][0]
      const current = currentProject?.items[`${link.itemType}:${link.itemId}`] as Row | undefined
      if (!current) throw lifecycleError('Linked inventory item was not found.', 'linked-inventory-not-found', 409)
      const nextItem = materializeCatalogItem(
        mergeCatalogUpdate(projectLocalItemForCatalog(current, link.itemType), template.item, template.fingerprintVersion),
        { usageRole: current.usageRole },
      )
      for (const project of projects.values()) this.prepareInventoryUpdate({ type: link.itemType, id: link.itemId }, nextItem, project)
      return {
        entry,
        link,
        template,
        projectId: Number(currentProject.metadata?.projectId ?? this.projectId),
        prepared: this.prepareInventoryUpdate({ type: link.itemType, id: link.itemId }, nextItem, currentProject),
      }
    })
    const draft = structuredClone(registry)
    for (const { link, template } of prepared) {
      const target = draft.links.find((candidate: Row) => candidate.id === link.id)
      Object.assign(target, {
        importedRevision: template.revision,
        importedContentHash: template.contentHash,
        importedFingerprintVersion: template.fingerprintVersion,
        state: 'linked',
        updatedAt: new Date(now).toISOString(),
      })
      if (template.productFamily) target.productFamily = template.productFamily
      else delete target.productFamily
      if (template.variantEvidence) target.variantEvidence = template.variantEvidence
      else delete target.variantEvidence
      if (template.identityAliases) target.identityAliases = template.identityAliases
      else delete target.identityAliases
      delete target.availableRevision
      delete target.availableContentHash
      delete target.detachedAt
    }
    let counts = {
      applied: applicable.filter((entry) => entry.decision === 'applied').length,
      review: applicable.filter((entry) => entry.decision === 'pending' && entry.classification !== 'blocked').length,
      blocked: applicable.filter((entry) => entry.decision === 'pending' && entry.classification === 'blocked').length,
      skipped: applicable.filter((entry) => ['declined', 'superseded'].includes(entry.decision)).length,
    }
    const operation = () => {
      for (const record of prepared) this.replaceInventoryRecord(record.prepared.ref, record.prepared.record, record.projectId)
      persistRegistryState(this.core.database, draft, now, (type, id) => this.resolveItem(type, id))
      this.core.database.query(`
        INSERT INTO registry_update_runs (source_id, catalog_revision, state, automatic, applied_count, review_count, blocked_count, skipped_count, started_at_ms, completed_at_ms)
        VALUES (?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_id, catalog_revision) DO UPDATE SET
          state = 'completed', automatic = excluded.automatic,
          applied_count = excluded.applied_count, review_count = excluded.review_count,
          blocked_count = excluded.blocked_count, skipped_count = excluded.skipped_count,
          attempt_count = 0, retry_after_ms = NULL, error = NULL,
          completed_at_ms = excluded.completed_at_ms
      `).run(sourceId, catalogRevision, Number(automatic), counts.applied, counts.review, counts.blocked, counts.skipped, now, now)
      const run = this.core.database.query('SELECT id FROM registry_update_runs WHERE source_id = ? AND catalog_revision = ?').get(sourceId, catalogRevision) as Row
      for (const entry of applicable) {
        this.core.database.query(`
          INSERT INTO registry_update_evaluations (run_id, link_id, from_revision, to_revision, target_content_hash, classification, decision, reasons_json, changes_json, decided_by_user_id, evaluated_at_ms, decided_at_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(run_id, link_id) DO UPDATE SET
            classification = excluded.classification,
            decision = CASE WHEN registry_update_evaluations.decision = 'declined' THEN 'declined' ELSE excluded.decision END,
            reasons_json = excluded.reasons_json, changes_json = excluded.changes_json,
            decided_by_user_id = CASE WHEN registry_update_evaluations.decision = 'declined' THEN registry_update_evaluations.decided_by_user_id ELSE excluded.decided_by_user_id END,
            evaluated_at_ms = excluded.evaluated_at_ms,
            decided_at_ms = CASE WHEN registry_update_evaluations.decision = 'declined' THEN registry_update_evaluations.decided_at_ms ELSE excluded.decided_at_ms END
        `).run(run.id, entry.linkId, entry.importedRevision, entry.availableRevision, entry.targetContentHash,
          entry.classification, entry.decision, JSON.stringify(entry.reasons), JSON.stringify(entry.changes),
          entry.decision === 'applied' ? decidedByUserId : null, now,
          entry.decision === 'applied' ? now : null)
      }
      const totals = this.core.database.query(`
        SELECT
          SUM(CASE WHEN decision = 'applied' THEN 1 ELSE 0 END) AS applied,
          SUM(CASE WHEN decision = 'pending' AND classification != 'blocked' THEN 1 ELSE 0 END) AS review,
          SUM(CASE WHEN decision = 'pending' AND classification = 'blocked' THEN 1 ELSE 0 END) AS blocked,
          SUM(CASE WHEN decision IN ('declined', 'superseded') THEN 1 ELSE 0 END) AS skipped
        FROM registry_update_evaluations WHERE run_id = ?
      `).get(run.id) as Row
      counts = {
        applied: Number(totals.applied ?? 0),
        review: Number(totals.review ?? 0),
        blocked: Number(totals.blocked ?? 0),
        skipped: Number(totals.skipped ?? 0),
      }
      this.core.database.query(`
        UPDATE registry_update_runs SET applied_count = ?, review_count = ?, blocked_count = ?, skipped_count = ? WHERE id = ?
      `).run(counts.applied, counts.review, counts.blocked, counts.skipped, run.id)
    }
    const preparedLinks = prepared.map((record) => record.link)
    const { projectIdsByLinkId } = preparedLinks.length > 0
      ? this.catalogUpdateProjectContexts(preparedLinks)
      : { projectIdsByLinkId: new Map<number, number[]>() }
    const affectedProjectIds = [...new Set(preparedLinks.flatMap((link) => projectIdsByLinkId.get(link.id) ?? []))]
    let affectedProjectRevisions: Record<number, number> = {}
    if (prepared.length > 0) {
      affectedProjectRevisions = this.commitCanonicalMutationAcrossProjects(operation, affectedProjectIds, expectedRevisions)
    }
    else this.core.database.transaction(operation).immediate()
    return {
      ...counts,
      decisions: (templates as Row[]).map((template) => ({
        templateKey: template.templateKey,
        toRevision: template.revision,
        status: 'applied',
      })),
      summary: this.getRegistryUpdateSummary(),
      affectedProjectIds,
      affectedProjectRevisions,
      affectedLinkIds: preparedLinks.map((link) => link.id),
    }
  }

  getRegistryUpdateGroups() {
    const links = (this.core.database.query(`
      SELECT l.id, l.item_id AS canonical_item_id, l.template_key, l.imported_revision,
        l.imported_content_hash, l.available_revision, l.available_content_hash, l.state,
        a.legacy_type_key, a.legacy_id, i.name AS inventory_name
      FROM registry_links l
      JOIN inventory_items i ON i.id = l.item_id
      JOIN inventory_identity_aliases a ON a.item_id = l.item_id
    `).all() as Row[]).map((row) => ({
      id: row.id,
      canonicalItemId: row.canonical_item_id,
      itemId: row.legacy_id,
      itemType: row.legacy_type_key,
      templateKey: row.template_key,
      importedRevision: row.imported_revision,
      importedContentHash: row.imported_content_hash,
      availableRevision: row.available_revision,
      availableContentHash: row.available_content_hash,
      state: row.state,
      inventoryName: row.inventory_name,
    }))
    const evaluationRows = this.core.database.query(`
      SELECT * FROM registry_current_update_evaluations
      UNION ALL
      SELECT evaluation.*
      FROM registry_update_evaluations evaluation
      WHERE evaluation.decision IN ('applied', 'declined')
        AND NOT EXISTS (
          SELECT 1 FROM registry_update_evaluations newer
          WHERE newer.link_id = evaluation.link_id
            AND newer.to_revision = evaluation.to_revision
            AND newer.target_content_hash = evaluation.target_content_hash
            AND newer.decision = evaluation.decision
            AND (
              newer.evaluated_at_ms > evaluation.evaluated_at_ms
              OR (newer.evaluated_at_ms = evaluation.evaluated_at_ms AND newer.id > evaluation.id)
            )
        )
    `).all() as Row[]
    const evaluations = evaluationRows.map((row) => ({
      id: row.id,
      linkId: row.link_id,
      fromRevision: row.from_revision,
      toRevision: row.to_revision,
      targetContentHash: row.target_content_hash,
      classification: row.classification,
      decision: row.decision,
      reasons: JSON.parse(row.reasons_json),
      changes: JSON.parse(row.changes_json),
      evaluatedAtMs: row.evaluated_at_ms,
    }))
    const itemProjects = new Map<number, Row[]>()
    for (const row of this.core.database.query(`
      SELECT m.item_id, p.id, p.name FROM project_inventory_memberships m
      JOIN projects p ON p.id = m.project_id AND p.archived_at_ms IS NULL
      UNION
      SELECT i.id AS item_id, p.id, p.name FROM inventory_items i
      JOIN projects p ON p.id = i.owner_project_id AND p.archived_at_ms IS NULL
    `).all() as Row[]) {
      const projects = itemProjects.get(row.item_id) ?? []
      projects.push({ id: row.id, name: row.name })
      itemProjects.set(row.item_id, projects)
    }
    const projectRevisions = Object.fromEntries(
      (this.core.database.query('SELECT id, revision FROM projects WHERE archived_at_ms IS NULL').all() as Row[])
        .map((row) => [row.id, row.revision]),
    )
    const snapshot = this.core.database.query(
      'SELECT revision FROM registry_snapshots ORDER BY revision DESC, id DESC LIMIT 1',
    ).get() as Row | null
    const linkById = new Map(links.map((link) => [link.id, link]))
    const projectIdsByLinkId = new Map(links.map((link) => [
      link.id,
      (itemProjects.get(link.canonicalItemId) ?? []).map((project: Row) => project.id),
    ]))
    return projectRegistryUpdateGroups({
      evaluations,
      links,
      projectRevisions,
      projectIdsByLinkId,
      catalogRevision: snapshot?.revision ?? null,
    }).map((group) => {
      const items = group.members.map((member: Row) => {
        const link = linkById.get(member.linkId)!
        const projects = itemProjects.get(link.canonicalItemId) ?? []
        return {
          linkId: member.linkId,
          itemType: link.itemType,
          itemId: link.itemId,
          itemName: link.inventoryName,
          projects,
          classification: member.classification,
          fromRevision: member.fromRevision,
        }
      })
      return {
        ...group,
        items,
        projects: [...new Map(items.flatMap((item: Row) => item.projects).map((project: Row) => [project.id, project])).values()],
        evaluatedAt: new Date(group.evaluatedAtMs).toISOString(),
      }
    })
  }

  getRegistryUpdateSummary() {
    return { run: this.getRegistryUpdateStatus(), counts: registryUpdateCounts(this.getRegistryUpdateGroups()) }
  }

  getCatalogUpdateReconciliationVersion() {
    const version = Number(metadata(this.core.database, 'registry.update-reconciliation-version', 0))
    return Number.isSafeInteger(version) && version >= 0 ? version : 0
  }

  markCatalogUpdateReconciliationComplete(version: number) {
    if (!Number.isSafeInteger(version) || version <= 0) {
      throw lifecycleError('Registry update reconciliation version is invalid.', 'invalid-registry-update-reconciliation-version', 500)
    }
    putMetadata(this.core.database, 'registry.update-reconciliation-version', version, this.now())
  }

  getRegistryUpdateGroup(groupId: string, concurrencyToken?: string | null) {
    const group = this.getRegistryUpdateGroups().find((candidate: Row) => candidate.id === groupId)
    if (!group) throw lifecycleError('Registry update group was not found.', 'registry-update-group-not-found', 404)
    if (concurrencyToken && group.concurrencyToken !== concurrencyToken) {
      throw lifecycleError('Registry update state changed; refresh before continuing.', 'registry-update-refresh-required', 409)
    }
    return group
  }

  getRegistryUpdateGroupDetail(groupId: string, concurrencyToken: string, template?: Row | null) {
    const group = this.getRegistryUpdateGroup(groupId, concurrencyToken)
    if (['applied', 'declined'].includes(group.status)) {
      return { ...group, members: group.members.map((member: Row) => ({ ...member, resolution: null })) }
    }
    if (
      template?.templateKey !== group.templateKey
      || template?.revision !== group.toRevision
      || template?.contentHash !== group.targetContentHash
    ) {
      throw lifecycleError('Registry update state changed; refresh before continuing.', 'registry-update-refresh-required', 409)
    }
    if (!['review', 'blocked'].includes(group.status)) return { ...group, proposed: template.item, resolutions: [] }

    const registry = this.getRegistryState() as Row
    const links = group.members.map((member: Row) => (
      registry.links.find((candidate: Row) => candidate.id === member.linkId)
    )).filter(Boolean)
    const { projectIdsByLinkId, projects } = this.catalogUpdateProjectContexts(links)
    const members = group.members.map((member: Row) => {
      const link = links.find((candidate: Row) => candidate.id === member.linkId)
      const projectIds = projectIdsByLinkId.get(member.linkId) ?? []
      const current = projectIds
        .map((projectId) => projects.get(projectId)?.items[`${link.itemType}:${link.itemId}`] as Row | undefined)
        .find(Boolean)
      if (!current) throw lifecycleError('Linked inventory item was not found.', 'linked-inventory-not-found', 409)
      const plan = planCatalogUpdate(
        projectLocalItemForCatalog(current, link.itemType),
        template.item,
        template.fingerprintVersion,
      )
      const next = materializeCatalogItem(plan.nextItem, { usageRole: current.usageRole })
      const resolutionPlans = projectIds.map((projectId) => buildCatalogResolutionPlan({
        current,
        next,
        project: projects.get(projectId),
        link,
      }))
      const availablePlans = resolutionPlans.filter((resolution: Row) => resolution.available)
      return {
        ...member,
        current: projectLocalItemForCatalog(current, link.itemType),
        proposed: next,
        changes: canonicalCatalogFieldChanges(plan.changes),
        resolution: availablePlans.length > 0
          ? {
              available: true,
              operations: availablePlans.flatMap((resolution: Row) => resolution.operations),
              affectedRelationships: {
                connectionIds: [...new Set(availablePlans.flatMap((resolution: Row) => resolution.affectedRelationships.connectionIds))],
                assignmentIds: [...new Set(availablePlans.flatMap((resolution: Row) => resolution.affectedRelationships.assignmentIds))],
              },
              reason: availablePlans.map((resolution: Row) => resolution.reason).find(Boolean) ?? null,
            }
          : { available: false, operations: [], affectedRelationships: { connectionIds: [], assignmentIds: [] }, reason: resolutionPlans[0]?.reason ?? 'No deterministic resolution is available.' },
      }
    })
    return { ...group, members }
  }

  decideRegistryUpdateGroupById({ groupId, concurrencyToken, decision, userId = null }: Row) {
    if (!['declined', 'pending'].includes(decision)) {
      throw lifecycleError('Registry update decision is invalid.', 'invalid-registry-update-decision', 400)
    }
    const group = this.getRegistryUpdateGroup(groupId, concurrencyToken)
    if (decision === 'declined' && !['review', 'blocked'].includes(group.status)) {
      throw lifecycleError('Only current Registry updates can be declined.', 'registry-update-group-not-actionable', 409)
    }
    if (decision === 'pending' && group.status !== 'declined') {
      throw lifecycleError('Only declined Registry updates can be reconsidered.', 'registry-update-group-not-actionable', 409)
    }
    if (decision === 'pending' && group.reconsiderable !== true) {
      throw lifecycleError('This Registry update has been superseded and cannot be reconsidered.', 'registry-update-group-not-actionable', 409)
    }
    const evaluationIds = group.members.map((member: Row) => member.evaluationId)
    const placeholders = evaluationIds.map(() => '?').join(', ')
    this.core.database.transaction(() => {
      const now = this.now()
      const changed = this.core.database.query(`
        UPDATE registry_update_evaluations
        SET decision = ?, decided_by_user_id = ?, decided_at_ms = ?
        WHERE id IN (${placeholders}) AND decision = ?
      `).run(
        decision,
        decision === 'pending' ? null : userId,
        decision === 'pending' ? null : now,
        ...evaluationIds,
        decision === 'pending' ? 'declined' : 'pending',
      )
      if (changed.changes !== evaluationIds.length) {
        throw lifecycleError('Registry update state changed; refresh before continuing.', 'registry-update-refresh-required', 409)
      }
      this.refreshRegistryUpdateRunCounts()
    }).immediate()
    const nextStatus = decision === 'declined' ? 'declined' : group.classification === 'blocked' ? 'blocked' : 'review'
    const refreshed = this.getRegistryUpdateGroups().find((candidate: Row) => (
      candidate.status === nextStatus
      && candidate.templateKey === group.templateKey
      && candidate.toRevision === group.toRevision
      && candidate.targetContentHash === group.targetContentHash
    ))
    return {
      decisions: [{
        groupId: refreshed?.id ?? group.id,
        previousGroupId: group.id,
        concurrencyToken: refreshed?.concurrencyToken ?? null,
        templateKey: group.templateKey,
        toRevision: group.toRevision,
        status: nextStatus,
      }],
      summary: this.getRegistryUpdateSummary(),
      affectedProjectIds: [],
      affectedProjectRevisions: {},
      affectedLinkIds: [],
    }
  }

  applyRegistryUpdateGroupById({ groupId, concurrencyToken, template, userId = null }: Row) {
    const group = this.getRegistryUpdateGroup(groupId, concurrencyToken)
    if (group.status !== 'review' || group.classification === 'blocked') {
      throw lifecycleError('This Registry update cannot be applied without resolution.', 'registry-update-blocked', 409)
    }
    if (
      template?.templateKey !== group.templateKey
      || template?.revision !== group.toRevision
      || template?.contentHash !== group.targetContentHash
    ) {
      throw lifecycleError('Registry update state changed; refresh before continuing.', 'registry-update-refresh-required', 409)
    }
    const result = this.applyRegistryUpdateGroups(
      [template],
      userId,
      { linkIds: group.members.map((member: Row) => member.linkId) },
    )
    const linked = this.core.database.query(`
      SELECT id FROM registry_links
      WHERE id IN (${group.members.map(() => '?').join(', ')})
        AND state = 'linked' AND imported_revision = ? AND imported_content_hash = ?
    `).all(...group.members.map((member: Row) => member.linkId), group.toRevision, group.targetContentHash) as Row[]
    if (linked.length !== group.members.length) {
      throw lifecycleError('Registry update could not be proven after commit.', 'registry-update-commit-unverified', 500)
    }
    const appliedGroup = this.getRegistryUpdateGroups().find((candidate: Row) => (
      candidate.status === 'applied'
      && candidate.templateKey === group.templateKey
      && candidate.toRevision === group.toRevision
      && candidate.targetContentHash === group.targetContentHash
    ))
    if (!appliedGroup) {
      throw lifecycleError('Registry update receipt could not be verified.', 'registry-update-commit-unverified', 500)
    }
    return {
      ...result,
      decisions: [{
        groupId: appliedGroup.id,
        previousGroupId: group.id,
        concurrencyToken: appliedGroup.concurrencyToken,
        templateKey: group.templateKey,
        toRevision: group.toRevision,
        status: 'applied',
      }],
      affectedLinkIds: group.members.map((member: Row) => member.linkId),
    }
  }

  resolveAndApplyRegistryUpdateGroupById({ groupId, concurrencyToken, linkId, template, expectedProjectRevisions = null, userId = null }: Row) {
    const group = this.getRegistryUpdateGroup(groupId, concurrencyToken)
    if (group.status !== 'blocked' || !group.members.some((member: Row) => member.linkId === linkId)) {
      throw lifecycleError('Registry topology resolution is not available for this group.', 'catalog-update-resolution-unavailable', 409)
    }
    const result = this.resolveAndApplyRegistryUpdateGroup(
      { linkId, template, expectedProjectRevisions },
      userId,
    )
    const appliedGroup = this.getRegistryUpdateGroups().find((candidate: Row) => (
      candidate.status === 'applied'
      && candidate.templateKey === group.templateKey
      && candidate.toRevision === group.toRevision
      && candidate.targetContentHash === group.targetContentHash
    ))
    return {
      ...result,
      decisions: [{
        groupId: appliedGroup?.id ?? group.id,
        previousGroupId: group.id,
        concurrencyToken: appliedGroup?.concurrencyToken ?? null,
        templateKey: group.templateKey,
        toRevision: group.toRevision,
        status: 'applied',
      }],
    }
  }

  getRegistryUpdateStatus() {
    const row = this.core.database.query('SELECT * FROM registry_update_runs ORDER BY catalog_revision DESC, id DESC LIMIT 1').get() as Row | null
    if (!row) return null
    return {
      id: row.id,
      catalogRevision: row.catalog_revision,
      state: row.state,
      automatic: Boolean(row.automatic),
      appliedCount: row.applied_count,
      reviewCount: row.review_count,
      blockedCount: row.blocked_count,
      skippedCount: row.skipped_count,
      attemptCount: row.attempt_count,
      retryAfter: row.retry_after_ms ? new Date(row.retry_after_ms).toISOString() : null,
      error: row.error,
      completedAt: row.completed_at_ms ? new Date(row.completed_at_ms).toISOString() : null,
    }
  }

  recordCatalogUpdateFailure({ sourceId, catalogRevision, automatic = true, error }: Row) {
    const now = this.now()
    const current = this.core.database.query(`
      SELECT attempt_count FROM registry_update_runs WHERE source_id = ? AND catalog_revision = ?
    `).get(sourceId, catalogRevision) as Row | null
    const attemptCount = Number(current?.attempt_count ?? 0) + 1
    const retryAfter = now + Math.min(60 * 60_000, 60_000 * (2 ** Math.min(5, attemptCount - 1)))
    const message = String(error instanceof Error ? error.message : error ?? 'Catalog update evaluation failed.').slice(0, 500)
    this.core.database.transaction(() => {
      this.core.database.query(`
        INSERT INTO registry_update_runs (
          source_id, catalog_revision, state, automatic, applied_count, review_count,
          blocked_count, skipped_count, attempt_count, retry_after_ms, error, started_at_ms, completed_at_ms
        ) VALUES (?, ?, 'failed', ?, 0, 0, 0, 0, ?, ?, ?, ?, ?)
        ON CONFLICT(source_id, catalog_revision) DO UPDATE SET
          state = 'failed', automatic = excluded.automatic, attempt_count = excluded.attempt_count,
          retry_after_ms = excluded.retry_after_ms, error = excluded.error, completed_at_ms = excluded.completed_at_ms
      `).run(sourceId, catalogRevision, Number(automatic), attemptCount, retryAfter, message, now, now)
    }).immediate()
    return this.getRegistryUpdateStatus()
  }

  decideRegistryUpdateGroup({ templateKey, toRevision, decision, userId = null }: Row) {
    if (!['applied', 'declined', 'pending'].includes(decision)) {
      throw lifecycleError('Registry update decision is invalid.', 'invalid-registry-update-decision', 400)
    }
    const rows = this.core.database.query(`
      SELECT e.id, e.classification, e.decision FROM registry_update_evaluations e
      JOIN registry_links l ON l.id = e.link_id
      WHERE l.template_key = ? AND e.to_revision = ? AND e.decision IN ('pending', 'declined')
    `).all(templateKey, toRevision) as Row[]
    if (rows.length === 0) throw lifecycleError('Registry update group was not found.', 'registry-update-group-not-found', 404)
    if (decision === 'applied' && rows.some((row) => row.classification === 'blocked')) {
      throw lifecycleError('Blocked registry updates cannot be applied.', 'registry-update-blocked', 409)
    }
    const changedRows = rows.filter((row) => row.decision !== decision)
    if (changedRows.length > 0) this.core.database.transaction(() => {
      const now = this.now()
      for (const row of changedRows) this.core.database.query(`
        UPDATE registry_update_evaluations SET decision = ?, decided_by_user_id = ?, decided_at_ms = ? WHERE id = ?
      `).run(decision, decision === 'pending' ? null : userId, decision === 'pending' ? null : now, row.id)
      this.refreshRegistryUpdateRunCounts()
    }).immediate()
    return {
      decisions: [{
        templateKey,
        toRevision,
        status: decision === 'declined' ? 'declined' : 'review',
      }],
      summary: this.getRegistryUpdateSummary(),
      affectedProjectIds: [],
      affectedProjectRevisions: {},
      affectedLinkIds: [],
    }
  }

  applyRegistryUpdateGroup(template: Row, userId: number | null = null) {
    return this.applyRegistryUpdateGroups([template], userId)
  }

  resolveAndApplyRegistryUpdateGroup({ linkId, template, expectedProjectRevisions = null }: Row, userId: number | null = null) {
    const registry = this.getRegistryState() as Row
    const link = registry.links.find((candidate: Row) => candidate.id === linkId)
    if (
      !link
      || !['update-available', 'adoption-available'].includes(link.state)
      || link.templateKey !== template?.templateKey
      || link.availableRevision !== template?.revision
      || link.availableContentHash !== template?.contentHash
    ) {
      throw lifecycleError('Catalog update changed; refresh before resolving it.', 'catalog-update-stale', 409)
    }

    const { projectIdsByLinkId, projects } = this.catalogUpdateProjectContexts([link])
    const projectIds = projectIdsByLinkId.get(link.id) ?? []
    const current = projectIds.map((projectId) => projects.get(projectId)?.items[`${link.itemType}:${link.itemId}`] as Row | undefined).find(Boolean)
    if (!current) throw lifecycleError('Linked inventory item was not found.', 'linked-inventory-not-found', 409)
    const nextItem = materializeCatalogItem(
      mergeCatalogUpdate(projectLocalItemForCatalog(current, link.itemType), template.item, template.fingerprintVersion),
      { usageRole: current.usageRole },
    )
    const plans = projectIds.map((projectId) => {
      const project = projects.get(projectId)!
      const plan = buildCatalogResolutionPlan({ current, next: nextItem, project, link })
      if (!plan.available && plan.reason !== 'No relationship migration is required.') {
        throw lifecycleError(plan.reason, 'catalog-update-resolution-ambiguous', 409)
      }
      const resolvedProject = plan.available ? applyCatalogResolutionPlan(project, plan) : project
      this.prepareInventoryUpdate(
        { type: link.itemType, id: link.itemId },
        nextItem,
        resolvedProject,
        { allowNasPowerTopologyChange: true, allowConnectedPortTopologyChange: true },
      )
      return { projectId, plan }
    })
    if (!plans.some(({ plan }) => plan.available)) {
      throw lifecycleError('This update has no deterministic topology resolution to apply.', 'catalog-update-resolution-unavailable', 409)
    }
    const expected = expectedProjectRevisions
      ? new Map(Object.entries(expectedProjectRevisions).map(([projectId, revision]) => [Number(projectId), Number(revision)]))
      : new Map(projectIds.map((projectId) => [projectId, projects.get(projectId)!.revision]))
    const movedEndpoints = [] as Row[]
    for (const { projectId, plan } of plans) {
      for (const operation of plan.operations) {
        if (operation.kind !== 'move-connection-endpoint') continue
        const role = operation.endpointRole === 'from' ? 'source' : 'target'
        const row = this.core.database.query(`
          SELECT endpoint.id, endpoint.connection_id, endpoint.role
          FROM connection_endpoints endpoint
          JOIN project_connections connection ON connection.id = endpoint.connection_id
          WHERE connection.project_id = ? AND connection.id = ? AND endpoint.role = ?
        `).get(projectId, operation.connectionId, role) as Row | null
        if (!row) throw lifecycleError('A cable endpoint changed after the resolution was planned.', 'catalog-update-resolution-stale', 409)
        movedEndpoints.push({ ...row, projectId, operation })
      }
    }
    const resourceKeyRemapsByIdentity = new Map<string, Row>()
    for (const { plan } of plans) {
      for (const planned of plan.operations) {
        if (planned.kind !== 'remap-resource-key') continue
        const identity = `${planned.resourceType}:${planned.resourceId}:${planned.fromKey}:${planned.toKey}`
        const existing = resourceKeyRemapsByIdentity.get(identity)
        if (existing) {
          existing.assignmentIds = [...new Set([...existing.assignmentIds, ...planned.assignmentIds])]
            .sort((left, right) => left - right)
        } else {
          resourceKeyRemapsByIdentity.set(identity, structuredClone(planned))
        }
      }
    }
    const resourceKeyRemaps = [...resourceKeyRemapsByIdentity.values()]

    const draft = structuredClone(registry)
    const targetLink = draft.links.find((candidate: Row) => candidate.id === link.id)
    Object.assign(targetLink, {
      importedRevision: template.revision,
      importedContentHash: template.contentHash,
      importedFingerprintVersion: template.fingerprintVersion,
      state: 'linked',
      updatedAt: new Date(this.now()).toISOString(),
    })
    for (const field of ['productFamily', 'variantEvidence', 'identityAliases']) {
      if (template[field] !== undefined) targetLink[field] = structuredClone(template[field])
      else delete targetLink[field]
    }
    delete targetLink.availableRevision
    delete targetLink.availableContentHash
    delete targetLink.detachedAt

    const operation = () => {
      for (const endpoint of movedEndpoints) {
        this.core.database.query('DELETE FROM connection_endpoints WHERE id = ?').run(endpoint.id)
        this.core.database.query('DELETE FROM workspace_route_cache WHERE project_id = ? AND connection_id = ?')
          .run(endpoint.projectId, endpoint.connection_id)
        this.core.database.query('DELETE FROM workspace_manual_bend_points WHERE project_id = ? AND connection_id = ?')
          .run(endpoint.projectId, endpoint.connection_id)
      }
      for (const { projectId, plan } of plans) {
        for (const planned of plan.operations) {
          if (planned.kind !== 'unassign-item') continue
          const deleted = this.core.database.query(
            'DELETE FROM component_assignments WHERE project_id = ? AND id = ? RETURNING id',
          ).all(projectId, planned.assignmentId)
          if (deleted.length !== 1) {
            throw lifecycleError(`Assignment ${planned.assignmentId} changed after the resolution was planned.`, 'catalog-update-resolution-stale', 409)
          }
        }
      }
      this.replaceInventoryRecord(
        { type: link.itemType, id: link.itemId },
        cleanItemForStore(nextItem),
        projectIds[0],
        { resourceKeyRemaps },
      )
      for (const endpoint of movedEndpoints) {
        const target = endpoint.operation.to
        const itemId = this.resolveItem(target.itemType, target.itemId)
        const port = this.core.database.query(`
          SELECT port.id
          FROM inventory_ports port
          JOIN port_identity_aliases aliases ON aliases.port_id = port.id
          WHERE port.item_id = ?
            AND aliases.legacy_item_type_key = ?
            AND aliases.legacy_item_id = ?
            AND aliases.legacy_port_id = ?
        `).get(itemId, target.itemType, target.itemId, target.portId) as Row | null
        if (!port) throw lifecycleError('The resolved cable target no longer exists.', 'catalog-update-resolution-stale', 409)
        this.core.database.query(`
          INSERT INTO connection_endpoints (id, connection_id, role, port_id, endpoint_face_id)
          VALUES (?, ?, ?, ?, NULL)
        `).run(endpoint.id, endpoint.connection_id, endpoint.role, port.id)
      }
      persistRegistryState(this.core.database, draft, this.now(), (type, id) => this.resolveItem(type, id))
      const updated = this.core.database.query(`
        UPDATE registry_update_evaluations
        SET decision = 'applied', decided_by_user_id = ?, decided_at_ms = ?
        WHERE link_id = ? AND to_revision = ? AND target_content_hash = ? AND decision = 'pending'
      `).run(userId, this.now(), link.id, template.revision, template.contentHash)
      if (updated.changes === 0) {
        throw lifecycleError('The reviewed Registry update is no longer pending.', 'catalog-update-resolution-stale', 409)
      }
      this.refreshRegistryUpdateRunCounts()
    }
    const affectedProjectRevisions = this.commitCanonicalMutationAcrossProjects(operation, projectIds, expected)
    return {
      decision: { templateKey: template.templateKey, toRevision: template.revision, status: 'applied' },
      affectedLinkIds: [link.id],
      affectedProjectIds: projectIds,
      affectedProjectRevisions,
      affectedRelationships: {
        connectionIds: [...new Set(plans.flatMap(({ plan }) => plan.affectedRelationships.connectionIds))],
        assignmentIds: [...new Set(plans.flatMap(({ plan }) => plan.affectedRelationships.assignmentIds))],
      },
      summary: this.getRegistryUpdateSummary(),
    }
  }

  applyRegistryUpdateGroups(
    templates: Row[],
    userId: number | null = null,
    scope: { linkIds?: number[] } | null = null,
  ) {
    const registry = this.getRegistryState() as Row
    const snapshot = registry.snapshot
    const templateByIdentity = new Map(templates.map((template: Row) => [`${template.templateKey}:${template.revision}`, template]))
    const exactLinkIds = scope?.linkIds ? new Set(scope.linkIds.map((id) => positiveId(id, 'Registry link ID'))) : null
    const links = registry.links.filter((link: Row) => (
      (!exactLinkIds || exactLinkIds.has(link.id))
      &&
      templateByIdentity.has(`${link.templateKey}:${link.availableRevision}`)
      && templateByIdentity.get(`${link.templateKey}:${link.availableRevision}`)?.contentHash === link.availableContentHash
      && ['update-available', 'adoption-available'].includes(link.state)
    ))
    const requestedIdentities = new Set(templateByIdentity.keys())
    const matchedIdentities = new Set(links.map((link: Row) => `${link.templateKey}:${link.availableRevision}`))
    const appliedLinkIds = new Map<string, number[]>()
    const appliedRows = this.core.database.query(`
      SELECT DISTINCT l.id, l.template_key, e.to_revision, e.target_content_hash
      FROM registry_update_evaluations e
      JOIN registry_links l ON l.id = e.link_id
      WHERE e.decision = 'applied' AND l.state = 'linked'
        AND l.imported_revision = e.to_revision AND l.imported_content_hash = e.target_content_hash
    `).all() as Row[]
    for (const row of appliedRows) {
      if (exactLinkIds && !exactLinkIds.has(row.id)) continue
      const identity = `${row.template_key}:${row.to_revision}`
      if (!requestedIdentities.has(identity) || templateByIdentity.get(identity)?.contentHash !== row.target_content_hash) continue
      appliedLinkIds.set(identity, [...(appliedLinkIds.get(identity) ?? []), row.id])
    }
    if ([...requestedIdentities].some((identity) => !matchedIdentities.has(identity) && !appliedLinkIds.has(identity))) {
      throw lifecycleError('One or more registry update groups were not found.', 'registry-update-group-not-found', 404)
    }
    if (exactLinkIds) {
      const provenLinkIds = new Set([...links.map((link: Row) => link.id), ...[...appliedLinkIds.values()].flat()])
      if ([...exactLinkIds].some((linkId) => !provenLinkIds.has(linkId))) {
        throw lifecycleError('Registry update group membership changed; refresh before continuing.', 'registry-update-refresh-required', 409)
      }
    }
    if (links.length === 0) return {
      applied: 0,
      review: 0,
      blocked: 0,
      skipped: 0,
      decisions: templates.map((template: Row) => ({
        templateKey: template.templateKey,
        toRevision: template.revision,
        status: 'applied',
      })),
      summary: this.getRegistryUpdateSummary(),
      affectedProjectIds: [],
      affectedProjectRevisions: {},
      affectedLinkIds: [...new Set([...appliedLinkIds.values()].flat())],
    }
    const batch = this.evaluateCatalogUpdates(
      links.map((link: Row) => ({ ...link, linkId: link.id })),
      templates,
    )
    const evaluations = batch.evaluations
    if (evaluations.some((evaluation: Row) => evaluation.classification === 'blocked')) {
      throw lifecycleError('Blocked registry updates cannot be applied.', 'registry-update-blocked', 409)
    }
    const result = this.commitCatalogUpdateRun({
      sourceId: snapshot.sourceId,
      catalogRevision: snapshot.revision,
      evaluations,
      templates,
      automatic: false,
      forceLinkIds: links.map((link: Row) => link.id),
      decidedByUserId: userId,
      expectedProjectRevision: batch.projectRevision,
      expectedProjectRevisions: batch.projectRevisions,
    })
    return {
      ...result,
      affectedLinkIds: [...new Set([...result.affectedLinkIds, ...[...appliedLinkIds.values()].flat()])],
    }
  }

  decideRegistryUpdateGroups({ groups, decision, userId = null }: Row) {
    if (!['declined', 'pending'].includes(decision) || !Array.isArray(groups) || groups.length === 0) {
      throw lifecycleError('Registry update decision is invalid.', 'invalid-registry-update-decision', 400)
    }
    let changed = 0
    this.core.database.transaction(() => {
      for (const group of groups) {
        const existing = this.core.database.query(`
          SELECT COUNT(*) AS count FROM registry_update_evaluations e
          JOIN registry_links l ON l.id = e.link_id
          WHERE l.template_key = ? AND e.to_revision = ? AND e.decision IN ('pending', 'declined')
        `).get(group.templateKey, group.toRevision) as Row
        if (Number(existing.count) === 0) {
          throw lifecycleError('Registry update groups were not found.', 'registry-update-group-not-found', 404)
        }
        const now = this.now()
        const result = this.core.database.query(`
          UPDATE registry_update_evaluations SET decision = ?, decided_by_user_id = ?, decided_at_ms = ?
          WHERE id IN (
            SELECT e.id FROM registry_update_evaluations e
            JOIN registry_links l ON l.id = e.link_id
            WHERE l.template_key = ? AND e.to_revision = ? AND e.decision IN ('pending', 'declined') AND e.decision != ?
          )
        `).run(decision, decision === 'pending' ? null : userId, decision === 'pending' ? null : now, group.templateKey, group.toRevision, decision)
        changed += result.changes
      }
      if (changed > 0) this.refreshRegistryUpdateRunCounts()
    }).immediate()
    return {
      decisions: groups.map((group: Row) => ({
        templateKey: group.templateKey,
        toRevision: group.toRevision,
        status: decision === 'declined' ? 'declined' : 'review',
      })),
      summary: this.getRegistryUpdateSummary(),
      affectedProjectIds: [],
      affectedProjectRevisions: {},
      affectedLinkIds: [],
    }
  }

  refreshRegistryUpdateRunCounts() {
    this.core.database.query(`
      UPDATE registry_update_runs SET
        applied_count = (SELECT COUNT(*) FROM registry_update_evaluations WHERE run_id = registry_update_runs.id AND decision = 'applied'),
        review_count = (SELECT COUNT(*) FROM registry_update_evaluations WHERE run_id = registry_update_runs.id AND decision = 'pending' AND classification != 'blocked'),
        blocked_count = (SELECT COUNT(*) FROM registry_update_evaluations WHERE run_id = registry_update_runs.id AND decision = 'pending' AND classification = 'blocked'),
        skipped_count = (SELECT COUNT(*) FROM registry_update_evaluations WHERE run_id = registry_update_runs.id AND decision IN ('declined', 'superseded'))
    `).run()
  }

  applyCatalogUpdate(linkId: number, template: Row) {
    const registry = this.getRegistryState() as Row
    const link = registry.links.find((candidate: Row) => candidate.id === linkId)
    if (!link || !['update-available', 'adoption-available'].includes(link.state)) {
      throw lifecycleError('Catalog update was not found.', 'catalog-update-not-found', 404)
    }
    if (link.templateKey !== template.templateKey || link.availableContentHash !== template.contentHash) {
      throw lifecycleError('Catalog update changed; review the latest revision before applying it.', 'catalog-update-stale', 409)
    }
    const current = this.getProject().items[`${link.itemType}:${link.itemId}`] as Row | undefined
    if (!current) throw lifecycleError('Linked inventory item was not found.', 'linked-inventory-not-found', 409)
    const nextItem = materializeCatalogItem(
      mergeCatalogUpdate(projectLocalItemForCatalog(current, link.itemType), template.item, template.fingerprintVersion),
      { usageRole: current.usageRole },
    )
    const dependencyConflicts = link.itemType === 'motherboard'
      ? motherboardCatalogUpdateConflicts(this.getProject(), link.itemId, nextItem)
      : []
    if (dependencyConflicts.length > 0) {
      throw new InventoryLifecycleError(
        'Resolve incompatible PC Build assignments before applying this motherboard update.',
        { code: 'catalog-update-dependency-conflict', status: 409, details: { conflicts: dependencyConflicts } },
      )
    }
    const prepared = this.prepareInventoryUpdate({ type: link.itemType, id: link.itemId }, nextItem)
    const draft = structuredClone(registry)
    const currentLink = draft.links.find((candidate: Row) => candidate.id === linkId)
    if (!currentLink) throw new Error('Catalog link disappeared during update.')
    currentLink.importedRevision = template.revision
    currentLink.importedContentHash = template.contentHash
    currentLink.importedFingerprintVersion = template.fingerprintVersion
    if (template.productFamily) currentLink.productFamily = template.productFamily
    else delete currentLink.productFamily
    if (template.variantEvidence) currentLink.variantEvidence = template.variantEvidence
    else delete currentLink.variantEvidence
    if (template.identityAliases) currentLink.identityAliases = template.identityAliases
    else delete currentLink.identityAliases
    currentLink.state = 'linked'
    currentLink.updatedAt = new Date(this.now()).toISOString()
    delete currentLink.availableRevision
    delete currentLink.availableContentHash
    delete currentLink.detachedAt
    assertRegistryStoreShape(draft)
    this.commitCanonicalMutation(() => {
      this.replaceInventoryRecord(prepared.ref, prepared.record)
      persistRegistryState(
        this.core.database,
        draft,
        this.now(),
        (type, id) => this.resolveItem(type, id),
      )
    })
    return this.getProject()
  }

  getAuthenticationState() {
    return structuredClone(normalizeAuthenticationStore(projectAuthenticationState(this.core.database)))
  }

  updateAuthentication(mutator: (draft: unknown) => void) {
    const draft = this.getAuthenticationState() as Row
    mutator(draft)
    assertAuthenticationStoreShape(draft)
    this.core.database.transaction(() => {
      persistAuthenticationState(this.core.database, draft, this.now())
    }).immediate()
    return this.getAuthenticationState()
  }

  getBackupManagementState() {
    return structuredClone(normalizeBackupManagementStore(projectBackupManagementState(this.core.database)))
  }

  updateBackupManagement(mutator: (draft: unknown) => void) {
    const draft = this.getBackupManagementState() as Row
    mutator(draft)
    assertBackupManagementStoreShape(draft)
    this.core.database.transaction(() => {
      persistBackupManagementState(this.core.database, draft, this.now())
    }).immediate()
    return this.getBackupManagementState()
  }

  listAgentEnrollments() {
    return structuredClone(Object.values((projectAgentState(this.core.database) as Row).enrollments ?? {}))
  }

  findAgentEnrollment({ hostType, hostId, protocolMajor, tokenHash, nowMs = Date.now() }: Row) {
    const record = this.listAgentEnrollments().find((candidate: Row) =>
      candidate.hostType === hostType
      && candidate.hostId === hostId
      && (protocolMajor === undefined || candidate.protocolMajor === protocolMajor)
      && !candidate.usedAt
      && !candidate.revokedAt
      && Date.parse(candidate.expiresAt) > nowMs
      && timingSafeEqualString(candidate.tokenHash, tokenHash),
    ) as Row | undefined
    return record ? structuredClone(record) : null
  }

  findAgentDevice({ deviceId, hostType, hostId, protocolMajor, tokenHash, revoked = false }: Row) {
    const devices = (projectAgentState(this.core.database) as Row).devices ?? {}
    const candidates = deviceId === undefined
      ? Object.values(devices)
      : [devices[String(deviceId)]].filter(Boolean)
    const record = candidates.find((candidate: any) =>
      candidate.hostType === hostType
      && candidate.hostId === hostId
      && (protocolMajor === undefined || candidate.protocolMajor === protocolMajor)
      && (revoked ? Boolean(candidate.revokedAt) : !candidate.revokedAt)
      && (tokenHash === undefined || timingSafeEqualString(candidate.tokenHash, tokenHash)),
    ) as Row | undefined
    return record ? structuredClone(record) : null
  }

  createAgentEnrollment(input: Row) {
    const hostId = positiveId(input.hostId, 'Agent host ID')
    const hostItemId = this.resolveItem(input.hostType, hostId)
    const state = projectAgentState(this.core.database) as Row
    const status = projectAgentStatusState(this.core.database) as Row
    const ids = Object.values(state.enrollments ?? {}).map((record: any) => record.id)
    const id = Math.max(0, ...ids) + 1
    const record = { ...structuredClone(input), id, hostId }
    this.core.database.transaction(() => {
      for (const enrollment of Object.values(state.enrollments ?? {}) as Row[]) {
        if (enrollment.hostType !== input.hostType || enrollment.hostId !== hostId || enrollment.usedAt || enrollment.revokedAt) continue
        enrollment.revokedAt = input.createdAt
        this.core.database.query('UPDATE agent_enrollment_codes SET revoked_at_ms = ? WHERE id = ?')
          .run(toMilliseconds(input.createdAt, this.now()), enrollment.id)
      }
      state.enrollments[String(id)] = record
      this.core.database.query(`
        INSERT INTO agent_enrollment_codes (
          id, host_item_id, token_hash, expires_at_ms, used_at_ms, revoked_at_ms, created_at_ms
        ) VALUES (?, ?, ?, ?, NULL, NULL, ?)
      `).run(id, hostItemId, input.tokenHash, toMilliseconds(input.expiresAt, this.now()), toMilliseconds(input.createdAt, this.now()))
      persistAgentExtendedState(this.core.database, state, status, this.now())
    }).immediate()
    return structuredClone(record)
  }

  activateAgentEnrollment({ enrollmentId, device }: { enrollmentId: number; device: Row }) {
    const state = projectAgentState(this.core.database) as Row
    const status = projectAgentStatusState(this.core.database) as Row
    const enrollment = state.enrollments?.[String(enrollmentId)]
    if (!enrollment || enrollment.usedAt || enrollment.revokedAt) {
      throw lifecycleError('Enrollment is no longer available.', 'agent-enrollment-unavailable', 409)
    }
    if (enrollment.hostType !== device.hostType || enrollment.hostId !== device.hostId || (enrollment.protocolMajor !== undefined && enrollment.protocolMajor !== device.protocolMajor)) {
      throw lifecycleError('Enrollment does not belong to this agent host.', 'agent-enrollment-host-mismatch', 409)
    }
    const publicId = Math.max(0, ...Object.values(state.devices ?? {}).map((record: any) => record.id)) + 1
    const created = { ...structuredClone(device), id: publicId }
    const revokedDeviceIds: number[] = []
    const now = toMilliseconds(device.createdAt, this.now())
    this.core.database.transaction(() => {
      enrollment.usedAt = device.createdAt
      this.core.database.query('UPDATE agent_enrollment_codes SET used_at_ms = ? WHERE id = ?').run(now, enrollmentId)
      const hostItemId = this.resolveItem(device.hostType, device.hostId)
      const active = this.core.database.query(`
        SELECT a.id, alias.legacy_id
        FROM agents a
        JOIN agent_identity_aliases alias ON alias.agent_id = a.id
        JOIN agent_host_bindings binding ON binding.agent_id = a.id
        WHERE binding.host_item_id = ? AND binding.state = 'active' AND a.revoked_at_ms IS NULL
      `).all(hostItemId) as Row[]
      for (const existing of active) {
        revokedDeviceIds.push(existing.legacy_id)
        this.core.database.query('UPDATE agents SET revoked_at_ms = ? WHERE id = ?').run(now, existing.id)
        this.core.database.query("UPDATE agent_host_bindings SET state = 'replaced', unbound_at_ms = ? WHERE agent_id = ? AND state = 'active'").run(now, existing.id)
      }
      const inserted = this.core.database.query(`
        INSERT INTO agents (
          public_key, protocol_major, agent_version, capabilities_json,
          last_sequence, last_seen_at_ms, revoked_at_ms, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?) RETURNING id
      `).get(
        device.publicKey,
        device.protocolMajor,
        device.agentVersion ?? device.version,
        JSON.stringify(device.capabilities ?? {}),
        device.lastSequence ?? 0,
        device.lastSeenAt ? toMilliseconds(device.lastSeenAt, now) : null,
        now,
      ) as { id: number }
      this.core.database.query('INSERT INTO agent_identity_aliases (agent_id, legacy_id, created_at_ms) VALUES (?, ?, ?)').run(inserted.id, publicId, now)
      this.core.database.query("INSERT INTO agent_host_bindings (agent_id, host_item_id, state, bound_at_ms, unbound_at_ms) VALUES (?, ?, 'active', ?, NULL)").run(inserted.id, hostItemId, now)
      state.devices[String(publicId)] = created
      persistAgentExtendedState(this.core.database, state, status, this.now())
    }).immediate()
    return { device: structuredClone(created), revokedDeviceIds }
  }

  recordAgentHeartbeat({ deviceId, host, sequence, status }: { deviceId: number; host: Row; sequence?: number; status: Row }) {
    const state = projectAgentState(this.core.database) as Row
    const statuses = projectAgentStatusState(this.core.database) as Row
    const device = state.devices?.[String(deviceId)]
    if (!device || device.revokedAt) throw lifecycleError('Agent device is not active.', 'agent-device-unavailable', 409)
    if (device.hostType !== host.hostType || device.hostId !== host.hostId) {
      throw lifecycleError('Agent device does not belong to this host.', 'agent-device-host-mismatch', 409)
    }
    this.core.database.transaction(() => {
      const canonicalId = this.resolveAgent(deviceId)
      if (sequence !== undefined) device.lastSequence = sequence
      device.lastSeenAt = status.lastSeenAt
      device.agentVersion = status.agentVersion
      device.version = status.agentVersion
      if (status.capabilities !== undefined) device.capabilities = structuredClone(status.capabilities)
      this.core.database.query(`
        UPDATE agents SET last_sequence = ?, last_seen_at_ms = ?, agent_version = ?,
          capabilities_json = ? WHERE id = ?
      `).run(
        device.lastSequence ?? 0,
        toMilliseconds(status.lastSeenAt, this.now()),
        device.agentVersion,
        JSON.stringify(device.capabilities ?? {}),
        canonicalId,
      )
      statuses.hosts ??= {}
      statuses.hosts[`${host.hostType}:${host.hostId}`] = { hostType: host.hostType, hostId: host.hostId, ...structuredClone(status) }
      persistAgentExtendedState(this.core.database, state, statuses, this.now())
    }).immediate()
    return { device: structuredClone(device), status: structuredClone(statuses.hosts[`${host.hostType}:${host.hostId}`]) }
  }

  async saveAgentHardwareSnapshot(input: Row) {
    const state = projectAgentState(this.core.database) as Row
    const statuses = projectAgentStatusState(this.core.database) as Row
    const device = state.devices?.[String(input.deviceId)]
    if (!device || device.revokedAt) throw new Error('Agent device is not active.')
    if (device.hostType !== input.hostType || device.hostId !== input.hostId || device.protocolMajor !== input.protocolMajor) {
      throw new Error('Agent device does not belong to this hardware snapshot host.')
    }
    const snapshots = state.hardwareSnapshots ?? {}
    const events = state.hardwareEvents ?? {}
    const previous = Object.values(snapshots).find((record: any) => record.hostType === input.hostType && record.hostId === input.hostId) as Row | undefined
    const snapshotId = previous?.id ?? Math.max(0, ...Object.values(snapshots).map((record: any) => record.id)) + 1
    const snapshot = {
      id: snapshotId,
      deviceId: input.deviceId,
      hostType: input.hostType,
      hostId: input.hostId,
      protocolMajor: input.protocolMajor,
      collectedAt: input.collectedAt,
      receivedAt: input.receivedAt,
      host: structuredClone(input.host),
      components: structuredClone(input.components),
    }
    this.core.database.transaction(() => {
      snapshots[String(snapshotId)] = snapshot
      if (previous) {
        const eventId = Math.max(0, ...Object.values(events).map((record: any) => record.id)) + 1
        events[String(eventId)] = {
          id: eventId,
          snapshotId,
          deviceId: input.deviceId,
          hostType: input.hostType,
          hostId: input.hostId,
          componentCountBefore: previous.components.length,
          componentCountAfter: input.components.length,
          changedKinds: [],
          createdAt: input.receivedAt,
        }
      }
      state.hardwareSnapshots = snapshots
      state.hardwareEvents = events
      const canonicalAgentId = this.resolveAgent(input.deviceId)
      const hostItemId = this.resolveItem(input.hostType, input.hostId)
      this.core.database.query(`
        INSERT INTO agent_hardware_snapshots (
          agent_id, host_item_id, sequence, payload_json, collected_at_ms, received_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(canonicalAgentId, hostItemId, input.sequence, JSON.stringify(snapshot), toMilliseconds(input.collectedAt, this.now()), toMilliseconds(input.receivedAt, this.now()))
      this.core.database.query('UPDATE agents SET last_sequence = ? WHERE id = ?').run(input.sequence, canonicalAgentId)
      persistAgentExtendedState(this.core.database, state, statuses, this.now())
    }).immediate()
    return structuredClone(snapshot)
  }

  getAgentHardwareContext(hostType: string, hostId: number) {
    const state = projectAgentState(this.core.database) as Row
    const snapshot = Object.values(state.hardwareSnapshots ?? {}).find((record: any) => record.hostType === hostType && record.hostId === hostId) ?? null
    const project = this.getProject()
    const inventory = Object.fromEntries(Object.values(LEGACY_TABLE_BY_TYPE).map((table) => [table, []])) as Row
    for (const item of Object.values(project.items)) inventory[LEGACY_TABLE_BY_TYPE[item.type as InventoryType]].push(structuredClone(item))
    return { snapshot: snapshot ? structuredClone(snapshot) : null, inventory, project: structuredClone(project) }
  }

  revokeAgentRegistration(hostType: string, hostId: number) {
    const state = projectAgentState(this.core.database) as Row
    const statuses = projectAgentStatusState(this.core.database) as Row
    const revokedAt = new Date(this.now()).toISOString()
    const revokedDeviceIds: number[] = []
    let revoked = 0
    this.core.database.transaction(() => {
      for (const enrollment of Object.values(state.enrollments ?? {}) as Row[]) {
        if (enrollment.hostType !== hostType || enrollment.hostId !== hostId || enrollment.revokedAt) continue
        enrollment.revokedAt = revokedAt
        this.core.database.query('UPDATE agent_enrollment_codes SET revoked_at_ms = ? WHERE id = ?').run(this.now(), enrollment.id)
        revoked += 1
      }
      for (const device of Object.values(state.devices ?? {}) as Row[]) {
        if (device.hostType !== hostType || device.hostId !== hostId || device.revokedAt) continue
        device.revokedAt = revokedAt
        const canonicalId = this.resolveAgent(device.id)
        this.core.database.query('UPDATE agents SET revoked_at_ms = ? WHERE id = ?').run(this.now(), canonicalId)
        this.core.database.query("UPDATE agent_host_bindings SET state = 'revoked', unbound_at_ms = ? WHERE agent_id = ? AND state = 'active'").run(this.now(), canonicalId)
        revokedDeviceIds.push(device.id)
        revoked += 1
      }
      persistAgentExtendedState(this.core.database, state, statuses, this.now())
    }).immediate()
    return { revoked, revokedAt, revokedDeviceIds }
  }

  hasActiveAgentRegistration(hostType: string, hostId: number, { pendingEnrollmentsOnly = false } = {}) {
    const state = projectAgentState(this.core.database) as Row
    const activeEnrollment = Object.values(state.enrollments ?? {}).some((record: any) => record.hostType === hostType && record.hostId === hostId && !record.revokedAt && (!pendingEnrollmentsOnly || !record.usedAt) && (!record.expiresAt || Date.parse(record.expiresAt) > Date.now()))
    const activeDevice = Object.values(state.devices ?? {}).some((record: any) => record.hostType === hostType && record.hostId === hostId && !record.revokedAt)
    return activeEnrollment || activeDevice
  }

  clearAgentRuntimeData(hostType: string, hostId: number) {
    const state = projectAgentState(this.core.database) as Row
    const statuses = projectAgentStatusState(this.core.database) as Row
    delete statuses.hosts?.[`${hostType}:${hostId}`]
    const snapshotIds = new Set<number>()
    for (const [key, snapshot] of Object.entries(state.hardwareSnapshots ?? {}) as Array<[string, Row]>) {
      if (snapshot.hostType === hostType && snapshot.hostId === hostId) {
        snapshotIds.add(snapshot.id)
        delete state.hardwareSnapshots[key]
      }
    }
    for (const [key, event] of Object.entries(state.hardwareEvents ?? {}) as Array<[string, Row]>) {
      if ((event.hostType === hostType && event.hostId === hostId) || snapshotIds.has(event.snapshotId)) delete state.hardwareEvents[key]
    }
    this.core.database.transaction(() => {
      const itemId = this.resolveItem(hostType, hostId)
      this.core.database.query('DELETE FROM agent_hardware_snapshots WHERE host_item_id = ?').run(itemId)
      persistAgentExtendedState(this.core.database, state, statuses, this.now())
    }).immediate()
    return this.getAgentStatusSummary()
  }

  getAgentStatusSummary({ heartbeatIntervalSeconds = DEFAULT_AGENT_HEARTBEAT_INTERVAL_SECONDS, now = Date.now() }: Row = {}) {
    const timing = agentStatusTiming(heartbeatIntervalSeconds)
    const devices = (projectAgentState(this.core.database) as Row).devices ?? {}
    const statuses = (projectAgentStatusState(this.core.database) as Row).hosts ?? {}
    const hosts = Object.fromEntries(Object.entries(statuses).map(([hostKey, raw]) => {
      const status = raw as Row
      const connected = Object.values(devices).some((device: any) => device.hostType === status.hostType && device.hostId === status.hostId && !device.revokedAt)
      const { state, ageMs } = resolveAgentStatusState({ connected, lastSeenAt: status.lastSeenAt, now, timing })
      return [hostKey, { ...status, state, ageMs, connected }]
    }))
    const registeredHosts = [...new Map(Object.values(devices).filter((device: any) => !device.revokedAt).map((device: any) => [`${device.hostType}:${device.hostId}`, { hostType: device.hostType, hostId: device.hostId }])).values()]
    return {
      hosts,
      registeredHosts,
      servers: Object.fromEntries(Object.values(hosts).filter((status: any) => status.hostType === 'server').map((status: any) => [String(status.hostId), { ...status, serverId: status.hostId }])),
      registeredServerIds: registeredHosts.filter((host: any) => host.hostType === 'server').map((host: any) => host.hostId),
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
        updatedAt: cache.updatedAt ?? new Date(now).toISOString(),
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

    this.invalidateProjectReadModels()

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

  async snapshotStores(storeNames?: string[]) {
    await this.flush()
    const applicationMeta = this.applicationMeta()
    const snapshot = buildLogicalStoreSnapshot({
      database: this.core.database,
      meta: {
        ...applicationMeta,
        schemaVersion: 29,
        databaseSchemas: {
          core: databaseStatus(this.core).schemaVersion,
          telemetry: null,
          catalog: null,
        },
      },
      inventory: buildLegacyInventoryProjection(this.core.database),
      project: this.getProject(),
      routingCache: this.getRoutingCache(),
      registry: this.getRegistryState(),
      agents: projectAgentState(this.core.database),
      agentStatus: projectAgentStatusState(this.core.database),
      authentication: this.getAuthenticationState(),
      backupManagement: this.getBackupManagementState(),
    })
    if (storeNames === undefined) return snapshot
    const supported = new Set(Object.keys(snapshot))
    if (storeNames.some((storeName) => !supported.has(storeName))) {
      throw new Error('Backup snapshot references an unknown store.')
    }
    return Object.fromEntries(storeNames.map((storeName) => [storeName, structuredClone(snapshot[storeName as keyof typeof snapshot])]))
  }

  async replaceStoresAtomically(replacements: Row) {
    const currentStores = await this.snapshotStores()
    const supported = new Set(Object.keys(currentStores))
    const names = Object.keys(replacements)
    if (names.length === 0) return currentStores
    if (names.some((storeName) => !supported.has(storeName))) {
      throw new Error('Restore references an unknown store.')
    }
    await stageAndActivateSqliteRestore({
      active: this.core,
      replacements,
      currentStores,
      projectId: this.projectId,
      workspaceId: this.workspaceId,
      appVersion: this.appVersion,
      dataDir: this.dataDir,
      now: this.now,
    })
    this.rebindRepositories()
    this.cache.clear()
    return this.snapshotStores(names)
  }

  close() {
    this.projectCommitListeners.clear()
    this.cache.clear()
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
      const deleted = this.core.database.query(
        'DELETE FROM project_connections WHERE project_id = ? AND id = ? RETURNING id',
      ).all(this.projectId, connectionId)
      if (deleted.length !== 1) {
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
        const deleted = this.core.database.query(
          'DELETE FROM component_assignments WHERE project_id = ? AND id = ? RETURNING id',
        ).all(this.projectId, positiveId(assignmentId, 'Assignment ID'))
        if (deleted.length !== 1) {
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
    this.invalidateProjectReadModels()
    const event: ProjectCommitEvent = { type: 'canonical-invalidated', baseRevision, revision }
    for (const listener of this.projectCommitListeners) listener(event)
  }

  private commitCanonicalMutationAcrossProjects(
    operation: () => void,
    projectIds: number[],
    expectedRevisions: Map<number, number>,
  ) {
    const ids = [...new Set(projectIds)].sort((left, right) => left - right)
    if (ids.length === 0) throw lifecycleError('Registry update has no active project scope.', 'registry-update-project-scope-missing', 409)
    const revisions = new Map<number, number>()
    for (const projectId of ids) {
      const row = this.core.database.query('SELECT revision FROM projects WHERE id = ? AND archived_at_ms IS NULL').get(projectId) as Row | null
      if (!row) throw lifecycleError(`Active project ${projectId} was not found.`, 'project-not-found', 404)
      const expected = expectedRevisions.get(projectId)
      if (expected !== undefined && row.revision !== expected) {
        throw lifecycleError('Project changed while evaluating registry updates.', 'revision-conflict', 409)
      }
      revisions.set(projectId, row.revision)
    }
    const now = this.now()
    this.core.database.transaction(() => {
      operation()
      for (const [projectId, revision] of revisions) {
        const result = this.core.database.query(`
          UPDATE projects SET revision = ?, updated_at_ms = ?
          WHERE id = ? AND revision = ? AND archived_at_ms IS NULL
        `).run(revision + 1, now, projectId, revision)
        if (result.changes !== 1) {
          throw lifecycleError('Project changed while applying registry updates.', 'revision-conflict', 409)
        }
      }
    }).immediate()
    for (const projectId of ids) this.invalidateProjectReadModels(projectId)
    const currentRevision = revisions.get(this.projectId)
    if (currentRevision !== undefined) {
      const event: ProjectCommitEvent = {
        type: 'canonical-invalidated',
        baseRevision: currentRevision,
        revision: currentRevision + 1,
      }
      for (const listener of this.projectCommitListeners) listener(event)
    }
    return Object.fromEntries([...revisions].map(([projectId, revision]) => [projectId, revision + 1]))
  }

  private invalidateProjectReadModels(projectId = this.projectId, workspaceId?: number) {
    this.cache.invalidateTags([
      `project:${projectId}`,
      `workspace:${workspaceId ?? this.workspaceId}`,
    ])
  }

  private resolveItem(type: string, legacyId: number) {
    const row = this.core.database.query(`
      SELECT item_id FROM inventory_identity_aliases
      WHERE legacy_type_key = ? AND legacy_id = ?
    `).get(type, positiveId(legacyId, 'Inventory item ID')) as { item_id: number } | null
    if (!row) throw lifecycleError(`Inventory item ${type}:${legacyId} does not exist.`, 'invalid-engine-patch', 500)
    return row.item_id
  }

  private resolveAgent(legacyId: number) {
    const row = this.core.database.query(
      'SELECT agent_id FROM agent_identity_aliases WHERE legacy_id = ?',
    ).get(positiveId(legacyId, 'Agent device ID')) as { agent_id: number } | null
    if (!row) throw lifecycleError(`Agent device ${legacyId} does not exist.`, 'agent-device-unavailable', 409)
    return row.agent_id
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
