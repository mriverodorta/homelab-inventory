import { assertRegistryStoreShape } from '../registry/model.mjs'
import { validateRoutingCache } from '../routing-cache-model.mjs'
import {
  assertInventoryStoreShape,
  assertProjectStoreShape,
} from './validation.mjs'

const HOST_TABLES = ['servers', 'nas', 'pcBuilds', 'motherboards']
const PHYSICAL_FORM_FACTORS = new Map([
  ['DIMM', 'DIMM'],
  ['SODIMM', 'SO-DIMM'],
  ['SO-DIMM', 'SO-DIMM'],
])
const ELECTRICAL_MODULE_TYPES = new Set(['UDIMM', 'RDIMM', 'LRDIMM'])

function requireObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`)
  }
  return value
}

function canonicalToken(value, path) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${path} must be a non-empty string.`)
  }
  return value.trim().toUpperCase().replace(/\s+/g, '')
}

function unique(values) {
  return [...new Set(values)]
}

function migrateHostMemory(memory, path) {
  requireObject(memory, path)
  const physical = []
  const electrical = []

  if (memory.formFactors !== undefined) {
    if (!Array.isArray(memory.formFactors)) throw new Error(`${path}.formFactors must be an array.`)
    for (const [index, value] of memory.formFactors.entries()) {
      const canonical = PHYSICAL_FORM_FACTORS.get(canonicalToken(value, `${path}.formFactors[${index}]`))
      if (!canonical) throw new Error(`${path}.formFactors[${index}] is ambiguous or unsupported.`)
      physical.push(canonical)
    }
  }

  if (memory.moduleTypes !== undefined) {
    if (!Array.isArray(memory.moduleTypes)) throw new Error(`${path}.moduleTypes must be an array.`)
    for (const [index, value] of memory.moduleTypes.entries()) {
      const token = canonicalToken(value, `${path}.moduleTypes[${index}]`)
      const physicalValue = PHYSICAL_FORM_FACTORS.get(token)
      if (physicalValue) {
        physical.push(physicalValue)
      } else if (ELECTRICAL_MODULE_TYPES.has(token)) {
        electrical.push(token)
      } else {
        throw new Error(`${path}.moduleTypes[${index}] is ambiguous or unsupported.`)
      }
    }
  }

  if (physical.length > 0) memory.formFactors = unique(physical)
  else delete memory.formFactors
  if (electrical.length > 0) memory.moduleTypes = unique(electrical)
  else delete memory.moduleTypes
}

function migrateRam(record, path) {
  requireObject(record, path)
  record.specs ??= {}
  const specs = requireObject(record.specs, `${path}.specs`)
  const legacySpeed = specs.speed
  const canonicalSpeed = specs.speedMt
  if (legacySpeed !== undefined) {
    if (typeof legacySpeed !== 'number' || !Number.isFinite(legacySpeed) || legacySpeed <= 0) {
      throw new Error(`${path}.specs.speed must be a positive number.`)
    }
    if (canonicalSpeed !== undefined && canonicalSpeed !== legacySpeed) {
      throw new Error(`${path}.specs.speed conflicts with specs.speedMt.`)
    }
    specs.speedMt = legacySpeed
    delete specs.speed
  }
  if (typeof specs.formFactor === 'string') {
    const canonical = PHYSICAL_FORM_FACTORS.get(canonicalToken(specs.formFactor, `${path}.specs.formFactor`))
    if (canonical) specs.formFactor = canonical
  }
  if (typeof specs.moduleType === 'string') {
    const token = canonicalToken(specs.moduleType, `${path}.specs.moduleType`)
    if (!ELECTRICAL_MODULE_TYPES.has(token)) {
      throw new Error(`${path}.specs.moduleType is unsupported.`)
    }
    specs.moduleType = token
  }
}

export function migrateSchema28To29(inventoryInput, project, registry, routingCache) {
  assertProjectStoreShape(project, { requireRevision: true })
  assertRegistryStoreShape(registry)
  validateRoutingCache(routingCache)

  const inventory = structuredClone(inventoryInput)
  let migratedSpeeds = 0
  let normalizedRamFormFactors = 0
  let migratedHostMemoryDefinitions = 0

  for (const [index, record] of inventory.ram.entries()) {
    const before = structuredClone(record)
    migrateRam(record, `inventory.ram[${index}]`)
    if (before.specs?.speed !== undefined) migratedSpeeds += 1
    if (before.specs?.formFactor !== record.specs?.formFactor) normalizedRamFormFactors += 1
  }

  for (const table of HOST_TABLES) {
    for (const [index, record] of (inventory[table] ?? []).entries()) {
      const memory = record?.compatibility?.host?.memory
      if (memory === undefined) continue
      const before = JSON.stringify(memory)
      migrateHostMemory(memory, `inventory.${table}[${index}].compatibility.host.memory`)
      if (JSON.stringify(memory) !== before) migratedHostMemoryDefinitions += 1
    }
  }

  assertInventoryStoreShape(inventory)
  assertProjectStoreShape(project, { requireRevision: true })
  assertRegistryStoreShape(registry)
  validateRoutingCache(routingCache)

  return {
    inventory,
    summary: {
      migratedSpeeds,
      normalizedRamFormFactors,
      migratedHostMemoryDefinitions,
      preservedRamRecords: inventory.ram.length,
      preservedAssignments: project.assignments.length,
      preservedPlacements: project.placements.length,
      preservedConnections: project.connections.length,
      preservedRegistryLinks: registry.links.length,
      preservedRoutingEntries: routingCache.entries.length,
    },
  }
}
