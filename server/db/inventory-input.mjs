import { withCanonicalPowerPorts } from '../../shared/power-ports.mjs'
import { InventoryLifecycleError } from './inventory-lifecycle.mjs'
import { isRelationalId } from './relational-ids.mjs'

const SERVER_HARDWARE_CLASSES = new Set(['desktop', 'workstation', 'server'])
const SERVER_USAGE_ROLES = new Set(['server', 'desktop', 'workstation', 'other'])
const FIXED_COMPONENT_DISPOSITIONS = new Set(['fixed', 'soldered'])

export const TABLE_BY_TYPE = {
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

export function cleanItemForStore(item) {
  const record = { ...item }
  delete record.key
  delete record.type
  return record
}

export function cleanPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const entries = Object.entries(value)
    .map(([key, rawValue]) => {
      if (typeof rawValue === 'string') {
        const trimmed = rawValue.trim()
        return trimmed === '' ? null : [key, trimmed]
      }
      if (rawValue === undefined || rawValue === null || rawValue === '') return null
      return [key, rawValue]
    })
    .filter(Boolean)

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function normalizeFixedComponents(value) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new InventoryLifecycleError('fixedComponents must be an array.', {
      code: 'invalid-fixed-components', status: 400,
    })
  }
  const ids = new Set()
  return value.map((raw, index) => {
    const path = `fixedComponents[${index}]`
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !isRelationalId(raw.id)) {
      throw new InventoryLifecycleError(`${path}.id must be a positive numeric relationship ID.`, {
        code: 'invalid-fixed-components', status: 400,
      })
    }
    if (ids.has(raw.id)) {
      throw new InventoryLifecycleError(`${path}.id must be unique within the host.`, {
        code: 'invalid-fixed-components', status: 400,
      })
    }
    ids.add(raw.id)
    const componentType = typeof raw.componentType === 'string' ? raw.componentType.trim() : ''
    const label = typeof raw.label === 'string' ? raw.label.trim() : ''
    if (!componentType || !label || !FIXED_COMPONENT_DISPOSITIONS.has(raw.disposition)) {
      throw new InventoryLifecycleError(`${path} has an invalid component type, label, or disposition.`, {
        code: 'invalid-fixed-components', status: 400,
      })
    }
    if (!raw.item || typeof raw.item !== 'object' || Array.isArray(raw.item)) {
      throw new InventoryLifecycleError(`${path}.item must be an object.`, {
        code: 'invalid-fixed-components', status: 400,
      })
    }
    const item = structuredClone(raw.item)
    if (item.type !== componentType || typeof item.name !== 'string' || !item.name.trim()) {
      throw new InventoryLifecycleError(`${path}.item must match componentType and include a name.`, {
        code: 'invalid-fixed-components', status: 400,
      })
    }
    delete item.id
    delete item.key
    delete item.fixedComponents
    delete item.archivedAt
    return {
      id: raw.id,
      componentType,
      disposition: raw.disposition,
      label,
      item,
      ...(typeof raw.templateKey === 'string' && raw.templateKey.trim()
        ? { templateKey: raw.templateKey.trim() }
        : {}),
      ...(isRelationalId(raw.templateRevision) ? { templateRevision: raw.templateRevision } : {}),
    }
  })
}

function normalizeInventoryPort(port, index, fallbackKind) {
  if (!port || typeof port !== 'object' || Array.isArray(port)) {
    throw new InventoryLifecycleError(`ports[${index}] must be an object.`, {
      code: 'invalid-inventory-port', status: 400,
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

  const normalized = { id, kind: port.kind ?? fallbackKind, type: port.type, slotNumber }
  if (typeof port.key === 'string' && port.key.trim() !== '') normalized.key = port.key.trim()
  if (typeof port.label === 'string') normalized.label = port.label.trim()
  if (typeof port.notes === 'string' && port.notes.trim() !== '') normalized.notes = port.notes.trim()
  if (typeof port.role === 'string' && port.role.trim() !== '') normalized.role = port.role.trim()
  if (typeof port.speed === 'string' && port.speed.trim() !== '') normalized.speed = port.speed.trim()
  if (port.speedBps !== undefined) {
    if (!Number.isSafeInteger(port.speedBps) || port.speedBps < 0) {
      throw new InventoryLifecycleError(`ports[${index}].speedBps must be a non-negative safe integer.`, {
        code: 'invalid-inventory-port', status: 400,
      })
    }
    normalized.speedBps = port.speedBps
  }
  if (typeof port.poe === 'boolean') normalized.poe = port.poe
  if (port.origin === 'fixed' || port.origin === 'module') normalized.origin = port.origin
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
      return { id: endpointId, side: endpoint.side }
    })
  }
  return normalized
}

function normalizeSmartPowerStripConfiguration(type, rawSmart, ports) {
  if (rawSmart === undefined) return undefined
  if (type !== 'powerStrip') {
    throw new InventoryLifecycleError('Smart configuration is supported only for power strips.', {
      code: 'invalid-smart-power-strip', status: 400,
    })
  }
  if (!rawSmart || typeof rawSmart !== 'object' || Array.isArray(rawSmart) || rawSmart.enabled !== true) {
    throw new InventoryLifecycleError('Smart power-strip configuration must be enabled explicitly.', {
      code: 'invalid-smart-power-strip', status: 400,
    })
  }

  const outletPortIds = new Set((ports ?? []).filter((port) => port.type === 'ac-outlet').map((port) => port.id))
  if (rawSmart.outlets !== undefined && !Array.isArray(rawSmart.outlets)) {
    throw new InventoryLifecycleError('Smart power-strip outlet names must be an array.', {
      code: 'invalid-smart-power-strip', status: 400,
    })
  }
  const outlets = []
  const seenPortIds = new Set()
  for (const [index, outlet] of (rawSmart.outlets ?? []).entries()) {
    if (!outlet || typeof outlet !== 'object' || Array.isArray(outlet)) {
      throw new InventoryLifecycleError(`smart.outlets[${index}] must be an object.`, {
        code: 'invalid-smart-power-strip', status: 400,
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
        code: 'invalid-smart-power-strip', status: 400,
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

export function normalizeInventoryItemInput(input, id) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new InventoryLifecycleError('Inventory item payload must be an object.', {
      code: 'invalid-inventory-item', status: 400,
    })
  }
  const type = String(input.type ?? '').trim()
  const table = TABLE_BY_TYPE[type]
  if (!table) {
    throw new InventoryLifecycleError('Inventory item type is not supported.', {
      code: 'unsupported-inventory-type', status: 400,
    })
  }
  const name = String(input.name ?? '').trim()
  if (!name) {
    throw new InventoryLifecycleError('Inventory item name is required.', {
      code: 'invalid-inventory-item', status: 400,
    })
  }

  const item = { id, type, name }
  if (type === 'server') {
    const hardwareClass = String(input.hardwareClass ?? 'desktop').trim()
    const usageRole = String(input.usageRole ?? 'server').trim()
    if (!SERVER_HARDWARE_CLASSES.has(hardwareClass)) {
      throw new InventoryLifecycleError('Server hardware class must be desktop, workstation, or server.', {
        code: 'invalid-inventory-item', status: 400,
      })
    }
    if (!SERVER_USAGE_ROLES.has(usageRole)) {
      throw new InventoryLifecycleError('Server usage role must be server, desktop, workstation, or other.', {
        code: 'invalid-inventory-item', status: 400,
      })
    }
    item.hardwareClass = hardwareClass
    item.usageRole = usageRole
  }

  for (const field of ['subtype', 'manufacturer', 'secondaryManufacturer', 'family', 'model', 'number', 'notes']) {
    if (typeof input[field] === 'string' && input[field].trim() !== '') item[field] = input[field].trim()
  }
  if (Array.isArray(input.aliases)) {
    const aliases = [...new Set(input.aliases
      .filter((alias) => typeof alias === 'string')
      .map((alias) => alias.trim())
      .filter(Boolean))]
    if (aliases.length > 64) {
      throw new InventoryLifecycleError('Inventory item aliases cannot exceed 64 entries.', {
        code: 'invalid-inventory-item', status: 400,
      })
    }
    if (aliases.length > 0) item.aliases = aliases
  }

  const specs = cleanPlainObject(input.specs)
  const properties = cleanPlainObject(input.properties)
  if (specs) item.specs = specs
  if (properties) item.properties = properties
  if (input.compatibility && typeof input.compatibility === 'object' && !Array.isArray(input.compatibility)) {
    item.compatibility = structuredClone(input.compatibility)
  }
  const fixedComponents = normalizeFixedComponents(input.fixedComponents)
  if (fixedComponents?.length) item.fixedComponents = fixedComponents
  if (type === 'nas') {
    const catalogPowerConfiguration = item.compatibility?.host?.power?.configuration
    if (catalogPowerConfiguration === 'internal-psu' || catalogPowerConfiguration === 'external-adapter') {
      item.specs = { ...(item.specs ?? {}), powerConfiguration: catalogPowerConfiguration }
    }
  }
  if (Array.isArray(input.ports)) {
    const fallbackKind = type === 'switch' ? 'switch-port' : type === 'patchPanel' ? 'keystone' : 'server-port'
    const ports = input.ports.map((port, index) => normalizeInventoryPort(port, index, fallbackKind))
    if (ports.length > 0) item.ports = ports
  }

  const materialized = withCanonicalPowerPorts(item)
  const smart = normalizeSmartPowerStripConfiguration(type, input.smart, materialized.ports)
  if (smart) materialized.smart = smart
  return { item: materialized, table }
}
