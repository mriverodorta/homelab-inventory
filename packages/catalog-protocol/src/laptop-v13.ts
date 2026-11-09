import { canonicalJson } from './canonicalize'
import { canonicalizeCatalogItemV10, legacyMeasurementPathsV9 } from './canonical-units'
import { assertPhysicalM2Resource, canonicalizeCatalogItemV12 } from './m2-physical'
import { normalizeFingerprintText, normalizeText } from './normalization'
import { sanitizeCatalogItemV13, stripPrivateCatalogDataV13 } from './sanitize'
import type { CatalogTemplateItem, JsonValue } from './types'

type Obj = Record<string, JsonValue>
export const LAPTOP_RESOURCE_COLLECTIONS = [
  'storageSlots', 'expansionSlots', 'optionalModuleSlots', 'controllerSlots',
  'bootDeviceSlots', 'coolingProfiles', 'constraintGroups',
] as const
export const LAPTOP_MEMBER_COLLECTIONS: Record<string, string> = {
  'storage-slot': 'storageSlots', 'expansion-slot': 'expansionSlots',
  'optional-module-slot': 'optionalModuleSlots', 'controller-slot': 'controllerSlots',
  'boot-device-slot': 'bootDeviceSlots', 'cooling-profile': 'coolingProfiles',
}
const FIXED_TYPES = new Set(['cpu', 'ram', 'storage', 'gpu', 'network', 'powerAdapter', 'powerSupply', 'cpuCooler', 'soundCard'])
const STRING_ARRAYS = new Set([
  'sockets', 'generations', 'formFactors', 'moduleTypes', 'interfaces', 'acceptedHeights',
  'socketKeys', 'moduleSizes', 'acceptedModuleKinds', 'intendedModuleKinds', 'keyAliases',
  'acceptedControllerKinds', 'acceptedDeviceKinds', 'operatingModes', 'media', 'aliases', 'conditions',
])
const INTEGER_FIELDS = new Set([
  'slots', 'socketCount', 'slotsPerCpu', 'requiredCpuSockets', 'fanCount', 'mechanicalLanes',
  'electricalLanes', 'pcieGeneration', 'lanes', 'maxSpeedMt', 'speedMt', 'maxSlotWidth', 'slotNumber',
])
const BOOLEAN_FIELDS = new Set(['ecc', 'hotSwap', 'directConnect', 'proprietaryRiser', 'dedicated', 'redundant', 'adapterRequired', 'vendorLock', 'poe'])
const MEASUREMENT = /(?:Mhz|Mib|Bytes|Bps|Mw|Mv|Ma|Mm|MilliCelsius|BasisPoints|Millihz|MillivoltAmps)$/

function fail(path: string, message: string): never { throw new Error(`Fingerprint-v13 ${path}: ${message}`) }
function object(value: unknown, path: string): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object.')
  return value as Obj
}
function array(value: unknown, path: string): JsonValue[] {
  if (!Array.isArray(value)) fail(path, 'must be an array.')
  return value
}
function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || !normalizeText(value) || value.length > 256) fail(path, 'must be non-empty text.')
  return normalizeText(value)
}
function integer(value: unknown, path: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) fail(path, `must be a safe integer >= ${min}.`)
  return value
}

/** Hash-only markers preserve empty evidence; these never enter canonical items. */
export function projectLaptopHashValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.length ? value.map(projectLaptopHashValue) : { $hliV13Evidence: 'empty-array' }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
    return entries.length ? Object.fromEntries(entries.map(([key, entry]) => [key, projectLaptopHashValue(entry)])) : { $hliV13Evidence: 'empty-object' }
  }
  return value
}

function assertJson(value: unknown, path = '', depth = 0): void {
  if (depth > 10) fail(path, 'exceeds maximum evidence depth.')
  if (value === null || value === undefined) fail(path, 'null/undefined evidence is not supported; omit unknown fields.')
  if (typeof value === 'string') { text(value, path); return }
  if (typeof value === 'boolean') return
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail(path, 'must be finite.'); return }
  if (Array.isArray(value)) {
    if (value.length > 256) fail(path, 'too many values.')
    value.forEach((entry, index) => assertJson(entry, `${path}[${index}]`, depth + 1))
    return
  }
  const record = object(value, path)
  if (Object.keys(record).length > 256) fail(path, 'too many fields.')
  for (const [key, entry] of Object.entries(record)) {
    const next = `${path}.${key}`
    if (normalizeFingerprintText(key) === '$hliv13evidence') fail(next, 'reserved hash marker.')
    if (MEASUREMENT.test(key)) {
      if (Array.isArray(entry)) entry.forEach((n) => integer(n, next))
      else integer(entry, next)
    }
    if (INTEGER_FIELDS.has(key)) integer(entry, next)
    if (BOOLEAN_FIELDS.has(key) && typeof entry !== 'boolean') fail(next, 'must be boolean.')
    if (STRING_ARRAYS.has(key)) array(entry, next).forEach((s) => text(s, next))
    assertJson(entry, next, depth + 1)
  }
}

function validateGraph(host: Obj): void {
  const targets = new Map<string, Map<number, string>>()
  for (const collection of LAPTOP_RESOURCE_COLLECTIONS) {
    const keys = new Set<string>()
    const aliases: string[] = []
    const ids = new Map<number, string>()
    targets.set(collection, ids)
    if (host[collection] === undefined) continue
    for (const raw of array(host[collection], collection)) {
      const resource = object(raw, collection)
      const id = integer(resource.id, `${collection}.id`, 1)
      const key = normalizeFingerprintText(text(resource.key, `${collection}.key`))
      if (ids.has(id) || keys.has(key)) fail(collection, 'duplicate resource ID or ambiguous semantic key.')
      ids.set(id, key)
      keys.add(key)
      if (!['coolingProfiles', 'constraintGroups'].includes(collection)) integer(resource.count, `${collection}.count`, 1)
      for (const alias of array(resource.keyAliases ?? [], `${collection}.keyAliases`)) aliases.push(normalizeFingerprintText(text(alias, 'keyAliases')))
      for (const field of Object.keys(resource)) {
        if (/(?:Ids?|Refs?|References?)$/.test(field) && field !== 'id'
          && !(collection === 'storageSlots' && field === 'controllerSlotIds')
          && !(collection === 'bootDeviceSlots' && field === 'controllerSlotId')) fail(`${collection}.${field}`, 'unsupported relationship field.')
      }
      if (collection === 'optionalModuleSlots' && resource.interfaceFamily === 'm2-ae') assertPhysicalM2Resource(resource)
      if (collection === 'expansionSlots' && resource.interfaceFamily === 'm2-ae') fail(collection, 'physical M.2 A/E belongs in optionalModuleSlots.')
    }
    if (new Set(aliases).size !== aliases.length || aliases.some((alias) => keys.has(alias))) fail('keyAliases', 'ambiguous semantic alias.')
  }
  const resolve = (collection: string, raw: JsonValue) => {
    const id = integer(raw, `${collection} reference`, 1)
    if (!targets.get(collection)?.has(id)) fail(collection, 'dangling resource reference.')
    return id
  }
  for (const raw of array(host.storageSlots ?? [], 'storageSlots')) {
    const resource = object(raw, 'storageSlots')
    if (resource.controllerSlotIds === undefined) continue
    const ids = array(resource.controllerSlotIds, 'controllerSlotIds').map((id) => resolve('controllerSlots', id))
    if (new Set(ids).size !== ids.length) fail('controllerSlotIds', 'duplicate reference.')
  }
  for (const raw of array(host.bootDeviceSlots ?? [], 'bootDeviceSlots')) {
    const resource = object(raw, 'bootDeviceSlots')
    if (resource.controllerSlotId !== undefined) resolve('controllerSlots', resource.controllerSlotId)
  }
  for (const raw of array(host.constraintGroups ?? [], 'constraintGroups')) {
    const resource = object(raw, 'constraintGroups')
    text(resource.kind, 'constraintGroups.kind')
    const seen = new Set<string>()
    for (const rawMember of array(resource.members, 'constraintGroups.members')) {
      const member = object(rawMember, 'constraint member')
      if (Object.keys(member).some((key) => !['resourceType', 'resourceId'].includes(key))) fail('constraint member', 'unsupported relationship field.')
      const type = text(member.resourceType, 'resourceType')
      const collection = LAPTOP_MEMBER_COLLECTIONS[type]
      if (!collection) fail('resourceType', 'unsupported resource type.')
      const id = resolve(collection, member.resourceId)
      const ref = `${type}:${id}`
      if (seen.has(ref)) fail('members', 'duplicate reference.')
      seen.add(ref)
    }
  }
}

function validateLaptop(source: Obj): void {
  if (source.type !== 'laptop') fail('type', 'must be laptop.')
  text(source.manufacturer, 'manufacturer')
  text(source.model, 'model')
  const host = object(object(source.compatibility, 'compatibility').host, 'compatibility.host')
  if (source.specs !== undefined) object(source.specs, 'specs')
  if (host.topologyCompleteness !== undefined && !['complete', 'partial', 'conflicting'].includes(String(host.topologyCompleteness))) fail('topologyCompleteness', 'invalid value.')
  if (host.fixedPorts !== undefined && array(host.fixedPorts, 'fixedPorts').length) fail('fixedPorts', 'use item.ports as the only fixed-port source.')
  for (const field of ['cpu', 'memory', 'power']) if (host[field] !== undefined) object(host[field], field)
  validateGraph(host)
  const fixed = array(source.fixedComponents ?? [], 'fixedComponents')
  const ids = new Set<number>()
  let fixedMemory = 0
  for (const raw of fixed) {
    const component = object(raw, 'fixedComponents')
    const id = integer(component.id, 'fixedComponents.id', 1)
    if (ids.has(id)) fail('fixedComponents', 'duplicate ID.')
    ids.add(id)
    const type = text(component.componentType, 'componentType')
    if (!FIXED_TYPES.has(type)) fail('componentType', 'unsupported fixed hardware.')
    if (!['fixed', 'soldered'].includes(String(component.disposition))) fail('disposition', 'must be fixed or soldered.')
    const item = object(component.item, 'fixedComponents.item')
    const specs = item.specs === undefined ? {} : object(item.specs, 'fixed specs')
    if (item.type !== type) fail('fixedComponents.item.type', 'must match componentType.')
    if (item.fixedComponents !== undefined || (item.compatibility && object(item.compatibility, 'fixed compatibility').host !== undefined)) fail('fixedComponents.item', 'recursive host hardware is not supported.')
    if (!item.model && !item.number && !(type === 'ram' && typeof specs.capacityMib === 'number' && specs.capacityMib > 0 && typeof specs.generation === 'string')) fail('fixedComponents.item', 'requires model/number or known RAM capacity and generation.')
    if (type === 'ram' && specs.capacityMib !== undefined) fixedMemory += integer(specs.capacityMib, 'fixed RAM capacityMib', 1)
    if (type === 'network' && specs.hostInterface && object(specs.hostInterface, 'hostInterface').family === 'm2-ae') canonicalizeCatalogItemV12(item)
  }
  const memory = host.memory === undefined ? {} : object(host.memory, 'memory')
  if (memory.eccSupport !== undefined && !['supported', 'unsupported', 'required', 'conditional'].includes(String(memory.eccSupport))) fail('memory.eccSupport', 'invalid ECC support.')
  if (!Number.isSafeInteger(fixedMemory)) fail('fixedComponents', 'RAM subtotal exceeds safe integer range.')
  for (const prefix of ['', 'oem', 'verified']) {
    const totalKey = prefix ? `${prefix}MaxCapacityMib` : 'maxCapacityMib'
    const moduleKey = prefix ? `${prefix}MaxModuleCapacityMib` : 'maxModuleCapacityMib'
    if (memory.slots === 0 && memory[moduleKey] !== undefined) fail(`memory.${moduleKey}`, 'zero replaceable slots cannot declare a module maximum.')
    if (memory[totalKey] !== undefined && Number(memory[totalKey]) < fixedMemory) fail(`memory.${totalKey}`, 'cannot be below fixed RAM capacity.')
  }
  if (host.power !== undefined) {
    const power = object(host.power, 'power')
    if (!['internal-psu', 'external-adapter'].includes(String(power.configuration))) fail('power.configuration', 'must be explicit.')
    if (power.configuration === 'internal-psu' && power.adapterDisposition !== undefined) fail('power.adapterDisposition', 'must be absent for internal PSU.')
    if (power.configuration === 'external-adapter' && !['fixed', 'replaceable'].includes(String(power.adapterDisposition))) fail('power.adapterDisposition', 'external adapter must declare fixed or replaceable.')
  }
  const portIds = new Set<number>()
  for (const raw of array(source.ports ?? [], 'ports')) {
    const port = object(raw, 'port')
    const id = integer(port.id, 'port.id', 1)
    if (portIds.has(id)) fail('ports', 'duplicate ID.')
    portIds.add(id)
    integer(port.slotNumber, 'port.slotNumber')
    text(port.kind, 'port.kind'); text(port.type, 'port.type')
    if (port.origin !== 'fixed') fail('port.origin', 'laptop template ports must be explicitly fixed.')
    const endpointIds = new Set<number>()
    for (const rawEndpoint of array(port.endpoints ?? [], 'port.endpoints')) {
      const endpoint = object(rawEndpoint, 'endpoint')
      const endpointId = integer(endpoint.id, 'endpoint.id', 1)
      if (endpointIds.has(endpointId) || !['front', 'back'].includes(String(endpoint.side))) fail('endpoint', 'duplicate ID or invalid side.')
      endpointIds.add(endpointId)
    }
  }
  const capabilities = ['cpu', 'memory', 'power', ...LAPTOP_RESOURCE_COLLECTIONS]
  if (!fixed.length && !capabilities.some((key) => host[key] !== undefined && (Array.isArray(host[key]) || Object.keys(host[key] as Obj).length > 0))) fail('host', 'requires material capability evidence or fixed hardware.')
}

export function canonicalizeCatalogItemV13(value: unknown): CatalogTemplateItem {
  const source = object(stripPrivateCatalogDataV13(value), 'item')
  assertJson(source)
  const legacy = legacyMeasurementPathsV9(source)
  if (legacy.length) fail(legacy[0], 'legacy units are not canonical.')
  validateLaptop(source)
  // Validate fixed records with the existing contract; use only the v13 sanitizer's output.
  canonicalizeCatalogItemV10(source)
  const item = sanitizeCatalogItemV13(source)
  item.name = `${item.manufacturer} ${item.model}`
  validateLaptop(item as unknown as Obj)
  return item
}

export function assertCanonicalCatalogItemV13(value: unknown): void {
  const item = canonicalizeCatalogItemV13(value)
  const supplied = sanitizeCatalogItemV13(value)
  if (canonicalJson(projectLaptopHashValue(item as unknown as JsonValue)) !== canonicalJson(projectLaptopHashValue(supplied as unknown as JsonValue))) fail('item', 'is not canonical.')
}
