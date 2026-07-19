import fs from 'node:fs/promises'
import path from 'node:path'
import { Low } from 'lowdb'
import { normalizeNetworkProject, recalculateNegotiatedSpeeds } from '../../src/lib/negotiated-speed.ts'
import { getReleaseNotesBetween } from '../../src/release-notes.ts'
import {
  normalizeCompatibilityProject,
  planHostAllocations,
} from '../../shared/compatibility/index.mjs'
import {
  analyzeInventoryDependencies,
  assertDependencyFree,
  buildDuplicateRecord,
  InventoryLifecycleError,
  normalizeInventoryRef,
  referencedPortIds,
  resolveInventoryRef,
} from './inventory-lifecycle.mjs'
import {
  assertInventoryStoreShape,
  assertLegacyProjectShape,
  assertProjectShape,
  assertProjectStoreShape,
} from './validation.mjs'

export const CURRENT_SCHEMA_VERSION = 7

const DEFAULT_SAVE_DEBOUNCE_MS = 500
const BACKUP_LIMIT = 10
const STORE_NAMES = ['meta', 'inventory', 'project', 'agents', 'agentStatus']
const TABLE_BY_TYPE = {
  server: 'servers',
  cpu: 'cpus',
  ram: 'ram',
  storage: 'storage',
  network: 'networkCards',
  gpu: 'gpus',
  nas: 'nas',
  switch: 'switches',
  patchPanel: 'patchPanels',
}
const TYPE_BY_TABLE = Object.fromEntries(Object.entries(TABLE_BY_TYPE).map(([type, table]) => [table, type]))
const INVENTORY_TABLES = [
  'servers',
  'cpus',
  'ram',
  'storage',
  'networkCards',
  'gpus',
  'nas',
  'switches',
  'patchPanels',
]

function timestampForPath() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`)
}

class JsonFileAdapter {
  constructor(filePath) {
    this.filePath = filePath
  }

  async read() {
    try {
      return await readJson(this.filePath)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return null
      }

      throw error
    }
  }

  async write(payload) {
    await writeJson(this.filePath, payload)
  }
}

function createProjectStoreFromProject(project) {
  return {
    id: project.id ?? 'default',
    metadata: {
      name: project.metadata?.name ?? 'Homelab Inventory',
      version: project.metadata?.version ?? 1,
      updatedAt: project.metadata?.updatedAt ?? new Date().toISOString(),
    },
    placements: (project.placements ?? []).map(persistPlacement),
    assignments: (project.assignments ?? []).map(persistAssignment),
    connections: (project.connections ?? []).map(persistConnection),
  }
}

function splitProject(project) {
  assertLegacyProjectShape(project)
  project = normalizeLegacyProjectIds(project)
  assertProjectShape(project)
  project = normalizeCompatibilityProject(project)
  assertProjectShape(project)

  return {
    inventory: inventoryTablesFromItems(project.items ?? {}),
    project: createProjectStoreFromProject(project),
  }
}

function normalizeLegacyProjectIds(project) {
  const originalItems = project.items ?? {}
  const nextIdsByType = Object.fromEntries(Object.keys(TABLE_BY_TYPE).map((type) => [type, 0]))
  const itemIdMap = new Map()
  const items = {}

  for (const [originalKey, item] of Object.entries(originalItems)) {
    const parsed = parseItemKey(originalKey) ?? parseItemKey(item.key)
    const type = parsed?.type ?? item.type

    if (!TABLE_BY_TYPE[type]) {
      continue
    }

    let id = parsed?.id

    if (!Number.isInteger(id)) {
      const numericId = typeof item.id === 'number'
        ? item.id
        : Number(item.id)

      id = Number.isInteger(numericId) ? numericId : nextIdsByType[type] + 1
    }

    nextIdsByType[type] = Math.max(nextIdsByType[type], id)

    const key = itemKey(type, id)
    itemIdMap.set(originalKey, key)
    itemIdMap.set(item.id, key)

    items[key] = {
      ...item,
      id,
      type,
      key,
    }
  }

  function mapItemId(value) {
    return itemIdMap.get(value) ?? value
  }

  return {
    ...project,
    items,
    placements: (project.placements ?? []).map((placement) => ({
      ...placement,
      serverId: mapItemId(placement.serverId),
    })),
    assignments: (project.assignments ?? []).map((assignment, index) => ({
      ...assignment,
      id: Number.isInteger(Number(assignment.id)) ? Number(assignment.id) : index + 1,
      serverId: mapItemId(assignment.serverId),
      itemId: mapItemId(assignment.itemId),
    })),
    connections: (project.connections ?? []).map((connection, index) => ({
      ...connection,
      id: Number.isInteger(Number(connection.id)) ? Number(connection.id) : index + 1,
      from: {
        ...connection.from,
        itemId: mapItemId(connection.from.itemId),
        ...(connection.from.hostedItemId ? { hostedItemId: mapItemId(connection.from.hostedItemId) } : {}),
      },
      to: {
        ...connection.to,
        itemId: mapItemId(connection.to.itemId),
        ...(connection.to.hostedItemId ? { hostedItemId: mapItemId(connection.to.hostedItemId) } : {}),
      },
    })),
  }
}

function composeProject(meta, inventory, project) {
  const items = runtimeItemsFromInventoryStore(inventory)

  return {
    id: project.id ?? 'default',
    metadata: {
      ...project.metadata,
      name: project.metadata?.name ?? 'Homelab Inventory',
      version: project.metadata?.version ?? 1,
      schemaVersion: meta.schemaVersion,
      updatedAt: project.metadata?.updatedAt ?? meta.updatedAt ?? new Date().toISOString(),
    },
    items,
    placements: (project.placements ?? []).map(runtimePlacement),
    assignments: (project.assignments ?? []).map(runtimeAssignment),
    connections: (project.connections ?? []).map(runtimeConnection),
  }
}

function itemKey(type, id) {
  return `${type}:${id}`
}

function compatibilityFindingIdentity(result, finding) {
  return JSON.stringify([
    String(result.hostId),
    String(result.assignmentId),
    String(result.itemId),
    finding.code,
    finding.field ?? '',
    finding.resourceId ?? '',
    finding.message ?? '',
  ])
}

function parseItemKey(key) {
  if (typeof key !== 'string') {
    return null
  }

  const [type, rawId] = key.split(':')
  const id = Number(rawId)

  if (!TABLE_BY_TYPE[type] || !Number.isInteger(id)) {
    return null
  }

  return { type, id }
}

function numericServerId(value) {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value
  }

  if (typeof value !== 'string') {
    return value
  }

  const parsed = parseItemKey(value)
  const numeric = parsed?.type === 'server' ? parsed.id : Number(value)

  return Number.isInteger(numeric) ? numeric : value
}

function normalizeAgentsStore(agents) {
  return {
    enrollments: Object.fromEntries(
      Object.entries(agents?.enrollments ?? {}).map(([id, enrollment]) => [
        id,
        {
          ...enrollment,
          serverId: numericServerId(enrollment.serverId),
        },
      ]),
    ),
    devices: Object.fromEntries(
      Object.entries(agents?.devices ?? {}).map(([id, device]) => [
        id,
        {
          ...device,
          serverId: numericServerId(device.serverId),
        },
      ]),
    ),
  }
}

function normalizeAgentStatusStore(agentStatus) {
  return {
    servers: Object.fromEntries(
      Object.entries(agentStatus?.servers ?? {}).map(([serverId, status]) => {
        const nextServerId = numericServerId(status.serverId ?? serverId)

        return [
          String(nextServerId),
          {
            ...status,
            serverId: nextServerId,
          },
        ]
      }),
    ),
  }
}

function runtimeItemsFromInventoryStore(inventory) {
  if (inventory?.items && typeof inventory.items === 'object' && !Array.isArray(inventory.items)) {
    return Object.fromEntries(
      Object.values(inventory.items).map((item) => {
        const key = item.key ?? (typeof item.id === 'string' && item.id.includes(':')
          ? item.id
          : itemKey(item.type, item.id))
        const parsed = parseItemKey(key)

        return [
          key,
          {
            ...item,
            id: parsed?.id ?? item.id,
            key,
          },
        ]
      }),
    )
  }

  const items = {}

  for (const table of INVENTORY_TABLES) {
    const type = TYPE_BY_TABLE[table]
    const records = Array.isArray(inventory?.[table]) ? inventory[table] : []

    for (const record of records) {
      const key = itemKey(type, record.id)
      items[key] = {
        ...record,
        type,
        key,
      }
    }
  }

  return items
}

function cleanItemForStore(item) {
  const record = { ...item }

  delete record.key
  delete record.type

  return record
}

function cleanPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const entries = Object.entries(value)
    .map(([key, rawValue]) => {
      if (typeof rawValue === 'string') {
        const trimmed = rawValue.trim()
        return trimmed === '' ? null : [key, trimmed]
      }

      if (rawValue === undefined || rawValue === null || rawValue === '') {
        return null
      }

      return [key, rawValue]
    })
    .filter(Boolean)

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function normalizeInventoryPort(port, index, fallbackKind) {
  if (!port || typeof port !== 'object' || Array.isArray(port)) {
    return null
  }

  const slotNumber = Number(port.slotNumber ?? index + 1)
  const id = Number(port.id ?? slotNumber)

  if (!Number.isInteger(slotNumber) || !Number.isInteger(id)) {
    return null
  }

  const normalized = {
    id,
    kind: port.kind ?? fallbackKind,
    type: port.type,
    slotNumber,
  }

  if (typeof port.label === 'string') {
    normalized.label = port.label.trim()
  }

  if (typeof port.notes === 'string' && port.notes.trim() !== '') {
    normalized.notes = port.notes.trim()
  }

  if (typeof port.role === 'string' && port.role.trim() !== '') {
    normalized.role = port.role.trim()
  }

  if (typeof port.speed === 'string' && port.speed.trim() !== '') {
    normalized.speed = port.speed.trim()
  }

  if (typeof port.poe === 'boolean') {
    normalized.poe = port.poe
  }

  if (Array.isArray(port.endpoints)) {
    normalized.endpoints = port.endpoints
      .map((endpoint, endpointIndex) => {
        if (!endpoint || typeof endpoint !== 'object' || Array.isArray(endpoint)) {
          return null
        }

        return {
          id: Number(endpoint.id ?? endpointIndex + 1),
          side: endpoint.side,
        }
      })
      .filter(Boolean)
  }

  return normalized
}

function normalizeInventoryItemInput(input, id) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new InventoryLifecycleError('Inventory item payload must be an object.', {
      code: 'invalid-inventory-item',
      status: 400,
    })
  }

  const type = String(input.type ?? '').trim()
  const table = TABLE_BY_TYPE[type]

  if (!table) {
    throw new InventoryLifecycleError('Inventory item type is not supported.', {
      code: 'unsupported-inventory-type',
      status: 400,
    })
  }

  const name = String(input.name ?? '').trim()

  if (!name) {
    throw new InventoryLifecycleError('Inventory item name is required.', {
      code: 'invalid-inventory-item',
      status: 400,
    })
  }

  const item = {
    id,
    type,
    name,
  }

  for (const field of ['subtype', 'manufacturer', 'secondaryManufacturer', 'family', 'model', 'number', 'notes']) {
    if (typeof input[field] === 'string' && input[field].trim() !== '') {
      item[field] = input[field].trim()
    }
  }

  const specs = cleanPlainObject(input.specs)
  const properties = cleanPlainObject(input.properties)

  if (specs) {
    item.specs = specs
  }

  if (properties) {
    item.properties = properties
  }

  if (input.compatibility && typeof input.compatibility === 'object' && !Array.isArray(input.compatibility)) {
    item.compatibility = structuredClone(input.compatibility)
  }

  if (Array.isArray(input.ports)) {
    const fallbackKind = type === 'switch'
      ? 'switch-port'
      : type === 'patchPanel'
        ? 'keystone'
        : 'server-port'
    const ports = input.ports
      .map((port, index) => normalizeInventoryPort(port, index, fallbackKind))
      .filter(Boolean)

    if (ports.length > 0) {
      item.ports = ports
    }
  }

  return { item, table }
}

function nextInventoryId(records) {
  return records.reduce((maxId, record) => {
    const id = Number(record?.id)
    return Number.isInteger(id) ? Math.max(maxId, id) : maxId
  }, 0) + 1
}

function inventoryTablesFromItems(items) {
  const tables = Object.fromEntries(INVENTORY_TABLES.map((table) => [table, []]))

  for (const [key, item] of Object.entries(items)) {
    const parsed = parseItemKey(key) ?? parseItemKey(item.key) ?? {
      type: item.type,
      id: typeof item.id === 'number' ? item.id : Number(String(item.id).split(':').pop()),
    }
    const table = TABLE_BY_TYPE[parsed.type]

    if (!table) {
      continue
    }

    tables[table].push({
      ...cleanItemForStore(item),
      id: parsed.id,
    })
  }

  for (const table of INVENTORY_TABLES) {
    tables[table].sort((first, second) => Number(first.id) - Number(second.id))
  }

  return tables
}

function persistPlacement(placement) {
  if ('itemType' in placement && 'itemId' in placement) {
    return placement
  }

  const parsed = parseItemKey(placement.serverId)

  return {
    itemType: parsed?.type ?? 'server',
    itemId: parsed?.id ?? placement.serverId,
    x: placement.x,
    y: placement.y,
  }
}

function runtimePlacement(placement) {
  if (placement.serverId) {
    return placement
  }

  return {
    serverId: itemKey(placement.itemType, placement.itemId),
    x: placement.x,
    y: placement.y,
  }
}

function persistAssignment(assignment) {
  if ('hostType' in assignment && 'hostId' in assignment) {
    return assignment
  }

  const host = parseItemKey(assignment.serverId)
  const item = parseItemKey(assignment.itemId)

  return {
    id: Number(assignment.id),
    hostType: host?.type ?? 'server',
    hostId: host?.id ?? assignment.serverId,
    itemType: item?.type ?? assignment.type,
    itemId: item?.id ?? assignment.itemId,
    type: assignment.type,
    assignedAt: assignment.assignedAt,
    ...(assignment.allocation ? { allocation: structuredClone(assignment.allocation) } : {}),
  }
}

function runtimeAssignment(assignment) {
  if (assignment.serverId && assignment.itemId) {
    return assignment
  }

  return {
    id: assignment.id,
    serverId: itemKey(assignment.hostType, assignment.hostId),
    itemId: itemKey(assignment.itemType, assignment.itemId),
    type: assignment.type,
    assignedAt: assignment.assignedAt,
    ...(assignment.allocation ? { allocation: structuredClone(assignment.allocation) } : {}),
  }
}

function persistEndpoint(endpoint) {
  if ('itemType' in endpoint && 'itemId' in endpoint) {
    return endpoint
  }

  const item = parseItemKey(endpoint.itemId)
  const hostedItem = endpoint.hostedItemId ? parseItemKey(endpoint.hostedItemId) : null
  const legacyPortId = String(endpoint.portId)
  const [legacyHostedItemKey, legacyHostedPortId] = legacyPortId.includes('::')
    ? legacyPortId.split('::')
    : [null, null]
  const legacyHostedItem = legacyHostedItemKey ? parseItemKey(legacyHostedItemKey) : null

  return {
    itemType: item?.type,
    itemId: item?.id ?? endpoint.itemId,
    ...(hostedItem || legacyHostedItem
      ? {
          hostedItemType: (hostedItem ?? legacyHostedItem).type,
          hostedItemId: (hostedItem ?? legacyHostedItem).id,
        }
      : {}),
    portId: Number(legacyHostedPortId ?? endpoint.portId),
    ...(endpoint.endpointId !== undefined ? { endpointId: Number(endpoint.endpointId) } : {}),
  }
}

function runtimeEndpoint(endpoint) {
  if (endpoint.itemId && typeof endpoint.itemId === 'string' && endpoint.itemId.includes(':')) {
    return endpoint
  }

  return {
    itemId: itemKey(endpoint.itemType, endpoint.itemId),
    ...(endpoint.hostedItemType && endpoint.hostedItemId !== undefined
      ? { hostedItemId: itemKey(endpoint.hostedItemType, endpoint.hostedItemId) }
      : {}),
    portId: endpoint.portId,
    ...(endpoint.endpointId !== undefined ? { endpointId: endpoint.endpointId } : {}),
  }
}

function persistConnection(connection) {
  return {
    ...connection,
    id: Number(connection.id),
    from: persistEndpoint(connection.from),
    to: persistEndpoint(connection.to),
  }
}

function runtimeConnection(connection) {
  return {
    ...connection,
    from: runtimeEndpoint(connection.from),
    to: runtimeEndpoint(connection.to),
  }
}

async function copyDirectory(source, destination) {
  if (!(await pathExists(source))) {
    return
  }

  await fs.mkdir(destination, { recursive: true })
  const entries = await fs.readdir(source, { withFileTypes: true })

  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name)
    const destinationPath = path.join(destination, entry.name)

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath)
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, destinationPath)
    }
  }
}

export class HomelabInventoryStore {
  constructor({
    appVersion,
    dataDir,
    legacyProjectPath,
    saveDebounceMs = DEFAULT_SAVE_DEBOUNCE_MS,
    seedEmptyData = true,
    seedDir,
  }) {
    this.appVersion = appVersion
    this.dataDir = dataDir
    this.legacyProjectPath = legacyProjectPath
    this.saveDebounceMs = saveDebounceMs
    this.seedEmptyData = seedEmptyData
    this.seedDir = seedDir
    this.backupDir = path.join(dataDir, 'backups')
    this.storesDir = path.join(dataDir, 'stores')
    this.paths = {
      meta: path.join(dataDir, 'meta.json'),
      inventory: path.join(dataDir, 'stores', 'inventory.json'),
      project: path.join(dataDir, 'stores', 'project.json'),
      agents: path.join(dataDir, 'stores', 'agents.json'),
      agentStatus: path.join(dataDir, 'stores', 'agent-status.json'),
    }
    this.databases = {}
    this.dirtyStores = new Set()
    this.flushTimer = null
    this.flushPromise = null
    this.createdStores = false
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true })
    await fs.mkdir(this.storesDir, { recursive: true })
    await this.ensureStores()
    await this.openStores()
    await this.runMigrations()
    await this.validateStores()
    await this.normalizeLoadedCompatibility()
    await this.validateStores()
    this.initializeReleaseNotesMetadata()
    await this.markAppOpened()
  }

  async ensureStores() {
    const hasModernStores = await pathExists(this.paths.meta)
      && await pathExists(this.paths.inventory)
      && await pathExists(this.paths.project)

    if (hasModernStores) {
      await this.ensureOptionalStoreFiles()
      return
    }

    this.createdStores = true

    if (this.legacyProjectPath && await pathExists(this.legacyProjectPath)) {
      const legacyProject = await readJson(this.legacyProjectPath)
      assertLegacyProjectShape(legacyProject)
      const split = splitProject(normalizeNetworkProject(legacyProject))

      await writeJson(this.paths.meta, {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        appLastOpenedWith: this.appVersion,
        lastSeenReleaseNotesVersion: this.appVersion,
        skippedUpdateVersion: null,
        lastUpdateCheck: null,
        updatedAt: new Date().toISOString(),
      })
      await writeJson(this.paths.inventory, split.inventory)
      await writeJson(this.paths.project, split.project)
      await this.ensureOptionalStoreFiles()
      return
    }

    if (this.seedEmptyData) {
      await fs.copyFile(path.join(this.seedDir, 'meta.json'), this.paths.meta)
      await fs.copyFile(path.join(this.seedDir, 'inventory.json'), this.paths.inventory)
      await fs.copyFile(path.join(this.seedDir, 'project.json'), this.paths.project)
      await this.ensureOptionalStoreFiles()
      return
    }

    await this.writeEmptyStores()
    await this.ensureOptionalStoreFiles()
  }

  async writeEmptyStores() {
    const now = new Date().toISOString()

    await writeJson(this.paths.meta, {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      appLastOpenedWith: this.appVersion,
      lastSeenReleaseNotesVersion: this.appVersion,
      skippedUpdateVersion: null,
      lastUpdateCheck: null,
      updatedAt: now,
    })
    await writeJson(this.paths.inventory, Object.fromEntries(INVENTORY_TABLES.map((table) => [table, []])))
    await writeJson(this.paths.project, {
      id: 'default',
      metadata: {
        name: 'Homelab Inventory',
        version: 1,
        updatedAt: now,
      },
      placements: [],
      assignments: [],
      connections: [],
    })
  }

  async ensureOptionalStoreFiles() {
    if (!(await pathExists(this.paths.agents))) {
      await writeJson(this.paths.agents, {
        enrollments: {},
        devices: {},
      })
    }

    if (!(await pathExists(this.paths.agentStatus))) {
      await writeJson(this.paths.agentStatus, {
        servers: {},
      })
    }
  }

  async openStores() {
    this.databases.meta = new Low(new JsonFileAdapter(this.paths.meta), {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      appLastOpenedWith: this.appVersion,
      lastSeenReleaseNotesVersion: this.appVersion,
      skippedUpdateVersion: null,
      lastUpdateCheck: null,
      updatedAt: new Date().toISOString(),
    })
    this.databases.inventory = new Low(
      new JsonFileAdapter(this.paths.inventory),
      Object.fromEntries(INVENTORY_TABLES.map((table) => [table, []])),
    )
    this.databases.project = new Low(new JsonFileAdapter(this.paths.project), {
      id: 'default',
      metadata: {
        name: 'Homelab Inventory',
        version: 1,
        updatedAt: new Date().toISOString(),
      },
      placements: [],
      assignments: [],
      connections: [],
    })
    this.databases.agents = new Low(new JsonFileAdapter(this.paths.agents), {
      enrollments: {},
      devices: {},
    })
    this.databases.agentStatus = new Low(new JsonFileAdapter(this.paths.agentStatus), {
      servers: {},
    })

    await Promise.all(STORE_NAMES.map((name) => this.databases[name].read()))
  }

  async runMigrations() {
    const schemaVersion = Number(this.databases.meta.data.schemaVersion ?? 0)

    if (schemaVersion > CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `Database schema ${schemaVersion} is newer than this app supports (${CURRENT_SCHEMA_VERSION}).`,
      )
    }

    if (schemaVersion === CURRENT_SCHEMA_VERSION) {
      return
    }

    await this.createBackup(`schema-${schemaVersion}-to-${CURRENT_SCHEMA_VERSION}`)

    let currentVersion = schemaVersion

    while (currentVersion < CURRENT_SCHEMA_VERSION) {
      if (currentVersion === 0) {
        this.databases.meta.data.schemaVersion = 1
        currentVersion = 1
        continue
      }

      if (currentVersion === 1) {
        this.databases.agents.data ??= {
          enrollments: {},
          devices: {},
        }
        this.databases.agentStatus.data ??= {
          servers: {},
        }
        this.databases.meta.data.schemaVersion = 2
        currentVersion = 2
        continue
      }

      if (currentVersion === 2) {
        const composedProject = composeProject(
          this.databases.meta.data,
          this.databases.inventory.data,
          this.databases.project.data,
        )
        const split = splitProject(composedProject)

        this.databases.inventory.data = split.inventory
        this.databases.project.data = split.project
        this.databases.agents.data = normalizeAgentsStore(this.databases.agents.data)
        this.databases.agentStatus.data = normalizeAgentStatusStore(this.databases.agentStatus.data)
        this.databases.meta.data.schemaVersion = 3
        currentVersion = 3
        continue
      }

      if (currentVersion === 3) {
        const composedProject = composeProject(
          this.databases.meta.data,
          this.databases.inventory.data,
          this.databases.project.data,
        )
        const split = splitProject(recalculateNegotiatedSpeeds(composedProject))

        this.databases.inventory.data = split.inventory
        this.databases.project.data = split.project
        this.databases.meta.data.schemaVersion = 4
        currentVersion = 4
        continue
      }

      if (currentVersion === 4) {
        const composedProject = composeProject(
          this.databases.meta.data,
          this.databases.inventory.data,
          this.databases.project.data,
        )
        const split = splitProject(normalizeNetworkProject(composedProject))

        this.databases.inventory.data = split.inventory
        this.databases.project.data = split.project
        this.databases.meta.data.schemaVersion = 5
        currentVersion = 5
        continue
      }

      if (currentVersion === 5) {
        this.databases.meta.data.schemaVersion = 6
        currentVersion = 6
        continue
      }

      if (currentVersion === 6) {
        const composedProject = composeProject(
          this.databases.meta.data,
          this.databases.inventory.data,
          this.databases.project.data,
        )
        const split = splitProject(composedProject)

        this.databases.inventory.data = split.inventory
        this.databases.project.data = split.project
        this.databases.meta.data.schemaVersion = 7
        currentVersion = 7
        continue
      }

      throw new Error(`No migration registered for schema version ${currentVersion}.`)
    }

    this.databases.meta.data.updatedAt = new Date().toISOString()
    await this.flush(['meta', 'inventory', 'project', 'agents', 'agentStatus'])
  }

  async validateStores() {
    assertInventoryStoreShape(this.databases.inventory.data)
    assertProjectStoreShape(this.databases.project.data)
    assertProjectShape(this.getProject())
    this.databases.meta.data.skippedUpdateVersion ??= null
    this.databases.meta.data.lastUpdateCheck ??= null
    this.databases.agents.data.enrollments ??= {}
    this.databases.agents.data.devices ??= {}
    this.databases.agentStatus.data.servers ??= {}
  }

  async normalizeLoadedCompatibility() {
    const split = splitProject(this.getProject())
    const inventoryChanged = JSON.stringify(split.inventory) !== JSON.stringify(this.databases.inventory.data)
    const projectChanged = JSON.stringify(split.project) !== JSON.stringify(this.databases.project.data)

    if (inventoryChanged) this.databases.inventory.data = split.inventory
    if (projectChanged) this.databases.project.data = split.project
    if (inventoryChanged || projectChanged) {
      await this.flush([
        ...(inventoryChanged ? ['inventory'] : []),
        ...(projectChanged ? ['project'] : []),
      ])
    }
  }

  initializeReleaseNotesMetadata() {
    if (this.createdStores) {
      this.databases.meta.data.lastSeenReleaseNotesVersion = this.appVersion
      this.scheduleFlush('meta')
      return
    }

    if (this.databases.meta.data.lastSeenReleaseNotesVersion) {
      return
    }

    this.databases.meta.data.lastSeenReleaseNotesVersion = this.databases.meta.data.appLastOpenedWith ?? this.appVersion
    this.scheduleFlush('meta')
  }

  async markAppOpened() {
    this.databases.meta.data.appLastOpenedWith = this.appVersion
    this.databases.meta.data.updatedAt = new Date().toISOString()
    this.scheduleFlush('meta')
  }

  getReleaseNotesStatus(releaseNotes) {
    const lastSeenVersion = this.databases.meta.data.lastSeenReleaseNotesVersion ?? this.appVersion
    const entries = getReleaseNotesBetween(releaseNotes, lastSeenVersion, this.appVersion)

    return {
      currentVersion: this.appVersion,
      lastSeenVersion,
      hasUnseen: entries.length > 0,
      entries,
    }
  }

  async acknowledgeReleaseNotes() {
    this.databases.meta.data.lastSeenReleaseNotesVersion = this.appVersion
    this.databases.meta.data.updatedAt = new Date().toISOString()
    await this.flush(['meta'])

    return {
      currentVersion: this.appVersion,
      lastSeenVersion: this.appVersion,
      hasUnseen: false,
      entries: [],
    }
  }

  getUpdateMetadata() {
    return {
      skippedUpdateVersion: this.databases.meta.data.skippedUpdateVersion ?? null,
      lastUpdateCheck: this.databases.meta.data.lastUpdateCheck
        ? structuredClone(this.databases.meta.data.lastUpdateCheck)
        : null,
    }
  }

  isUpdateVersionSkipped(version) {
    return this.databases.meta.data.skippedUpdateVersion === version
  }

  async saveUpdateCheck(result) {
    this.databases.meta.data.lastUpdateCheck = structuredClone(result)
    this.databases.meta.data.updatedAt = new Date().toISOString()
    await this.flush(['meta'])
  }

  async skipUpdateVersion(version) {
    this.databases.meta.data.skippedUpdateVersion = version
    this.databases.meta.data.updatedAt = new Date().toISOString()
    await this.flush(['meta'])
  }

  async clearSkippedUpdateVersion() {
    this.databases.meta.data.skippedUpdateVersion = null
    this.databases.meta.data.updatedAt = new Date().toISOString()
    await this.flush(['meta'])
  }

  getProject() {
    return composeProject(
      this.databases.meta.data,
      this.databases.inventory.data,
      this.databases.project.data,
    )
  }

  setProject(project) {
    const submittedProject = {
      ...project,
      id: 'default',
      connections: project.connections ?? [],
    }

    assertProjectShape(submittedProject)
    const canonicalProject = normalizeLegacyProjectIds(submittedProject)
    assertProjectShape(canonicalProject)
    this.assertAssignmentTransitions(this.getProject(), canonicalProject)
    const normalizedProject = normalizeNetworkProject(canonicalProject)
    const split = splitProject(normalizedProject)
    const updatedAt = new Date().toISOString()

    this.databases.inventory.data = split.inventory
    this.databases.project.data = {
      ...split.project,
      id: 'default',
      metadata: {
        ...split.project.metadata,
        name: split.project.metadata?.name ?? 'Homelab Inventory',
        version: split.project.metadata?.version ?? 1,
        updatedAt,
      },
      connections: split.project.connections ?? [],
    }
    this.databases.meta.data.updatedAt = updatedAt

    this.scheduleFlush('meta')
    this.scheduleFlush('inventory')
    this.scheduleFlush('project')

    return this.getProject()
  }

  assertAssignmentTransitions(currentProject, submittedProject) {
    const currentById = new Map(
      (currentProject.assignments ?? []).map((assignment) => [String(assignment.id), assignment]),
    )
    const enforcedIds = new Set()
    const affectedHosts = new Set()

    for (const assignment of submittedProject.assignments ?? []) {
      const previous = currentById.get(String(assignment.id))
      if (
        !previous ||
        String(previous.serverId) !== String(assignment.serverId) ||
        String(previous.itemId) !== String(assignment.itemId) ||
        previous.type !== assignment.type
      ) {
        enforcedIds.add(String(assignment.id))
        affectedHosts.add(String(assignment.serverId))
        if (previous) affectedHosts.add(String(previous.serverId))
      }
    }

    if (enforcedIds.size === 0) return

    const baseline = new Set()
    for (const hostId of affectedHosts) {
      for (const result of planHostAllocations(currentProject, hostId).results) {
        for (const finding of result.findings?.filter((entry) => entry.severity === 'error') ?? []) {
          baseline.add(compatibilityFindingIdentity(result, finding))
        }
      }
    }

    for (const hostId of affectedHosts) {
      for (const result of planHostAllocations(submittedProject, hostId).results) {
        const errors = result.findings?.filter((finding) => finding.severity === 'error') ?? []
        for (const finding of errors) {
          const isEnforced = enforcedIds.has(String(result.assignmentId))
          const isNewHostFailure = !baseline.has(compatibilityFindingIdentity(result, finding))
          if (isEnforced || isNewHostFailure) {
            throw new InventoryLifecycleError(`[${finding.code}] ${finding.message}`, {
              code: 'hardware-incompatible',
              status: 409,
              details: {
                assignmentId: result.assignmentId,
                hostId: result.hostId,
                itemId: result.itemId,
                finding,
              },
            })
          }
        }
      }
    }
  }

  inventoryTransaction(mutator) {
    const draft = {
      meta: structuredClone(this.databases.meta.data),
      inventory: structuredClone(this.databases.inventory.data),
      project: structuredClone(this.databases.project.data),
      agents: structuredClone(this.databases.agents.data),
      agentStatus: structuredClone(this.databases.agentStatus.data),
    }
    mutator(draft)
    const updatedAt = new Date().toISOString()

    draft.meta.updatedAt = updatedAt

    try {
      const split = splitProject(composeProject(draft.meta, draft.inventory, draft.project))
      draft.inventory = split.inventory
      draft.project = split.project
      assertInventoryStoreShape(draft.inventory)
      assertProjectStoreShape(draft.project)
      assertProjectShape(composeProject(draft.meta, draft.inventory, draft.project))
    } catch (error) {
      throw new InventoryLifecycleError(error instanceof Error ? error.message : 'Inventory change is invalid.', {
        code: 'invalid-inventory-change',
        status: 400,
      })
    }

    this.databases.meta.data = draft.meta
    this.databases.inventory.data = draft.inventory
    this.databases.project.data = draft.project
    this.scheduleFlush('meta')
    this.scheduleFlush('inventory')
    this.scheduleFlush('project')

    return composeProject(draft.meta, draft.inventory, draft.project)
  }

  dependencyContext(draft = null) {
    return {
      inventory: draft?.inventory ?? this.databases.inventory.data,
      project: draft?.project ?? this.databases.project.data,
      agents: draft?.agents ?? this.databases.agents.data,
      agentStatus: draft?.agentStatus ?? this.databases.agentStatus.data,
    }
  }

  getInventoryDependencies(ref) {
    return analyzeInventoryDependencies(this.dependencyContext(), normalizeInventoryRef(ref))
  }

  getInventoryDependencyReports(refs) {
    return this.normalizeInventoryRefs(refs).map((ref) => this.getInventoryDependencies(ref))
  }

  normalizeInventoryRefs(refs) {
    if (!Array.isArray(refs) || refs.length === 0) {
      throw new InventoryLifecycleError('At least one inventory item is required.', {
        code: 'empty-inventory-selection',
        status: 400,
      })
    }

    const unique = new Map()
    for (const rawRef of refs) {
      const ref = normalizeInventoryRef(rawRef)
      unique.set(`${ref.type}:${ref.id}`, ref)
    }
    return [...unique.values()]
  }

  createInventoryItems(input, quantity = 1) {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new InventoryLifecycleError('Quantity must be an integer between 1 and 100.', {
        code: 'invalid-quantity',
        status: 400,
      })
    }

    const type = String(input?.type ?? '').trim()
    const table = TABLE_BY_TYPE[type]

    if (!table) {
      throw new InventoryLifecycleError('Inventory item type is not supported.', {
        code: 'unsupported-inventory-type',
        status: 400,
      })
    }

    return this.inventoryTransaction((draft) => {
      const records = draft.inventory[table]
      const startingId = nextInventoryId(records)
      const created = []
      const namingRecords = [...records]

      for (let index = 0; index < quantity; index += 1) {
        const id = startingId + index
        const name = quantity > 1 && ['server', 'nas', 'switch', 'patchPanel'].includes(type)
          ? (() => {
              const source = { ...input, id, type }
              return buildDuplicateRecord({ source, type, nextId: id, existingRecords: namingRecords }).name
            })()
          : input.name
        const { item } = normalizeInventoryItemInput({ ...input, name }, id)
        const record = cleanItemForStore(item)
        created.push(record)
        namingRecords.push(record)
      }

      draft.inventory[table] = [...records, ...created]
        .sort((first, second) => Number(first.id) - Number(second.id))
      return created.map((record) => ({ type, id: record.id, name: record.name }))
    })
  }

  addInventoryItem(input) {
    return this.createInventoryItems(input, 1)
  }

  updateInventoryItem(rawRef, input) {
    const ref = normalizeInventoryRef(rawRef)

    return this.inventoryTransaction((draft) => {
      const resolved = resolveInventoryRef(draft.inventory, ref)

      if (resolved.item.archivedAt) {
        throw new InventoryLifecycleError('Restore the item before editing it.', {
          code: 'inventory-item-archived',
          status: 409,
        })
      }

      const { item } = normalizeInventoryItemInput({ ...input, type: ref.type }, ref.id)
      const record = cleanItemForStore(item)
      const connectedPortIds = referencedPortIds(draft.project, ref)

      for (const portId of connectedPortIds) {
        const previousPort = resolved.item.ports?.find((port) => Number(port.id) === portId)
        const nextPort = record.ports?.find((port) => Number(port.id) === portId)

        if (
          !previousPort ||
          !nextPort ||
          previousPort.kind !== nextPort.kind ||
          previousPort.type !== nextPort.type ||
          previousPort.speed !== nextPort.speed ||
          JSON.stringify(previousPort.endpoints ?? []) !== JSON.stringify(nextPort.endpoints ?? [])
        ) {
          throw new InventoryLifecycleError(`Connected port ${portId} cannot be removed or materially changed.`, {
            code: 'connected-port-change',
            status: 409,
            details: { portId },
          })
        }
      }

      draft.inventory[resolved.table][resolved.index] = record
      return { type: ref.type, id: ref.id, name: record.name }
    })
  }

  duplicateInventoryItem(rawRef, quantity = 1) {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new InventoryLifecycleError('Quantity must be an integer between 1 and 100.', {
        code: 'invalid-quantity',
        status: 400,
      })
    }

    const ref = normalizeInventoryRef(rawRef)

    return this.inventoryTransaction((draft) => {
      const resolved = resolveInventoryRef(draft.inventory, ref)

      if (resolved.item.archivedAt) {
        throw new InventoryLifecycleError('Restore the item before duplicating it.', {
          code: 'inventory-item-archived',
          status: 409,
        })
      }

      const created = []
      const records = draft.inventory[resolved.table]
      let nextId = nextInventoryId(records)
      const namingRecords = [...records]

      for (let index = 0; index < quantity; index += 1) {
        const record = buildDuplicateRecord({
          source: resolved.item,
          type: ref.type,
          nextId,
          existingRecords: namingRecords,
        })
        created.push(record)
        namingRecords.push(record)
        nextId += 1
      }

      draft.inventory[resolved.table] = [...records, ...created]
        .sort((first, second) => Number(first.id) - Number(second.id))
      return created.map((record) => ({ type: ref.type, id: record.id, name: record.name }))
    })
  }

  archiveInventoryItems(rawRefs) {
    const refs = this.normalizeInventoryRefs(rawRefs)

    return this.inventoryTransaction((draft) => {
      const context = this.dependencyContext(draft)
      const reports = refs.map((ref) => analyzeInventoryDependencies(context, ref))
      assertDependencyFree(reports, 'archive')
      const archivedAt = new Date().toISOString()

      for (const ref of refs) {
        const resolved = resolveInventoryRef(draft.inventory, ref)
        resolved.item.archivedAt = archivedAt
      }

      return { items: refs, archivedAt }
    })
  }

  restoreInventoryItems(rawRefs) {
    const refs = this.normalizeInventoryRefs(rawRefs)

    return this.inventoryTransaction((draft) => {
      for (const ref of refs) {
        const resolved = resolveInventoryRef(draft.inventory, ref)
        delete resolved.item.archivedAt
      }
      return { items: refs }
    })
  }

  deleteInventoryItems(rawRefs) {
    const refs = this.normalizeInventoryRefs(rawRefs)

    return this.inventoryTransaction((draft) => {
      const activeItems = refs
        .map((ref) => resolveInventoryRef(draft.inventory, ref))
        .filter((resolved) => !resolved.item.archivedAt)

      if (activeItems.length > 0) {
        throw new InventoryLifecycleError('Archive inventory items before deleting them.', {
          code: 'inventory-item-not-archived',
          status: 409,
          details: {
            items: activeItems.map(({ type, id, item }) => ({ type, id, name: item.name })),
          },
        })
      }

      const context = this.dependencyContext(draft)
      const reports = refs.map((ref) => analyzeInventoryDependencies(context, ref))
      assertDependencyFree(reports, 'delete')

      for (const ref of refs) {
        const resolved = resolveInventoryRef(draft.inventory, ref)
        draft.inventory[resolved.table].splice(resolved.index, 1)
      }

      return { items: refs }
    })
  }

  clearAgentRuntimeData(serverId) {
    const id = Number(serverId)
    if (!Number.isInteger(id)) throw new Error('Server id must be numeric.')

    delete this.databases.agentStatus.data.servers[String(id)]
    delete this.databases.agentStatus.data.servers[id]
    this.scheduleFlush('agentStatus')
    return this.getAgentStatusSummary()
  }

  getAgentStatusSummary() {
    const now = Date.now()
    const devices = this.databases.agents.data.devices ?? {}
    const statuses = this.databases.agentStatus.data.servers ?? {}

    return {
      servers: Object.fromEntries(
        Object.entries(statuses).map(([serverId, status]) => {
          const lastSeenAt = status.lastSeenAt
          const ageMs = typeof lastSeenAt === 'string' ? now - Date.parse(lastSeenAt) : null
          const connected = Object.values(devices).some(
            (device) => String(device.serverId) === String(status.serverId ?? serverId) && !device.revokedAt,
          )
          const state = !connected
            ? 'unregistered'
            : ageMs === null
              ? 'unknown'
              : ageMs <= 90_000
                ? 'online'
                : ageMs <= 300_000
                  ? 'stale'
                  : 'offline'

          return [
            serverId,
            {
              ...status,
              state,
              ageMs,
              connected,
            },
          ]
        }),
      ),
      registeredServerIds: [
        ...new Set(
          Object.values(devices)
            .filter((device) => !device.revokedAt)
            .map((device) => device.serverId),
        ),
      ],
    }
  }

  scheduleFlush(storeName) {
    this.dirtyStores.add(storeName)

    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flush()
    }, this.saveDebounceMs)
  }

  async flush(storeNames = [...this.dirtyStores]) {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }

    for (const storeName of storeNames) {
      this.dirtyStores.add(storeName)
    }

    if (this.flushPromise) {
      await this.flushPromise
    }

    const storesToFlush = [...this.dirtyStores]
    this.dirtyStores.clear()

    if (storesToFlush.length === 0) {
      return
    }

    this.flushPromise = Promise.all(storesToFlush.map((storeName) => this.databases[storeName].write()))
      .finally(() => {
        this.flushPromise = null
      })

    await this.flushPromise
  }

  async createBackup(reason = 'manual') {
    const backupPath = path.join(this.backupDir, `${timestampForPath()}-${reason}`)

    await fs.mkdir(backupPath, { recursive: true })

    for (const [storeName, filePath] of Object.entries(this.paths)) {
      if (await pathExists(filePath)) {
        await fs.copyFile(filePath, path.join(backupPath, `${storeName}.json`))
      }
    }

    await copyDirectory(this.storesDir, path.join(backupPath, 'stores'))
    await this.pruneBackups()

    return backupPath
  }

  async pruneBackups() {
    const entries = await fs.readdir(this.backupDir, { withFileTypes: true }).catch(() => [])
    const backups = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()

    await Promise.all(
      backups.slice(0, Math.max(0, backups.length - BACKUP_LIMIT)).map((name) =>
        fs.rm(path.join(this.backupDir, name), { recursive: true, force: true }),
      ),
    )
  }
}
