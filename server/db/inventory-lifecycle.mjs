import {
  isAssignableComponentType,
  isCanvasEquipmentType,
  isHostType,
} from './inventory-capabilities.mjs'

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

const PORT_RUNTIME_FIELDS = new Set([
  'label',
  'notes',
  'ipAddress',
  'ipAddresses',
  'address',
  'customRole',
  'roleOverride',
])

export class InventoryLifecycleError extends Error {
  constructor(message, { code = 'inventory-error', status = 400, details } = {}) {
    super(message)
    this.name = 'InventoryLifecycleError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export function inventoryItemKey(type, id) {
  return `${type}:${id}`
}

export function normalizeInventoryRef(ref) {
  const type = String(ref?.type ?? '').trim()
  const id = Number(ref?.id)

  if (!TABLE_BY_TYPE[type] || !Number.isInteger(id) || id < 1) {
    throw new InventoryLifecycleError('Inventory reference must include a supported type and numeric id.', {
      code: 'invalid-inventory-reference',
      status: 400,
    })
  }

  return { type, id }
}

export function resolveInventoryRef(inventory, rawRef) {
  const ref = normalizeInventoryRef(rawRef)
  const table = TABLE_BY_TYPE[ref.type]
  const records = inventory?.[table]

  if (!Array.isArray(records)) {
    throw new InventoryLifecycleError(`Inventory table ${table} is unavailable.`, {
      code: 'invalid-inventory-store',
      status: 500,
    })
  }

  const index = records.findIndex((record) => Number(record?.id) === ref.id)

  if (index < 0) {
    throw new InventoryLifecycleError(`Inventory item ${inventoryItemKey(ref.type, ref.id)} was not found.`, {
      code: 'inventory-item-not-found',
      status: 404,
    })
  }

  return { ...ref, table, records, index, item: records[index] }
}

export function isEquipmentType(type) {
  return isCanvasEquipmentType(type)
}

function baseEquipmentName(name) {
  return String(name ?? '').trim().replace(/\s+#\d+$/u, '')
}

export function nextEquipmentName(name, existingRecords) {
  const baseName = baseEquipmentName(name)
  const used = new Set()

  for (const record of existingRecords ?? []) {
    const candidate = String(record?.name ?? '').trim()
    if (candidate === baseName) {
      used.add(1)
      continue
    }

    const match = candidate.match(/^(.*)\s+#(\d+)$/u)
    if (match?.[1] === baseName) {
      used.add(Number(match[2]))
    }
  }

  const suffix = used.size > 0 ? Math.max(...used) + 1 : 1

  return `${baseName} #${suffix}`
}

function cleanEndpoint(endpoint, index) {
  return {
    id: index + 1,
    side: endpoint.side,
  }
}

function cleanPort(port, index, fallbackKind) {
  const cleaned = {
    id: index + 1,
    kind: port.kind ?? fallbackKind,
    type: port.type,
    slotNumber: Number.isInteger(Number(port.slotNumber)) ? Number(port.slotNumber) : index + 1,
  }

  for (const field of ['role', 'speed', 'poe']) {
    if (port[field] !== undefined) cleaned[field] = structuredClone(port[field])
  }

  if (Array.isArray(port.endpoints)) {
    cleaned.endpoints = port.endpoints.map(cleanEndpoint)
  }

  return cleaned
}

function cleanCompatibility(compatibility) {
  if (!compatibility || typeof compatibility !== 'object' || Array.isArray(compatibility)) {
    return undefined
  }

  const cleaned = structuredClone(compatibility)
  const host = cleaned.host

  if (host && typeof host === 'object' && !Array.isArray(host)) {
    if (Array.isArray(host.storageSlots)) {
      host.storageSlots = host.storageSlots.map((group, index) => ({
        ...group,
        id: `storage-${index + 1}`,
      }))
    }
    if (Array.isArray(host.expansionSlots)) {
      host.expansionSlots = host.expansionSlots.map((group, index) => ({
        ...group,
        id: `expansion-${index + 1}`,
      }))
    }
  }

  return cleaned
}

export function buildCleanRecord({ source, id, type, name = source?.name }) {
  const record = {
    id,
    name,
  }

  for (const field of ['subtype', 'manufacturer', 'secondaryManufacturer', 'family', 'model', 'number']) {
    if (source?.[field] !== undefined) record[field] = structuredClone(source[field])
  }

  if (source?.specs && typeof source.specs === 'object' && !Array.isArray(source.specs)) {
    record.specs = structuredClone(source.specs)
  }

  const compatibility = cleanCompatibility(source?.compatibility)
  if (compatibility) record.compatibility = compatibility

  if (Array.isArray(source?.ports) && source.ports.length > 0) {
    const fallbackKind = type === 'switch'
      ? 'switch-port'
      : type === 'patchPanel'
        ? 'keystone'
        : 'server-port'
    record.ports = source.ports.map((port, index) => cleanPort(port, index, fallbackKind))
  }

  return record
}

export function buildDuplicateRecord({ source, type, nextId, existingRecords }) {
  const name = isCanvasEquipmentType(type)
    ? nextEquipmentName(source.name, existingRecords)
    : source.name

  return buildCleanRecord({ source, id: nextId, type, name })
}

export function buildQuantityRecords({ input, type, quantity, startingId, existingRecords }) {
  const records = []
  const names = [...(existingRecords ?? [])]

  for (let index = 0; index < quantity; index += 1) {
    const id = startingId + index
    const name = isCanvasEquipmentType(type) && quantity > 1
      ? nextEquipmentName(input.name, names)
      : input.name
    const record = structuredClone(input)
    record.id = id
    record.name = name
    delete record.type
    delete record.key
    delete record.archivedAt

    const compatibility = cleanCompatibility(record.compatibility)
    if (compatibility) record.compatibility = compatibility

    if (Array.isArray(record.ports)) {
      const fallbackKind = type === 'switch'
        ? 'switch-port'
        : type === 'patchPanel'
          ? 'keystone'
          : 'server-port'
      record.ports = record.ports.map((port, portIndex) => ({
        ...port,
        id: portIndex + 1,
        kind: port.kind ?? fallbackKind,
        slotNumber: Number.isInteger(Number(port.slotNumber)) ? Number(port.slotNumber) : portIndex + 1,
        ...(Array.isArray(port.endpoints)
          ? {
              endpoints: port.endpoints.map((endpoint, endpointIndex) => ({
                ...endpoint,
                id: endpointIndex + 1,
              })),
            }
          : {}),
      }))
    }
    records.push(record)
    names.push(record)
  }

  return records
}

function persistedRefMatches(type, id, candidateType, candidateId) {
  return candidateType === type && Number(candidateId) === id
}

function runtimeRefMatches(type, id, candidate) {
  return candidate === inventoryItemKey(type, id)
}

function endpointReferences(endpoint, ref) {
  return persistedRefMatches(ref.type, ref.id, endpoint?.itemType, endpoint?.itemId)
    || runtimeRefMatches(ref.type, ref.id, endpoint?.itemId)
    || persistedRefMatches(ref.type, ref.id, endpoint?.hostedItemType, endpoint?.hostedItemId)
    || runtimeRefMatches(ref.type, ref.id, endpoint?.hostedItemId)
}

function endpointReferencesHost(endpoint, ref) {
  return persistedRefMatches(ref.type, ref.id, endpoint?.itemType, endpoint?.itemId)
    || runtimeRefMatches(ref.type, ref.id, endpoint?.itemId)
}

function hasConfiguredValue(value) {
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.some(hasConfiguredValue)
  return value !== undefined && value !== null && value !== false
}

function portHasRuntimeMetadata(port) {
  for (const field of PORT_RUNTIME_FIELDS) {
    if (hasConfiguredValue(port?.[field])) return true
  }

  return (port?.endpoints ?? []).some((endpoint) => {
    for (const field of PORT_RUNTIME_FIELDS) {
      if (hasConfiguredValue(endpoint?.[field])) return true
    }
    return false
  })
}

function safeReference(record, fields) {
  return Object.fromEntries(
    fields
      .filter((field) => record?.[field] !== undefined)
      .map((field) => [field, record[field]]),
  )
}

function reason(kind, message, related = []) {
  return { kind, count: related.length, message, related }
}

export function analyzeInventoryDependencies({ inventory, project, agents, agentStatus }, rawRef) {
  const resolved = resolveInventoryRef(inventory, rawRef)
  const ref = { type: resolved.type, id: resolved.id }
  const placements = isCanvasEquipmentType(ref.type)
    ? (project?.placements ?? []).filter((placement) =>
        persistedRefMatches(ref.type, ref.id, placement.itemType, placement.itemId)
          || runtimeRefMatches(ref.type, ref.id, placement.serverId),
      )
    : []
  const assignments = isAssignableComponentType(ref.type)
    ? (project?.assignments ?? []).filter((assignment) =>
        persistedRefMatches(ref.type, ref.id, assignment.itemType, assignment.itemId)
          || runtimeRefMatches(ref.type, ref.id, assignment.itemId),
      )
    : []
  const hostedComponents = isHostType(ref.type)
    ? (project?.assignments ?? []).filter((assignment) =>
        persistedRefMatches(ref.type, ref.id, assignment.hostType, assignment.hostId)
          || runtimeRefMatches(ref.type, ref.id, assignment.serverId),
      )
    : []
  const connections = (project?.connections ?? []).filter((connection) =>
    endpointReferences(connection.from, ref)
      || endpointReferences(connection.to, ref)
      || (isCanvasEquipmentType(ref.type) && (
        endpointReferencesHost(connection.from, ref) || endpointReferencesHost(connection.to, ref)
      )),
  )
  const enrollments = Object.values(agents?.enrollments ?? {}).filter((enrollment) =>
    isHostType(ref.type)
      && Number(enrollment?.serverId) === ref.id
      && !enrollment?.revokedAt
      && !enrollment?.usedAt
      && (!enrollment?.expiresAt || Date.parse(enrollment.expiresAt) > Date.now()),
  )
  const devices = Object.values(agents?.devices ?? {}).filter((device) =>
    isHostType(ref.type)
      && Number(device?.serverId) === ref.id
      && !device?.revokedAt,
  )
  const statuses = Object.entries(agentStatus?.servers ?? {}).filter(([serverId, status]) =>
    isHostType(ref.type)
      && Number(status?.serverId ?? serverId) === ref.id,
  )
  const metadataPorts = (resolved.item.ports ?? []).filter(portHasRuntimeMetadata)
  const reasons = []

  if (placements.length > 0) {
    reasons.push(reason(
      'canvas-placement',
      'Item is placed on the canvas.',
      placements.map((placement) => safeReference(placement, ['itemType', 'itemId', 'serverId'])),
    ))
  }
  if (assignments.length > 0) {
    reasons.push(reason(
      'host-assignment',
      'Item is assigned to a host.',
      assignments.map((assignment) => safeReference(
        assignment,
        ['id', 'hostType', 'hostId', 'serverId', 'itemType', 'itemId', 'type'],
      )),
    ))
  }
  if (hostedComponents.length > 0) {
    reasons.push(reason(
      'hosted-components',
      'Host contains assigned components.',
      hostedComponents.map((assignment) => safeReference(
        assignment,
        ['id', 'hostType', 'hostId', 'serverId', 'itemType', 'itemId', 'type'],
      )),
    ))
  }
  if (connections.length > 0) {
    reasons.push(reason(
      'port-connections',
      'Item has connected ports.',
      connections.map((connection) => safeReference(connection, ['id'])),
    ))
  }
  if (enrollments.length + devices.length > 0) {
    reasons.push(reason(
      'agent-registration',
      'Host has active agent registration data.',
      [...enrollments, ...devices].map((record) => safeReference(record, ['id', 'serverId'])),
    ))
  }
  if (statuses.length > 0) {
    reasons.push(reason(
      'agent-status',
      'Host has stored agent runtime status.',
      statuses.map(([serverId, status]) => ({ serverId: Number(status?.serverId ?? serverId) })),
    ))
  }
  if (metadataPorts.length > 0) {
    reasons.push(reason(
      'port-metadata',
      'Item has configured port metadata.',
      metadataPorts.map((port) => safeReference(port, ['id', 'slotNumber'])),
    ))
  }

  return {
    item: { type: ref.type, id: ref.id, name: resolved.item.name },
    blocked: reasons.length > 0,
    reasons,
  }
}

export function assertDependencyFree(reports, action) {
  const blocked = reports.filter((report) => report.blocked)

  if (blocked.length > 0) {
    throw new InventoryLifecycleError(`Cannot ${action} inventory items with dependencies.`, {
      code: 'inventory-dependencies',
      status: 409,
      details: { reports },
    })
  }
}

export function referencedPortIds(project, ref) {
  const portIds = new Set()

  for (const connection of project?.connections ?? []) {
    for (const endpoint of [connection.from, connection.to]) {
      const referencesHostedItem = persistedRefMatches(
        ref.type,
        ref.id,
        endpoint?.hostedItemType,
        endpoint?.hostedItemId,
      ) || runtimeRefMatches(ref.type, ref.id, endpoint?.hostedItemId)
      const referencesDirectItem = endpoint?.hostedItemId === undefined && (
        persistedRefMatches(ref.type, ref.id, endpoint?.itemType, endpoint?.itemId)
        || runtimeRefMatches(ref.type, ref.id, endpoint?.itemId)
      )

      if (referencesHostedItem || referencesDirectItem) portIds.add(Number(endpoint.portId))
    }
  }

  return portIds
}
