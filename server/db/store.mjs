import fs from 'node:fs/promises'
import path from 'node:path'
import { Low } from 'lowdb'
import { normalizeNetworkProject, recalculateNegotiatedSpeeds } from './legacy-network-normalization.ts'
import { getReleaseNotesBetween } from '../../src/release-notes.ts'
import {
  isHostCompatibilityEnabled,
  normalizeCompatibilityPolicy,
  normalizeCompatibilityProject,
  normalizeProjectCompatibilityPolicy,
  planHostAllocations,
} from '../../shared/compatibility/index.mjs'
import { withCanonicalPowerPorts } from '../../shared/power-ports.mjs'
import { createEngineSnapshot } from '../engine/snapshot.mjs'
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
  assertAgentsStoreShape,
  assertAgentStatusStoreShape,
  assertInventoryStoreShape,
  assertLegacyProjectShape,
  assertProjectShape,
  assertProjectStoreShape,
} from './validation.mjs'
import { assertRelationalId, isRelationalId, parseLegacyRelationalId } from './relational-ids.mjs'
import { migrateSchema9To10 } from './migrate-schema-10.mjs'
import { migrateSchema10To11 } from './migrate-schema-11.mjs'
import { migrateSchema11To12 } from './migrate-schema-12.mjs'
import { migrateSchema12To13 } from './migrate-schema-13.mjs'
import {
  applyNasPowerConfigurationChange,
  inspectNasPowerConfigurationChange,
} from './nas-power-configuration.mjs'

export const CURRENT_SCHEMA_VERSION = 13

const DEFAULT_SAVE_DEBOUNCE_MS = 500
const BACKUP_LIMIT = 10
const STORE_NAMES = ['meta', 'inventory', 'project', 'agents', 'agentStatus']
const ALWAYS_ENFORCED_COMPATIBILITY_CODES = new Set([
  'compatibility.resource.exhausted',
  'memory.slots.exceeded',
])
const TABLE_BY_TYPE = {
  server: 'servers',
  pcBuild: 'pcBuilds',
  cpu: 'cpus',
  ram: 'ram',
  storage: 'storage',
  network: 'networkCards',
  gpu: 'gpus',
  motherboard: 'motherboards',
  cpuCooler: 'cpuCoolers',
  case: 'cases',
  powerSupply: 'powerSupplies',
  soundCard: 'soundCards',
  wireless: 'wirelessCards',
  powerAdapter: 'powerAdapters',
  nas: 'nas',
  switch: 'switches',
  patchPanel: 'patchPanels',
  monitor: 'monitors',
  ups: 'upsSystems',
  powerStrip: 'powerStrips',
}
const TYPE_BY_TABLE = Object.fromEntries(Object.entries(TABLE_BY_TYPE).map(([type, table]) => [table, type]))
const INVENTORY_TABLES = [
  'servers',
  'pcBuilds',
  'cpus',
  'ram',
  'storage',
  'networkCards',
  'gpus',
  'motherboards',
  'cpuCoolers',
  'cases',
  'powerSupplies',
  'soundCards',
  'wirelessCards',
  'powerAdapters',
  'nas',
  'switches',
  'patchPanels',
  'monitors',
  'upsSystems',
  'powerStrips',
]

function isExplicitWirelessNetworkRecord(record) {
  const subtype = String(record?.subtype ?? '').trim().toLowerCase()
  if (subtype === 'wireless' || subtype === 'wifi') {
    return true
  }

  if (record?.specs?.wireless === true) {
    return true
  }

  const networkInterface = String(record?.specs?.interface ?? '').trim().toLowerCase()
  return /m\.2.*(?:a\s*\+\s*e|a\s*\/\s*e)/.test(networkInterface)
}

function migrateInventoryToSchema9(inventory) {
  const migrated = inventory && typeof inventory === 'object' && !Array.isArray(inventory)
    ? inventory
    : {}

  for (const table of INVENTORY_TABLES) {
    migrated[table] ??= []
  }

  const wirelessCards = [...migrated.wirelessCards]
  const networkCards = []
  const migratedWirelessIds = new Set()

  for (const record of migrated.networkCards) {
    if (isExplicitWirelessNetworkRecord(record)) {
      wirelessCards.push(record)
      migratedWirelessIds.add(Number(record.id))
    } else {
      networkCards.push(record)
    }
  }

  migrated.networkCards = networkCards
  migrated.wirelessCards = wirelessCards

  return { inventory: migrated, migratedWirelessIds }
}

function migrateWirelessProjectReferences(project, migratedWirelessIds) {
  const isMigratedWirelessId = (value) => migratedWirelessIds.has(Number(value))
  const migrateEndpoint = (endpoint) => {
    if (!endpoint || typeof endpoint !== 'object') {
      return endpoint
    }

    return {
      ...endpoint,
      ...(endpoint.itemType === 'network' && isMigratedWirelessId(endpoint.itemId)
        ? { itemType: 'wireless' }
        : {}),
      ...(endpoint.hostedItemType === 'network' && isMigratedWirelessId(endpoint.hostedItemId)
        ? { hostedItemType: 'wireless' }
        : {}),
    }
  }

  return {
    ...project,
    assignments: (project?.assignments ?? []).map((assignment) => (
      assignment.itemType === 'network' && isMigratedWirelessId(assignment.itemId)
        ? { ...assignment, itemType: 'wireless', type: 'wireless' }
        : assignment
    )),
    connections: (project?.connections ?? []).map((connection) => ({
      ...connection,
      from: migrateEndpoint(connection.from),
      to: migrateEndpoint(connection.to),
    })),
  }
}

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
    revision: project.revision ?? 1,
    metadata: {
      name: project.metadata?.name ?? 'Homelab Inventory',
      version: project.metadata?.version ?? 1,
      updatedAt: project.metadata?.updatedAt ?? new Date().toISOString(),
    },
    placements: (project.placements ?? []).map(persistPlacement),
    assignments: (project.assignments ?? []).map(persistAssignment),
    connections: (project.connections ?? []).map(persistConnection),
    compatibilityPolicy: normalizeCompatibilityPolicy(project.compatibilityPolicy),
  }
}

function splitCurrentProject(project) {
  assertProjectShape(project)
  project = normalizeProjectCompatibilityPolicy(project)
  assertProjectShape(project)
  project = normalizeCompatibilityProject(project)
  assertProjectShape(project)

  return {
    inventory: inventoryTablesFromItems(project.items ?? {}),
    project: createProjectStoreFromProject(project),
  }
}

function splitLegacyProject(project) {
  assertLegacyProjectShape(project)
  return splitCurrentProject(normalizeLegacyProjectIds(project))
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
    revision: project.revision ?? 1,
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
    compatibilityPolicy: normalizeCompatibilityPolicy(project.compatibilityPolicy),
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

function shouldEnforceCompatibilityFinding(project, result, finding) {
  return (
    isHostCompatibilityEnabled(project, result.hostId) ||
    ALWAYS_ENFORCED_COMPATIBILITY_CODES.has(finding.code)
  )
}

function parseItemKey(key) {
  if (typeof key !== 'string') {
    return null
  }

  const [type, rawId] = key.split(':')
  if (!/^[1-9]\d*$/.test(rawId ?? '')) return null
  const id = Number(rawId)

  if (!TABLE_BY_TYPE[type] || !Number.isSafeInteger(id)) {
    return null
  }

  return { type, id }
}

function migrateLegacyServerId(value, field) {
  const parsed = parseItemKey(value)
  if (parsed?.type === 'server') return parsed.id
  return parseLegacyRelationalId(value, field)
}

function normalizeAgentsStore(agents) {
  return {
    enrollments: Object.fromEntries(
      Object.entries(agents?.enrollments ?? {}).map(([id, enrollment]) => [
        id,
        {
          ...enrollment,
          serverId: migrateLegacyServerId(enrollment.serverId, `agents.enrollments.${id}.serverId`),
        },
      ]),
    ),
    devices: Object.fromEntries(
      Object.entries(agents?.devices ?? {}).map(([id, device]) => [
        id,
        {
          ...device,
          serverId: migrateLegacyServerId(device.serverId, `agents.devices.${id}.serverId`),
        },
      ]),
    ),
  }
}

function normalizeAgentStatusStore(agentStatus) {
  return {
    servers: Object.fromEntries(
      Object.entries(agentStatus?.servers ?? {}).map(([serverId, status]) => {
        const nextServerId = migrateLegacyServerId(
          status.serverId ?? serverId,
          `agentStatus.servers.${serverId}.serverId`,
        )

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
    throw new InventoryLifecycleError(`ports[${index}] must be an object.`, {
      code: 'invalid-inventory-port',
      status: 400,
    })
  }

  const slotNumber = port.slotNumber ?? index + 1
  const id = port.id ?? slotNumber

  if (!isRelationalId(slotNumber) || !isRelationalId(id)) {
    throw new InventoryLifecycleError(
      `ports[${index}] id and slotNumber must be positive safe-integer relational IDs.`,
      { code: 'invalid-inventory-port', status: 400 },
    )
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
    normalized.endpoints = port.endpoints.map((endpoint, endpointIndex) => {
        if (!endpoint || typeof endpoint !== 'object' || Array.isArray(endpoint)) {
          throw new InventoryLifecycleError(
            `ports[${index}].endpoints[${endpointIndex}] must be an object.`,
            { code: 'invalid-inventory-port', status: 400 },
          )
        }

        const endpointId = endpoint.id ?? endpointIndex + 1
        if (!isRelationalId(endpointId)) {
          throw new InventoryLifecycleError(
            `ports[${index}].endpoints[${endpointIndex}].id must be a positive safe-integer relational ID.`,
            { code: 'invalid-inventory-port', status: 400 },
          )
        }

        return {
          id: endpointId,
          side: endpoint.side,
        }
      })
  }

  return normalized
}

function normalizeSmartPowerStripConfiguration(type, rawSmart, ports) {
  if (rawSmart === undefined) return undefined

  if (type !== 'powerStrip') {
    throw new InventoryLifecycleError('Smart configuration is supported only for power strips.', {
      code: 'invalid-smart-power-strip',
      status: 400,
    })
  }

  if (!rawSmart || typeof rawSmart !== 'object' || Array.isArray(rawSmart) || rawSmart.enabled !== true) {
    throw new InventoryLifecycleError('Smart power-strip configuration must be enabled explicitly.', {
      code: 'invalid-smart-power-strip',
      status: 400,
    })
  }

  const outletPortIds = new Set(
    (ports ?? []).filter((port) => port.type === 'ac-outlet').map((port) => port.id),
  )
  const outlets = []
  const seenPortIds = new Set()

  if (rawSmart.outlets !== undefined && !Array.isArray(rawSmart.outlets)) {
    throw new InventoryLifecycleError('Smart power-strip outlet names must be an array.', {
      code: 'invalid-smart-power-strip',
      status: 400,
    })
  }

  for (const [index, outlet] of (rawSmart.outlets ?? []).entries()) {
    if (!outlet || typeof outlet !== 'object' || Array.isArray(outlet)) {
      throw new InventoryLifecycleError(`smart.outlets[${index}] must be an object.`, {
        code: 'invalid-smart-power-strip',
        status: 400,
      })
    }
    if (!isRelationalId(outlet.portId) || !outletPortIds.has(outlet.portId)) {
      throw new InventoryLifecycleError(
        `smart.outlets[${index}].portId must reference an existing AC outlet port.`,
        { code: 'invalid-smart-power-strip', status: 400 },
      )
    }
    if (seenPortIds.has(outlet.portId)) {
      throw new InventoryLifecycleError(`smart.outlets[${index}].portId must be unique.`, {
        code: 'invalid-smart-power-strip',
        status: 400,
      })
    }
    seenPortIds.add(outlet.portId)
    const name = typeof outlet.name === 'string' ? outlet.name.trim() : ''
    if (name) outlets.push({ portId: outlet.portId, name })
  }

  const smart = { enabled: true, outlets }
  for (const field of ['displayName', 'managementIp', 'macAddress']) {
    const value = typeof rawSmart[field] === 'string' ? rawSmart[field].trim() : ''
    if (value) smart[field] = value
  }
  return smart
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

  const materialized = withCanonicalPowerPorts(item)
  const smart = normalizeSmartPowerStripConfiguration(type, input.smart, materialized.ports)
  if (smart) materialized.smart = smart

  return { item: materialized, table }
}

function nextInventoryId(records) {
  return records.reduce((maxId, record) => {
    const id = assertRelationalId(record?.id, 'inventory item.id')
    return Math.max(maxId, id)
  }, 0) + 1
}

function inventoryTablesFromItems(items) {
  const tables = Object.fromEntries(INVENTORY_TABLES.map((table) => [table, []]))

  for (const [key, item] of Object.entries(items)) {
    const parsed = parseItemKey(key) ?? parseItemKey(item.key) ?? (
      TABLE_BY_TYPE[item.type] && isRelationalId(item.id)
        ? { type: item.type, id: item.id }
        : null
    )
    if (!parsed) {
      throw new Error(`Runtime inventory item ${JSON.stringify(key)} has no valid typed relational identity.`)
    }
    const table = TABLE_BY_TYPE[parsed.type]

    if (!table) {
      throw new Error(`Runtime inventory item ${JSON.stringify(key)} has unsupported type ${parsed.type}.`)
    }

    tables[table].push({
      ...cleanItemForStore(item),
      id: parsed.id,
    })
  }

  for (const table of INVENTORY_TABLES) {
    tables[table].sort((first, second) => first.id - second.id)
  }

  return tables
}

function persistPlacement(placement) {
  if ('itemType' in placement && 'itemId' in placement) {
    return {
      ...placement,
      itemId: assertRelationalId(placement.itemId, 'placement.itemId'),
    }
  }

  const parsed = parseItemKey(placement.serverId)

  return {
    itemType: parsed?.type ?? 'server',
    itemId: assertRelationalId(parsed?.id, 'placement.itemId'),
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
    return {
      ...assignment,
      id: assertRelationalId(assignment.id, 'assignment.id'),
      hostId: assertRelationalId(assignment.hostId, 'assignment.hostId'),
      itemId: assertRelationalId(assignment.itemId, 'assignment.itemId'),
      ...(assignment.allocation
        ? {
            allocation: {
              ...structuredClone(assignment.allocation),
              ...(assignment.allocation.groupId !== undefined
                ? { groupId: assertRelationalId(assignment.allocation.groupId, 'assignment.allocation.groupId') }
                : {}),
            },
          }
        : {}),
    }
  }

  const host = parseItemKey(assignment.serverId)
  const item = parseItemKey(assignment.itemId)

  return {
    id: assertRelationalId(assignment.id, 'assignment.id'),
    hostType: host?.type ?? 'server',
    hostId: assertRelationalId(host?.id, 'assignment.hostId'),
    itemType: item?.type ?? assignment.type,
    itemId: assertRelationalId(item?.id, 'assignment.itemId'),
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
    return {
      ...endpoint,
      itemId: assertRelationalId(endpoint.itemId, 'connection endpoint.itemId'),
      portId: assertRelationalId(endpoint.portId, 'connection endpoint.portId'),
      ...(endpoint.hostedItemId !== undefined
        ? { hostedItemId: assertRelationalId(endpoint.hostedItemId, 'connection endpoint.hostedItemId') }
        : {}),
      ...(endpoint.endpointId !== undefined
        ? { endpointId: assertRelationalId(endpoint.endpointId, 'connection endpoint.endpointId') }
        : {}),
    }
  }

  const item = parseItemKey(endpoint.itemId)
  const hostedItem = endpoint.hostedItemId ? parseItemKey(endpoint.hostedItemId) : null
  const legacyPortId = typeof endpoint.portId === 'string' ? endpoint.portId : ''
  const [legacyHostedItemKey, legacyHostedPortId] = legacyPortId.includes('::')
    ? legacyPortId.split('::')
    : [null, null]
  const legacyHostedItem = legacyHostedItemKey ? parseItemKey(legacyHostedItemKey) : null

  return {
    itemType: item?.type,
    itemId: assertRelationalId(item?.id, 'connection endpoint.itemId'),
    ...(hostedItem || legacyHostedItem
      ? {
          hostedItemType: (hostedItem ?? legacyHostedItem).type,
          hostedItemId: (hostedItem ?? legacyHostedItem).id,
        }
      : {}),
    portId: legacyHostedPortId
      ? parseLegacyRelationalId(legacyHostedPortId, 'connection endpoint.portId')
      : assertRelationalId(endpoint.portId, 'connection endpoint.portId'),
    ...(endpoint.endpointId !== undefined
      ? { endpointId: assertRelationalId(endpoint.endpointId, 'connection endpoint.endpointId') }
      : {}),
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
    id: assertRelationalId(connection.id, 'connection.id'),
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

function persistedEndpointFromEngine(endpoint, label) {
  const itemType = endpoint?.item?.item_type
  const hostedItemType = endpoint?.hosted_item?.item_type
  if (!TABLE_BY_TYPE[itemType] || (hostedItemType !== undefined && hostedItemType !== null && !TABLE_BY_TYPE[hostedItemType])) {
    throw new InventoryLifecycleError(`${label} uses an unsupported inventory type.`, {
      code: 'invalid-engine-patch',
      status: 500,
    })
  }

  return {
    itemType,
    itemId: assertRelationalId(endpoint?.item?.id, `${label}.item.id`),
    portId: assertRelationalId(endpoint?.port_id, `${label}.port_id`),
    ...(endpoint?.endpoint_id === null || endpoint?.endpoint_id === undefined
      ? {}
      : { endpointId: assertRelationalId(endpoint.endpoint_id, `${label}.endpoint_id`) }),
    ...(endpoint?.hosted_item === null || endpoint?.hosted_item === undefined
      ? {}
      : {
          hostedItemType,
          hostedItemId: assertRelationalId(endpoint.hosted_item.id, `${label}.hosted_item.id`),
        }),
  }
}

function persistedPlacementFromEngine(placement, label) {
  const itemType = placement?.item?.item_type
  if (!TABLE_BY_TYPE[itemType]) {
    throw new InventoryLifecycleError(`${label} uses an unsupported inventory type.`, {
      code: 'invalid-engine-patch',
      status: 500,
    })
  }
  if (!Number.isFinite(placement?.x) || !Number.isFinite(placement?.y)) {
    throw new InventoryLifecycleError(`${label} uses invalid coordinates.`, {
      code: 'invalid-engine-patch',
      status: 500,
    })
  }
  return {
    itemType,
    itemId: assertRelationalId(placement.item.id, `${label}.item.id`),
    x: placement.x,
    y: placement.y,
  }
}

function persistedItemRefFromEngine(item, label) {
  if (!TABLE_BY_TYPE[item?.item_type]) {
    throw new InventoryLifecycleError(`${label} uses an unsupported inventory type.`, {
      code: 'invalid-engine-patch',
      status: 500,
    })
  }
  return {
    itemType: item.item_type,
    itemId: assertRelationalId(item.id, `${label}.id`),
  }
}

function placementRefKey(placement) {
  return `${placement.itemType}:${String(placement.itemId)}`
}

function placementPatchFromEngine(payload, label) {
  const upsert = (payload?.upsert ?? []).map((placement, index) => (
    persistedPlacementFromEngine(placement, `${label}.upsert[${String(index)}]`)
  ))
  const remove = (payload?.remove_items ?? []).map((item, index) => (
    persistedItemRefFromEngine(item, `${label}.remove_items[${String(index)}]`)
  ))
  const keys = [...upsert.map(placementRefKey), ...remove.map(placementRefKey)]
  if (keys.length === 0 || new Set(keys).size !== keys.length) {
    throw new InventoryLifecycleError(`${label} must contain unique placement changes.`, {
      code: 'invalid-engine-patch',
      status: 500,
    })
  }
  return { upsert, remove }
}

function persistedAssignmentFromEngine(assignment, label) {
  const hostType = assignment?.host?.item_type
  const itemType = assignment?.item?.item_type
  if (!TABLE_BY_TYPE[hostType] || !TABLE_BY_TYPE[itemType]) {
    throw new InventoryLifecycleError(`${label} uses an unsupported inventory type.`, {
      code: 'invalid-engine-patch',
      status: 500,
    })
  }
  if (assignment.component_type !== itemType) {
    throw new InventoryLifecycleError(`${label} component type does not match its item.`, {
      code: 'invalid-engine-patch',
      status: 500,
    })
  }
  if (typeof assignment.assigned_at !== 'string' || assignment.assigned_at.trim() === '') {
    throw new InventoryLifecycleError(`${label}.assigned_at must not be empty.`, {
      code: 'invalid-engine-patch',
      status: 500,
    })
  }

  let allocation
  if (assignment.allocation !== null && assignment.allocation !== undefined) {
    const resourceType = assignment.allocation.resource_type
    const positions = assignment.allocation.positions
    const groupId = assignment.allocation.group_id
    if (
      typeof resourceType !== 'string'
      || resourceType.trim() === ''
      || !Array.isArray(positions)
      || positions.some((position) => !Number.isSafeInteger(position) || position < 0)
      || new Set(positions).size !== positions.length
      || (groupId !== null && groupId !== undefined && (!Number.isSafeInteger(groupId) || groupId <= 0))
    ) {
      throw new InventoryLifecycleError(`${label}.allocation is invalid.`, {
        code: 'invalid-engine-patch',
        status: 500,
      })
    }
    allocation = {
      resourceType,
      ...(groupId === null || groupId === undefined ? {} : { groupId }),
      positions: [...positions],
    }
  }

  return {
    id: assertRelationalId(assignment.id, `${label}.id`),
    hostType,
    hostId: assertRelationalId(assignment.host.id, `${label}.host.id`),
    itemType,
    itemId: assertRelationalId(assignment.item.id, `${label}.item.id`),
    type: assignment.component_type,
    assignedAt: assignment.assigned_at,
    ...(allocation ? { allocation } : {}),
  }
}

function assignmentPatchFromEngine(payload, label) {
  const upsert = (payload?.upsert ?? []).map((assignment, index) => (
    persistedAssignmentFromEngine(assignment, `${label}.upsert[${String(index)}]`)
  ))
  const remove = (payload?.remove_assignment_ids ?? []).map((assignmentId, index) => (
    assertRelationalId(assignmentId, `${label}.remove_assignment_ids[${String(index)}]`)
  ))
  const ids = [...upsert.map((assignment) => assignment.id), ...remove]
  if (ids.length === 0 || new Set(ids).size !== ids.length) {
    throw new InventoryLifecycleError(`${label} must contain unique assignment changes.`, {
      code: 'invalid-engine-patch',
      status: 500,
    })
  }
  return { upsert, remove }
}

function assertPlacementInverseMatches(project, patch) {
  if (patch?.kind === 'batch') {
    for (const child of patch.payload?.patches ?? []) assertPlacementInverseMatches(project, child)
    return
  }
  if (patch?.kind !== 'patch-placements') return

  const inverse = placementPatchFromEngine(patch.payload, 'inverse placement patch')
  const current = new Map((project.placements ?? []).map((placement) => [placementRefKey(placement), placement]))
  for (const placement of inverse.upsert) {
    const existing = current.get(placementRefKey(placement))
    if (!existing || existing.x !== placement.x || existing.y !== placement.y) {
      throw new InventoryLifecycleError('Placement patch does not match current project coordinates.', {
        code: 'invalid-engine-patch',
        status: 409,
      })
    }
  }
  for (const item of inverse.remove) {
    if (current.has(placementRefKey(item))) {
      throw new InventoryLifecycleError('Placement patch expected an inventory item to be unplaced.', {
        code: 'invalid-engine-patch',
        status: 409,
      })
    }
  }
}

function assertAssignmentInverseMatches(project, patch) {
  if (patch?.kind === 'batch') {
    for (const child of patch.payload?.patches ?? []) assertAssignmentInverseMatches(project, child)
    return
  }
  if (patch?.kind !== 'patch-assignments') return

  const inverse = assignmentPatchFromEngine(patch.payload, 'inverse assignment patch')
  const current = new Map((project.assignments ?? []).map((assignment) => [assignment.id, assignment]))
  for (const assignment of inverse.upsert) {
    const existing = current.get(assignment.id)
    const existingAllocation = existing?.allocation
    const assignmentAllocation = assignment.allocation
    const allocationsMatch = (!existingAllocation && !assignmentAllocation) || (
      existingAllocation
      && assignmentAllocation
      && existingAllocation.resourceType === assignmentAllocation.resourceType
      && (existingAllocation.groupId ?? null) === (assignmentAllocation.groupId ?? null)
      && existingAllocation.positions.length === assignmentAllocation.positions.length
      && existingAllocation.positions.every(
        (position, index) => position === assignmentAllocation.positions[index],
      )
    )
    if (
      !existing
      || existing.hostType !== assignment.hostType
      || existing.hostId !== assignment.hostId
      || existing.itemType !== assignment.itemType
      || existing.itemId !== assignment.itemId
      || existing.type !== assignment.type
      || existing.assignedAt !== assignment.assignedAt
      || !allocationsMatch
    ) {
      throw new InventoryLifecycleError('Assignment patch does not match current project state.', {
        code: 'invalid-engine-patch',
        status: 409,
      })
    }
  }
  for (const assignmentId of inverse.remove) {
    if (current.has(assignmentId)) {
      throw new InventoryLifecycleError('Assignment patch expected an unassigned component.', {
        code: 'invalid-engine-patch',
        status: 409,
      })
    }
  }
}

function persistedRouteFromEngine(route) {
  if (!route) return undefined

  const nextRoute = {
    ...(route.source_side ? { sourceSide: route.source_side } : {}),
    ...(route.target_side ? { targetSide: route.target_side } : {}),
    ...(route.bend_points?.length
      ? { bendPoints: route.bend_points.map((point) => ({ x: point.x, y: point.y })) }
      : {}),
    ...(route.avoid_cable_overlap === true ? { avoidCableOverlap: true } : {}),
  }
  return Object.keys(nextRoute).length > 0 ? nextRoute : undefined
}

function persistedConnectionFromEngine(connection) {
  const connectionType = connection?.connection_type
  if (!['network', 'display', 'power', 'other'].includes(connectionType)) {
    throw new InventoryLifecycleError('Engine connection uses an unsupported connection type.', {
      code: 'invalid-engine-patch',
      status: 500,
    })
  }

  const route = persistedRouteFromEngine(connection.route)
  return {
    id: assertRelationalId(connection?.id, 'connection.id'),
    from: persistedEndpointFromEngine(connection?.from, 'connection.from'),
    to: persistedEndpointFromEngine(connection?.to, 'connection.to'),
    type: connectionType,
    ...(connection.negotiated_speed_mbps === null || connection.negotiated_speed_mbps === undefined
      ? {}
      : { negotiatedSpeedMbps: connection.negotiated_speed_mbps }),
    ...(connection.label === null || connection.label === undefined
      ? {}
      : { label: connection.label }),
    ...(route ? { route } : {}),
    createdAt: connection.created_at,
  }
}

function applyEngineForwardPatch(project, forward) {
  if (forward?.kind === 'batch') {
    if (!Array.isArray(forward.payload?.patches) || forward.payload.patches.length === 0) {
      throw new InventoryLifecycleError('Engine patch batch must not be empty.', {
        code: 'invalid-engine-patch',
        status: 500,
      })
    }
    return forward.payload.patches.reduce(
      (current, patch) => applyEngineForwardPatch(current, patch),
      project,
    )
  }

  if (forward?.kind === 'set-project-name') {
    return {
      ...project,
      metadata: { ...project.metadata, name: forward.payload.name },
    }
  }

  if (forward?.kind === 'add-connection') {
    const connection = persistedConnectionFromEngine(forward.payload.connection)
    if (project.connections.some((candidate) => candidate.id === connection.id)) {
      throw new InventoryLifecycleError(`Connection ${String(connection.id)} already exists.`, {
        code: 'invalid-engine-patch',
        status: 500,
      })
    }
    return { ...project, connections: [...project.connections, connection] }
  }

  if (forward?.kind === 'remove-connection') {
    const connectionId = assertRelationalId(
      forward.payload?.connection?.id,
      'connection.id',
    )
    if (!project.connections.some((candidate) => candidate.id === connectionId)) {
      throw new InventoryLifecycleError(`Connection ${String(connectionId)} does not exist.`, {
        code: 'invalid-engine-patch',
        status: 500,
      })
    }
    return {
      ...project,
      connections: project.connections.filter((candidate) => candidate.id !== connectionId),
    }
  }

  if (forward?.kind === 'set-connection-label') {
    const connectionId = assertRelationalId(forward.payload?.connection_id, 'connection.id')
    let found = false
    const connections = project.connections.map((connection) => {
      if (connection.id !== connectionId) return connection
      found = true
      const { label: _label, ...withoutLabel } = connection
      return forward.payload.label === null
        ? withoutLabel
        : { ...withoutLabel, label: forward.payload.label }
    })
    if (!found) {
      throw new InventoryLifecycleError(`Connection ${String(connectionId)} does not exist.`, {
        code: 'invalid-engine-patch',
        status: 500,
      })
    }
    return { ...project, connections }
  }

  if (forward?.kind === 'set-connection-route') {
    const connectionId = assertRelationalId(forward.payload?.connection_id, 'connection.id')
    const route = persistedRouteFromEngine(forward.payload.route)
    let found = false
    const connections = project.connections.map((connection) => {
      if (connection.id !== connectionId) return connection
      found = true
      const { route: _route, ...withoutRoute } = connection
      return route ? { ...withoutRoute, route } : withoutRoute
    })
    if (!found) {
      throw new InventoryLifecycleError(`Connection ${String(connectionId)} does not exist.`, {
        code: 'invalid-engine-patch',
        status: 500,
      })
    }
    return { ...project, connections }
  }

  if (forward?.kind === 'set-connection-derived') {
    if (!Array.isArray(forward.payload?.states)) {
      throw new InventoryLifecycleError('Engine derived connection patch is malformed.', {
        code: 'invalid-engine-patch',
        status: 500,
      })
    }
    const states = new Map(forward.payload.states.map((state) => {
      const connectionId = assertRelationalId(state.connection_id, 'connection.id')
      if (!['network', 'display', 'power', 'other'].includes(state.connection_type)) {
        throw new InventoryLifecycleError('Engine connection uses an unsupported connection type.', {
          code: 'invalid-engine-patch',
          status: 500,
        })
      }
      if (
        state.negotiated_speed_mbps !== null &&
        ![1000, 2500, 5000, 10000].includes(state.negotiated_speed_mbps)
      ) {
        throw new InventoryLifecycleError('Engine connection uses an unsupported negotiated speed.', {
          code: 'invalid-engine-patch',
          status: 500,
        })
      }
      return [connectionId, state]
    }))
    const found = new Set()
    const connections = project.connections.map((connection) => {
      const state = states.get(connection.id)
      if (!state) return connection
      found.add(connection.id)
      const { negotiatedSpeedMbps: _speed, ...withoutSpeed } = connection
      return {
        ...withoutSpeed,
        type: state.connection_type,
        ...(state.negotiated_speed_mbps === null
          ? {}
          : { negotiatedSpeedMbps: state.negotiated_speed_mbps }),
      }
    })
    if (found.size !== states.size) {
      throw new InventoryLifecycleError('Engine derived patch references a missing connection.', {
        code: 'invalid-engine-patch',
        status: 500,
      })
    }
    return { ...project, connections }
  }

  if (forward?.kind === 'patch-placements') {
    const patch = placementPatchFromEngine(forward.payload, 'placement patch')
    const upsert = new Map(patch.upsert.map((placement) => [placementRefKey(placement), placement]))
    const remove = new Set(patch.remove.map(placementRefKey))
    const placements = (project.placements ?? []).flatMap((placement) => {
      const key = placementRefKey(placement)
      if (remove.has(key)) return []
      const replacement = upsert.get(key)
      if (replacement) upsert.delete(key)
      return [replacement ?? placement]
    })
    placements.push(...upsert.values())
    return { ...project, placements }
  }

  if (forward?.kind === 'patch-assignments') {
    const patch = assignmentPatchFromEngine(forward.payload, 'assignment patch')
    const upsert = new Map(patch.upsert.map((assignment) => [assignment.id, assignment]))
    const remove = new Set(patch.remove)
    const foundRemovals = new Set()
    const assignments = (project.assignments ?? []).flatMap((assignment) => {
      if (remove.has(assignment.id)) {
        foundRemovals.add(assignment.id)
        return []
      }
      const replacement = upsert.get(assignment.id)
      if (replacement) upsert.delete(assignment.id)
      return [replacement ?? assignment]
    })
    if (foundRemovals.size !== remove.size) {
      throw new InventoryLifecycleError('Assignment patch references a missing assignment.', {
        code: 'invalid-engine-patch',
        status: 500,
      })
    }
    assignments.push(...upsert.values())
    assignments.sort((first, second) => first.id - second.id)
    return { ...project, assignments }
  }

  throw new InventoryLifecycleError(`Unsupported engine patch ${String(forward?.kind)}.`, {
    code: 'unsupported-engine-patch',
    status: 500,
  })
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
    this.projectCommitListeners = new Set()
    this.pendingProjectCommits = []
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
      const normalizedLegacyProject = normalizeNetworkProject(legacyProject)
      assertLegacyProjectShape(normalizedLegacyProject)
      const split = splitLegacyProject(normalizedLegacyProject)

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
      revision: 1,
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
      revision: 1,
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
    const schemaVersion = this.databases.meta.data.schemaVersion ?? 0

    if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 0) {
      throw new Error('Database schema version must be a non-negative safe integer.')
    }

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
        const split = splitLegacyProject(composedProject)

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
        const split = splitLegacyProject(recalculateNegotiatedSpeeds(composedProject))

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
        const split = splitLegacyProject(normalizeNetworkProject(composedProject))

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
        // Allocation planning is deferred until schema 10 has converted legacy
        // compatibility group keys into numeric relational identifiers.
        this.databases.meta.data.schemaVersion = 7
        currentVersion = 7
        continue
      }

      if (currentVersion === 7) {
        this.databases.project.data.compatibilityPolicy = normalizeCompatibilityPolicy(
          this.databases.project.data.compatibilityPolicy,
        )
        this.databases.meta.data.schemaVersion = 8
        currentVersion = 8
        continue
      }

      if (currentVersion === 8) {
        const { inventory, migratedWirelessIds } = migrateInventoryToSchema9(
          this.databases.inventory.data,
        )
        this.databases.inventory.data = inventory
        this.databases.project.data = migrateWirelessProjectReferences(
          this.databases.project.data,
          migratedWirelessIds,
        )
        this.databases.meta.data.schemaVersion = 9
        currentVersion = 9
        continue
      }

      if (currentVersion === 9) {
        const migrated = migrateSchema9To10(
          this.databases.inventory.data,
          this.databases.project.data,
          this.databases.agents.data,
          this.databases.agentStatus.data,
        )
        this.databases.inventory.data = migrated.inventory
        this.databases.project.data = migrated.project
        this.databases.agents.data = migrated.agents
        this.databases.agentStatus.data = migrated.agentStatus
        this.databases.meta.data.schemaVersion = 10
        currentVersion = 10
        continue
      }

      if (currentVersion === 10) {
        this.databases.inventory.data = migrateSchema10To11(this.databases.inventory.data)
        this.databases.meta.data.schemaVersion = 11
        currentVersion = 11
        continue
      }

      if (currentVersion === 11) {
        const migrated = migrateSchema11To12(
          this.databases.inventory.data,
          this.databases.project.data,
        )
        this.databases.inventory.data = migrated.inventory
        this.databases.project.data = migrated.project
        this.databases.meta.data.schemaVersion = 12
        currentVersion = 12
        continue
      }

      if (currentVersion === 12) {
        this.databases.project.data = migrateSchema12To13(this.databases.project.data)
        this.databases.meta.data.schemaVersion = 13
        currentVersion = 13
        continue
      }

      throw new Error(`No migration registered for schema version ${currentVersion}.`)
    }

    this.databases.meta.data.updatedAt = new Date().toISOString()
    await this.flush(['inventory', 'project', 'agents', 'agentStatus'])
    await this.flush(['meta'])
  }

  async validateStores() {
    assertInventoryStoreShape(this.databases.inventory.data)
    assertProjectStoreShape(this.databases.project.data, { requireRevision: true })
    assertAgentsStoreShape(this.databases.agents.data)
    assertAgentStatusStoreShape(this.databases.agentStatus.data)
    assertProjectShape(this.getProject())
    this.databases.meta.data.skippedUpdateVersion ??= null
    this.databases.meta.data.lastUpdateCheck ??= null
  }

  async normalizeLoadedCompatibility() {
    const split = splitCurrentProject(this.getProject())
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

  getEngineSnapshot() {
    return createEngineSnapshot(this.getProject())
  }

  setProject(project) {
    const currentRevision = this.databases.project.data.revision
    const submittedRevision = project.revision ?? currentRevision
    if (submittedRevision !== currentRevision) {
      throw new InventoryLifecycleError(
        `Project revision ${String(submittedRevision)} is stale; current revision is ${String(currentRevision)}.`,
        { code: 'revision-conflict', status: 409 },
      )
    }
    const submittedProject = {
      ...project,
      id: 'default',
      connections: project.connections ?? [],
    }

    assertProjectShape(submittedProject)
    const canonicalProject = normalizeProjectCompatibilityPolicy(submittedProject)
    assertProjectShape(canonicalProject)
    this.assertAssignmentTransitions(this.getProject(), canonicalProject)
    const split = splitCurrentProject(canonicalProject)
    const updatedAt = new Date().toISOString()

    this.databases.inventory.data = split.inventory
    this.databases.project.data = {
      ...split.project,
      id: 'default',
      revision: this.nextProjectRevision(),
      metadata: {
        ...split.project.metadata,
        name: split.project.metadata?.name ?? 'Homelab Inventory',
        version: split.project.metadata?.version ?? 1,
        updatedAt,
      },
      connections: split.project.connections ?? [],
    }
    this.databases.meta.data.updatedAt = updatedAt
    this.queueProjectCommit({
      type: 'canonical-invalidated',
      baseRevision: currentRevision,
      revision: this.databases.project.data.revision,
    })

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
        const errors = result.findings?.filter(
          (finding) =>
            finding.severity === 'error' &&
            shouldEnforceCompatibilityFinding(submittedProject, result, finding),
        ) ?? []
        for (const finding of errors) {
          baseline.add(compatibilityFindingIdentity(result, finding))
        }
      }
    }

    for (const hostId of affectedHosts) {
      for (const result of planHostAllocations(submittedProject, hostId).results) {
        const errors = result.findings?.filter(
          (finding) =>
            finding.severity === 'error' &&
            shouldEnforceCompatibilityFinding(submittedProject, result, finding),
        ) ?? []
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
    const baseRevision = this.databases.project.data.revision
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
    draft.project.revision = this.nextProjectRevision(draft.project)

    try {
      const split = splitCurrentProject(composeProject(draft.meta, draft.inventory, draft.project))
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
    this.queueProjectCommit({
      type: 'canonical-invalidated',
      baseRevision,
      revision: draft.project.revision,
    })
    this.scheduleFlush('meta')
    this.scheduleFlush('inventory')
    this.scheduleFlush('project')

    return composeProject(draft.meta, draft.inventory, draft.project)
  }

  nextProjectRevision(project = this.databases.project.data) {
    const current = project.revision
    if (!Number.isSafeInteger(current) || current < 1 || current >= Number.MAX_SAFE_INTEGER) {
      throw new Error('Project revision cannot be advanced safely.')
    }
    return current + 1
  }

  subscribeToProjectCommits(listener) {
    this.projectCommitListeners.add(listener)
    return () => this.projectCommitListeners.delete(listener)
  }

  queueProjectCommit(event) {
    this.pendingProjectCommits.push(event)
  }

  async applyEnginePatch({ baseRevision, patchSet, responseBytes }) {
    if (this.databases.project.data.revision !== baseRevision) {
      throw new InventoryLifecycleError(
        `Project revision ${String(baseRevision)} is stale; current revision is ${String(this.databases.project.data.revision)}.`,
        { code: 'revision-conflict', status: 409 },
      )
    }
    if (patchSet.revision !== baseRevision + 1) {
      throw new InventoryLifecycleError('Engine patch revision is not sequential.', {
        code: 'invalid-engine-patch',
        status: 500,
      })
    }

    assertPlacementInverseMatches(this.databases.project.data, patchSet.inverse)
    assertAssignmentInverseMatches(this.databases.project.data, patchSet.inverse)
    const previousProject = structuredClone(this.databases.project.data)
    const previousMeta = structuredClone(this.databases.meta.data)
    const updatedAt = new Date().toISOString()
    const patchedProject = applyEngineForwardPatch(this.databases.project.data, patchSet.forward)
    const nextProject = {
      ...patchedProject,
      revision: patchSet.revision,
      metadata: {
        ...patchedProject.metadata,
        updatedAt,
      },
    }
    assertProjectStoreShape(nextProject)
    assertProjectShape(composeProject(this.databases.meta.data, this.databases.inventory.data, nextProject))
    this.databases.project.data = nextProject
    this.databases.meta.data.updatedAt = updatedAt
    const commitEvent = {
      type: 'project-commit',
      baseRevision,
      revision: patchSet.revision,
      responseBytes: Uint8Array.from(responseBytes),
    }
    this.queueProjectCommit(commitEvent)
    this.dirtyStores.add('project')

    try {
      await this.flush(['project'])
    } catch (error) {
      this.databases.project.data = previousProject
      this.databases.meta.data = previousMeta
      this.pendingProjectCommits = this.pendingProjectCommits.filter(
        (event) => event !== commitEvent,
      )
      throw error
    }

    this.scheduleFlush('meta')
    return this.getProject()
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
        .sort((first, second) => first.id - second.id)
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
      if (
        ref.type === 'nas'
        && resolved.item.specs?.powerConfiguration !== record.specs?.powerConfiguration
      ) {
        throw new InventoryLifecycleError(
          'Use the NAS power configuration command to change power modes.',
          { code: 'nas-power-configuration-command-required', status: 409 },
        )
      }
      const connectedPortIds = referencedPortIds(draft.project, ref)

      for (const portId of connectedPortIds) {
        const previousPort = resolved.item.ports?.find((port) => port.id === portId)
        const nextPort = record.ports?.find((port) => port.id === portId)

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

  changeNasPowerConfiguration(rawRef, target, confirmed = false) {
    const ref = normalizeInventoryRef(rawRef)
    const impact = inspectNasPowerConfigurationChange(
      this.dependencyContext(),
      ref,
      target,
    )

    if (impact.requiresConfirmation && !confirmed) {
      return { status: 'confirmation-required', impact: impact.publicImpact }
    }

    const project = this.inventoryTransaction((draft) => {
      applyNasPowerConfigurationChange(draft, ref, target)
    })
    return { status: 'applied', project }
  }

  updateInventoryItemProperties(rawRef, rawProperties) {
    const ref = normalizeInventoryRef(rawRef)

    if (!rawProperties || typeof rawProperties !== 'object' || Array.isArray(rawProperties)) {
      throw new InventoryLifecycleError('Inventory item properties must be a plain object.', {
        code: 'invalid-inventory-properties',
        status: 400,
      })
    }

    return this.inventoryTransaction((draft) => {
      const resolved = resolveInventoryRef(draft.inventory, ref)

      if (resolved.item.archivedAt) {
        throw new InventoryLifecycleError('Restore the item before editing it.', {
          code: 'inventory-item-archived',
          status: 409,
        })
      }

      const properties = cleanPlainObject(rawProperties) ?? {}
      const mergedProperties = {
        ...(resolved.item.properties ?? {}),
        ...properties,
      }
      const record = structuredClone(resolved.item)

      if (Object.keys(mergedProperties).length > 0) {
        record.properties = mergedProperties
      } else {
        delete record.properties
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
        .sort((first, second) => first.id - second.id)
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

      const policy = normalizeCompatibilityPolicy(draft.project.compatibilityPolicy)
      const deletedHosts = new Set(
        refs
          .filter((ref) => ['server', 'nas', 'pcBuild'].includes(ref.type))
          .map((ref) => itemKey(ref.type, ref.id)),
      )
      draft.project.compatibilityPolicy = {
        ...policy,
        disabledHosts: policy.disabledHosts.filter(
          (host) => !deletedHosts.has(itemKey(host.hostType, host.hostId)),
        ),
      }

      return { items: refs }
    })
  }

  clearAgentRuntimeData(serverId) {
    const id = parseLegacyRelationalId(serverId, 'Server id')

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
    const commitsToPublish = storesToFlush.includes('project')
      ? this.pendingProjectCommits.splice(0)
      : []

    if (storesToFlush.length === 0) {
      return
    }

    this.flushPromise = Promise.all(storesToFlush.map((storeName) => this.databases[storeName].write()))
      .finally(() => {
        this.flushPromise = null
      })

    try {
      await this.flushPromise
    } catch (error) {
      storesToFlush.forEach((storeName) => this.dirtyStores.add(storeName))
      this.pendingProjectCommits.unshift(...commitsToPublish)
      throw error
    }

    for (const commit of commitsToPublish) {
      for (const listener of this.projectCommitListeners) {
        try {
          listener(commit)
        } catch (error) {
          console.error('Project commit listener failed.', error)
        }
      }
    }
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
