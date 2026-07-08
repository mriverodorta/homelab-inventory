import fs from 'node:fs/promises'
import path from 'node:path'
import { Low } from 'lowdb'
import { assertInventoryStoreShape, assertProjectShape, assertProjectStoreShape } from './validation.mjs'

export const CURRENT_SCHEMA_VERSION = 3

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
  project = normalizeLegacyProjectIds(project)
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
    throw new Error('Inventory item payload must be an object.')
  }

  const type = String(input.type ?? '').trim()
  const table = TABLE_BY_TYPE[type]

  if (!table) {
    throw new Error('Inventory item type is not supported.')
  }

  const name = String(input.name ?? '').trim()

  if (!name) {
    throw new Error('Inventory item name is required.')
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
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true })
    await fs.mkdir(this.storesDir, { recursive: true })
    await this.ensureStores()
    await this.openStores()
    await this.runMigrations()
    await this.validateStores()
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

    if (this.legacyProjectPath && await pathExists(this.legacyProjectPath)) {
      const legacyProject = await readJson(this.legacyProjectPath)
      const split = splitProject(legacyProject)

      await writeJson(this.paths.meta, {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        appLastOpenedWith: this.appVersion,
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

      throw new Error(`No migration registered for schema version ${currentVersion}.`)
    }

    this.databases.meta.data.updatedAt = new Date().toISOString()
    await this.flush(['meta', 'inventory', 'project', 'agents', 'agentStatus'])
  }

  async validateStores() {
    assertInventoryStoreShape(this.databases.inventory.data)
    assertProjectStoreShape(this.databases.project.data)
    assertProjectShape(this.getProject())
    this.databases.agents.data.enrollments ??= {}
    this.databases.agents.data.devices ??= {}
    this.databases.agentStatus.data.servers ??= {}
  }

  async markAppOpened() {
    this.databases.meta.data.appLastOpenedWith = this.appVersion
    this.databases.meta.data.updatedAt = new Date().toISOString()
    this.scheduleFlush('meta')
  }

  getProject() {
    return composeProject(
      this.databases.meta.data,
      this.databases.inventory.data,
      this.databases.project.data,
    )
  }

  setProject(project) {
    assertProjectShape(project)

    const split = splitProject({
      ...project,
      id: 'default',
      connections: project.connections ?? [],
    })
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

  addInventoryItem(input) {
    const type = String(input?.type ?? '').trim()
    const table = TABLE_BY_TYPE[type]

    if (!table) {
      throw new Error('Inventory item type is not supported.')
    }

    const records = this.databases.inventory.data[table]
    const id = nextInventoryId(records)
    const { item } = normalizeInventoryItemInput(input, id)
    const record = cleanItemForStore(item)

    this.databases.inventory.data[table] = [...records, record]
      .sort((first, second) => Number(first.id) - Number(second.id))
    this.databases.meta.data.updatedAt = new Date().toISOString()

    assertInventoryStoreShape(this.databases.inventory.data)
    assertProjectShape(this.getProject())

    this.scheduleFlush('meta')
    this.scheduleFlush('inventory')

    return this.getProject()
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
