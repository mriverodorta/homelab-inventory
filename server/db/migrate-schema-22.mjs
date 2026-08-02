const HOST_TABLES = new Set(['servers', 'nas', 'pcBuilds'])
const MODULE_TABLES = new Set(['networkCards', 'gpus', 'powerAdapters', 'wirelessCards', 'soundCards'])
const RESOURCE_GROUPS = ['storageSlots', 'expansionSlots', 'optionalModuleSlots', 'fixedPorts']
const USAGE_ROLES = new Set(['server', 'desktop', 'workstation', 'other'])

function assertAndCompleteNumericIds(records, label) {
  if (!Array.isArray(records)) return 0
  const used = new Set()
  for (const [index, record] of records.entries()) {
    if (record.id === undefined || record.id === null) continue
    if (!Number.isSafeInteger(record.id) || record.id < 1 || used.has(record.id)) {
      throw new Error(`${label}[${index}].id must be a unique positive safe integer.`)
    }
    used.add(record.id)
  }
  let next = 1
  let assigned = 0
  for (const record of records) {
    if (record.id !== undefined && record.id !== null) continue
    while (used.has(next)) next += 1
    record.id = next
    used.add(next)
    assigned += 1
  }
  return assigned
}

function markPorts(records, origin) {
  let changed = 0
  for (const record of records ?? []) {
    for (const port of record.ports ?? []) {
      if (port.origin === origin) continue
      port.origin = origin
      changed += 1
    }
  }
  return changed
}

export function migrateSchema21To22(inventoryInput, registryInput) {
  const inventory = structuredClone(inventoryInput)
  const registry = structuredClone(registryInput)
  let normalizedHosts = 0
  let normalizedPorts = 0
  let assignedResourceIds = 0

  for (const [table, records] of Object.entries(inventory)) {
    if (!Array.isArray(records)) continue
    if (HOST_TABLES.has(table)) {
      for (const record of records) {
        if (table === 'servers') {
          record.hardwareClass = record.hardwareClass === 'server' ? 'server' : 'desktop'
          record.usageRole = USAGE_ROLES.has(record.usageRole) ? record.usageRole : 'server'
          normalizedHosts += 1
        }
        const host = record.compatibility?.host
        if (host && typeof host === 'object' && !Array.isArray(host)) {
          for (const group of RESOURCE_GROUPS) {
            assignedResourceIds += assertAndCompleteNumericIds(host[group], `${table}.${record.id}.compatibility.host.${group}`)
          }
        }
      }
    }
    normalizedPorts += markPorts(records, MODULE_TABLES.has(table) ? 'module' : 'fixed')
  }

  registry.variantMatches = Array.isArray(registry.variantMatches) ? registry.variantMatches : []
  for (const link of registry.links ?? []) {
    link.importedFingerprintVersion ??= 2
  }

  return {
    inventory,
    registry,
    summary: {
      normalizedHosts,
      normalizedPorts,
      assignedResourceIds,
      initializedVariantMatches: !Array.isArray(registryInput?.variantMatches),
    },
  }
}
