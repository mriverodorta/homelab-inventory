const HOST_TABLES = ['servers', 'nas', 'pcBuilds', 'motherboards']
const RESOURCE_COLLECTIONS = [
  'storageSlots',
  'expansionSlots',
  'optionalModuleSlots',
  'controllerSlots',
  'bootDeviceSlots',
  'coolingProfiles',
  'constraintGroups',
  'fixedPorts',
]
const HARDWARE_CLASSES = new Set(['desktop', 'workstation', 'server'])
const USAGE_ROLES = new Set(['server', 'desktop', 'workstation', 'other'])

function requireObject(value, fieldPath) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldPath} must be an object.`)
  }
  return value
}

function ensureResourceIds(records, fieldPath) {
  if (!Array.isArray(records)) throw new Error(`${fieldPath} must be an array.`)
  const used = new Set()
  for (const [index, record] of records.entries()) {
    requireObject(record, `${fieldPath}[${index}]`)
    if (record.id === undefined || record.id === null) continue
    if (!Number.isSafeInteger(record.id) || record.id < 1 || used.has(record.id)) {
      throw new Error(`${fieldPath}[${index}].id must be a unique positive safe integer.`)
    }
    used.add(record.id)
  }

  let nextId = 1
  let assigned = 0
  for (const record of records) {
    if (record.id !== undefined && record.id !== null) continue
    while (used.has(nextId)) nextId += 1
    record.id = nextId
    used.add(nextId)
    assigned += 1
  }
  return assigned
}

function ensureHostTopology(record, fieldPath) {
  record.compatibility ??= {}
  requireObject(record.compatibility, `${fieldPath}.compatibility`)
  record.compatibility.host ??= {}
  const host = requireObject(record.compatibility.host, `${fieldPath}.compatibility.host`)
  let initializedCollections = 0
  let assignedResourceIds = 0

  for (const collection of RESOURCE_COLLECTIONS) {
    if (host[collection] === undefined) {
      host[collection] = []
      initializedCollections += 1
    }
    assignedResourceIds += ensureResourceIds(
      host[collection],
      `${fieldPath}.compatibility.host.${collection}`,
    )
  }

  return { initializedCollections, assignedResourceIds }
}

export function migrateSchema23To24(inventoryInput) {
  const inventory = structuredClone(inventoryInput)
  let initializedCollections = 0
  let assignedResourceIds = 0
  let normalizedHosts = 0

  for (const table of HOST_TABLES) {
    const records = inventory[table]
    if (records === undefined) continue
    if (!Array.isArray(records)) throw new Error(`inventory.${table} must be an array.`)

    for (const [index, record] of records.entries()) {
      requireObject(record, `inventory.${table}[${index}]`)
      if (table === 'servers') {
        record.hardwareClass = HARDWARE_CLASSES.has(record.hardwareClass)
          ? record.hardwareClass
          : 'desktop'
        record.usageRole = USAGE_ROLES.has(record.usageRole) ? record.usageRole : 'server'
      }
      const result = ensureHostTopology(record, `inventory.${table}[${index}]`)
      initializedCollections += result.initializedCollections
      assignedResourceIds += result.assignedResourceIds
      normalizedHosts += 1
    }
  }

  return {
    inventory,
    summary: {
      normalizedHosts,
      initializedCollections,
      assignedResourceIds,
    },
  }
}
