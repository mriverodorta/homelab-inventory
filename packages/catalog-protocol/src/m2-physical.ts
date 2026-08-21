import { canonicalJson } from './canonicalize'
import { canonicalizeCatalogItemV11, canonicalizeCatalogItemV9 } from './canonical-units'
import { sanitizeCatalogItemV9 } from './sanitize'
import type {
  CatalogComponentBusRequirement,
  CatalogHostBusEvidence,
  CatalogTemplateItem,
  CatalogUsbGenerationV12,
  JsonValue,
} from './types'

type JsonObject = Record<string, JsonValue>

const EMPTY_BUS_EVIDENCE_HASH_VALUE: JsonObject = { evidenceState: 'none' }

export function projectM2PhysicalHashValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(projectM2PhysicalHashValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    key === 'availableBuses' && Array.isArray(entry) && entry.length === 0
      ? EMPTY_BUS_EVIDENCE_HASH_VALUE
      : projectM2PhysicalHashValue(entry),
  ]))
}

export const USB_GENERATIONS_V12 = [
  'USB 1.1',
  'USB 2.0',
  'USB 3.2 Gen 1',
  'USB 3.2 Gen 2',
  'USB 3.2 Gen 2x2',
  'USB4 20Gbps',
  'USB4 40Gbps',
  'USB4 80Gbps',
] as const satisfies readonly CatalogUsbGenerationV12[]

const USB_ALIASES = new Map<string, CatalogUsbGenerationV12>([
  ['1.1', 'USB 1.1'],
  ['USB 1.1', 'USB 1.1'],
  ['2.0', 'USB 2.0'],
  ['USB 2.0', 'USB 2.0'],
  ['USB 3.0', 'USB 3.2 Gen 1'],
  ['USB 3.1 Gen 1', 'USB 3.2 Gen 1'],
  ['USB 3.2 Gen 1', 'USB 3.2 Gen 1'],
  ['USB 3.1 Gen 2', 'USB 3.2 Gen 2'],
  ['USB 3.2 Gen 2', 'USB 3.2 Gen 2'],
  ['USB 3.2 Gen 2x2', 'USB 3.2 Gen 2x2'],
  ['USB 4', 'USB4 20Gbps'],
  ['USB4', 'USB4 20Gbps'],
  ['USB4 20Gbps', 'USB4 20Gbps'],
  ['USB4 40Gbps', 'USB4 40Gbps'],
  ['USB4 80Gbps', 'USB4 80Gbps'],
])

const RESOURCE_COLLECTIONS = [
  'storageSlots',
  'expansionSlots',
  'optionalModuleSlots',
  'controllerSlots',
  'bootDeviceSlots',
  'psuBays',
  'coolingProfiles',
] as const

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path} must be a non-empty string.`)
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ')
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${path} must be a positive safe integer.`)
  return Number(value)
}

function stringArray(value: unknown, path: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new Error(`${path} must be ${allowEmpty ? 'an' : 'a non-empty'} array.`)
  return [...new Set(value.map((entry, index) => text(entry, `${path}[${index}]`)))]
    .sort((left, right) => left.localeCompare(right, 'en-US'))
}

function canonicalModuleKey(value: unknown, path: string): 'A' | 'E' | 'A+E' {
  const normalized = text(value, path).toUpperCase().replace(/[\s/_-]+/g, '+')
  if (normalized === 'E+A') return 'A+E'
  if (normalized === 'A' || normalized === 'E' || normalized === 'A+E') return normalized
  throw new Error(`${path} has unsupported M.2 key ${String(value)}.`)
}

function canonicalSocketKeys(value: unknown, path: string): Array<'A' | 'E'> {
  const keys = stringArray(value, path).map((entry, index) => canonicalModuleKey(entry, `${path}[${index}]`))
  if (keys.some((key) => key === 'A+E')) throw new Error(`${path} must describe physical A-key or E-key host sockets.`)
  return [...new Set(keys as Array<'A' | 'E'>)].sort()
}

export function normalizeUsbGenerationV12(
  value: unknown,
  options: { legacyBoundary?: boolean } = {},
): CatalogUsbGenerationV12 | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  const canonical = USB_ALIASES.get(normalized)
  if (canonical && (options.legacyBoundary || canonical === normalized)) return canonical
  return undefined
}

export function moduleKeyFitsSocketV12(moduleKey: string, socketKey: string): boolean {
  let module: 'A' | 'E' | 'A+E'
  let socket: 'A' | 'E' | 'A+E'
  try {
    module = canonicalModuleKey(moduleKey, 'moduleKey')
    socket = canonicalModuleKey(socketKey, 'socketKey')
  } catch {
    return false
  }
  if (socket === 'A+E') return false
  return module === socket || module === 'A+E'
}

function canonicalHostBuses(value: unknown, path: string): CatalogHostBusEvidence[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`)
  const seen = new Set<string>()
  const buses = value.map((raw, index): CatalogHostBusEvidence => {
    const entry = object(raw)
    if (!entry) throw new Error(`${path}[${index}] must be an object.`)
    const family = text(entry.family, `${path}[${index}].family`).toLowerCase()
    if (seen.has(family)) throw new Error(`${path} contains duplicate family ${family}.`)
    seen.add(family)
    if (family === 'pcie') {
      if (entry.usbGeneration !== undefined || entry.generation !== undefined && typeof entry.generation === 'string') {
        throw new Error(`${path}[${index}] contains USB fields for pcie.`)
      }
      const pcieGeneration = entry.pcieGeneration ?? (typeof entry.generation === 'number' ? entry.generation : undefined)
      return {
        family: 'pcie',
        ...(entry.lanes === undefined ? {} : { lanes: positiveInteger(entry.lanes, `${path}[${index}].lanes`) }),
        ...(pcieGeneration === undefined ? {} : {
          pcieGeneration: positiveInteger(pcieGeneration, `${path}[${index}].pcieGeneration`),
        }),
      }
    }
    if (family === 'usb') {
      if (entry.lanes !== undefined || entry.pcieGeneration !== undefined || typeof entry.generation === 'number') {
        throw new Error(`${path}[${index}] contains lanes or PCIe generation fields for usb.`)
      }
      const generation = normalizeUsbGenerationV12(
        entry.usbGeneration ?? entry.generation,
        { legacyBoundary: true },
      )
      if ((entry.usbGeneration !== undefined || entry.generation !== undefined) && !generation) {
        throw new Error(`${path}[${index}].usbGeneration is unsupported.`)
      }
      return { family: 'usb', ...(generation ? { usbGeneration: generation } : {}) }
    }
    throw new Error(`${path}[${index}].family ${family} is unsupported.`)
  })
  return buses.sort((left, right) => left.family.localeCompare(right.family, 'en-US'))
}

function canonicalRequiredBuses(value: unknown, path: string): CatalogComponentBusRequirement[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${path} must be a non-empty array.`)
  const seen = new Set<string>()
  const buses = value.map((raw, index): CatalogComponentBusRequirement => {
    const entry = object(raw)
    if (!entry) throw new Error(`${path}[${index}] must be an object.`)
    const family = text(entry.family, `${path}[${index}].family`).toLowerCase()
    if (seen.has(family)) throw new Error(`${path} contains duplicate ${family} requirements.`)
    seen.add(family)
    if (family === 'pcie') {
      if (entry.minimumUsbGeneration !== undefined) throw new Error(`${path}[${index}] contains USB fields for pcie.`)
      return {
        family: 'pcie',
        ...(entry.minimumLanes === undefined ? {} : {
          minimumLanes: positiveInteger(entry.minimumLanes, `${path}[${index}].minimumLanes`),
        }),
        ...(entry.minimumPcieGeneration === undefined ? {} : {
          minimumPcieGeneration: positiveInteger(entry.minimumPcieGeneration, `${path}[${index}].minimumPcieGeneration`),
        }),
      }
    }
    if (family === 'usb') {
      if (entry.minimumLanes !== undefined || entry.minimumPcieGeneration !== undefined) {
        throw new Error(`${path}[${index}] contains PCIe fields for usb.`)
      }
      const generation = entry.minimumUsbGeneration === undefined
        ? undefined
        : normalizeUsbGenerationV12(entry.minimumUsbGeneration, { legacyBoundary: true })
      if (entry.minimumUsbGeneration !== undefined && !generation) {
        throw new Error(`${path}[${index}].minimumUsbGeneration is unsupported.`)
      }
      return { family: 'usb', ...(generation ? { minimumUsbGeneration: generation } : {}) }
    }
    throw new Error(`${path}[${index}].family ${family} is unsupported.`)
  })
  return buses.sort((left, right) => left.family.localeCompare(right.family, 'en-US'))
}

function isM2AeResource(resource: JsonObject): boolean {
  const key = typeof resource.key === 'string' ? resource.key.toLowerCase() : ''
  const family = typeof resource.interfaceFamily === 'string' ? resource.interfaceFamily.toLowerCase() : ''
  const label = typeof resource.label === 'string' ? resource.label.toLowerCase() : ''
  return family === 'm2-ae'
    || key === 'wlan-m2'
    || key === 'm2-ae-slot'
    || (/m\.?2/.test(label) && /(wlan|a\/?e|key\s*e)/.test(label))
}

function explicitModuleSizes(resource: JsonObject): string[] | undefined {
  if (resource.moduleSizes !== undefined) return stringArray(resource.moduleSizes, 'moduleSizes')
  if (typeof resource.moduleSize === 'string') return [text(resource.moduleSize, 'moduleSize')]
  const label = typeof resource.label === 'string' ? resource.label : ''
  const sizes = [...label.matchAll(/\b(\d{4})\b/g)].map((match) => match[1]!)
  return sizes.length > 0 ? [...new Set(sizes)].sort() : undefined
}

function legacyBusEvidence(resource: JsonObject): CatalogHostBusEvidence[] | undefined {
  if (Object.hasOwn(resource, 'availableBuses')) return canonicalHostBuses(resource.availableBuses, 'availableBuses')
  const buses: CatalogHostBusEvidence[] = []
  if (resource.pcieGeneration !== undefined || resource.electricalLanes !== undefined) {
    buses.push({
      family: 'pcie',
      ...(resource.electricalLanes === undefined ? {} : { lanes: positiveInteger(resource.electricalLanes, 'electricalLanes') }),
      ...(resource.pcieGeneration === undefined ? {} : { pcieGeneration: positiveInteger(resource.pcieGeneration, 'pcieGeneration') }),
    })
  }
  if (resource.usbGeneration !== undefined) {
    const generation = normalizeUsbGenerationV12(resource.usbGeneration, { legacyBoundary: true })
    // Legacy data may prove the USB family while carrying an unrecognized generation.
    buses.push({ family: 'usb', ...(generation ? { usbGeneration: generation } : {}) })
  }
  return buses.length > 0 ? buses.sort((left, right) => left.family.localeCompare(right.family)) : undefined
}

function canonicalM2Resource(
  resource: JsonObject,
  path: string,
  options: { preserveLabel?: boolean } = {},
): JsonObject {
  const id = positiveInteger(resource.id, `${path}.id`)
  const count = positiveInteger(resource.count, `${path}.count`)
  const originalKey = text(resource.key, `${path}.key`)
  const hasCanonicalShape = originalKey === 'm2-ae-slot'
    && ['keyAliases', 'socketKeys', 'moduleSizes', 'availableBuses', 'intendedModuleKinds']
      .some((field) => Object.hasOwn(resource, field))
  if (originalKey === 'm2-ae-slot' && resource.aliases !== undefined) {
    throw new Error(`${path} must use keyAliases and socketKeys for canonical fingerprint-v12 resources.`)
  }
  const aliases = [
    ...(Array.isArray(resource.keyAliases) ? stringArray(resource.keyAliases, `${path}.keyAliases`, true) : []),
    ...(Array.isArray(resource.aliases) ? stringArray(resource.aliases, `${path}.aliases`, true) : []),
    ...(originalKey === 'm2-ae-slot' ? [] : [originalKey]),
  ].filter((alias) => alias !== 'm2-ae-slot')
  const socketSource = resource.socketKeys ?? resource.acceptedKeys ?? resource.keying
  const socketKeys = socketSource === undefined
    ? undefined
    : canonicalSocketKeys(Array.isArray(socketSource) ? socketSource : [socketSource], `${path}.socketKeys`)
  const moduleSizes = explicitModuleSizes(resource)
  const availableBuses = legacyBusEvidence(resource)
  const intended = resource.intendedModuleKinds ?? resource.acceptedModuleKinds
  const intendedModuleKinds = intended === undefined ? undefined : stringArray(intended, `${path}.intendedModuleKinds`)
  const known = new Set([
    'id', 'key', 'keyAliases', 'aliases', 'count', 'label', 'interfaceFamily', 'socketKeys', 'acceptedKeys',
    'keying', 'moduleSizes', 'moduleSize', 'availableBuses', 'intendedModuleKinds', 'acceptedModuleKinds',
    'pcieGeneration', 'electricalLanes', 'mechanicalLanes', 'usbGeneration',
  ])
  const preserved = Object.fromEntries(Object.entries(resource).filter(([key]) => !known.has(key))) as JsonObject
  return {
    ...preserved,
    id,
    key: 'm2-ae-slot',
    ...(aliases.length > 0 ? { keyAliases: [...new Set(aliases)].sort() } : {}),
    count,
    label: (options.preserveLabel || hasCanonicalShape) && resource.label !== undefined
      ? text(resource.label, `${path}.label`)
      : socketKeys?.length === 1 ? `M.2 Key ${socketKeys[0]} slot` : 'M.2 A/E slot',
    interfaceFamily: 'm2-ae',
    ...(socketKeys ? { socketKeys } : {}),
    ...(moduleSizes ? { moduleSizes } : {}),
    ...(availableBuses !== undefined ? { availableBuses } : {}),
    ...(intendedModuleKinds ? { intendedModuleKinds } : {}),
  }
}

function updateConstraintReferences(host: JsonObject, movedIds: Set<number>): void {
  if (!Array.isArray(host.constraintGroups)) return
  for (const group of host.constraintGroups) {
    const record = object(group)
    if (!record || !Array.isArray(record.members)) continue
    record.members = record.members.map((member) => {
      const reference = object(member)
      if (!reference || reference.resourceType !== 'expansion-slot' || !movedIds.has(Number(reference.resourceId))) return member
      return { ...reference, resourceType: 'optional-module-slot' }
    })
  }
}

function assertHostAliasUniqueness(host: JsonObject): void {
  const keys = new Map<string, string>()
  const aliases: Array<{ key: string, owner: string }> = []
  for (const collection of RESOURCE_COLLECTIONS) {
    if (!Array.isArray(host[collection])) continue
    for (const [index, raw] of host[collection].entries()) {
      const resource = object(raw)
      if (!resource || typeof resource.key !== 'string') continue
      const owner = `${collection}[${index}]`
      const key = text(resource.key, `${owner}.key`).toLowerCase()
      const existing = keys.get(key)
      if (existing && existing !== owner) {
        throw new Error(`Resource key ${key} conflicts between ${existing} and ${owner}; the mapping is ambiguous.`)
      }
      keys.set(key, owner)
      for (const value of Array.isArray(resource.keyAliases) ? resource.keyAliases : []) {
        aliases.push({ key: text(value, `${owner}.keyAliases`).toLowerCase(), owner })
      }
    }
  }

  const aliasOwners = new Map<string, string>()
  for (const alias of aliases) {
    const keyOwner = keys.get(alias.key)
    if (keyOwner) {
      throw new Error(`Resource alias ${alias.key} conflicts between ${keyOwner} and ${alias.owner}; the mapping is ambiguous.`)
    }
    const aliasOwner = aliasOwners.get(alias.key)
    if (aliasOwner && aliasOwner !== alias.owner) {
      throw new Error(`Resource alias ${alias.key} conflicts between ${aliasOwner} and ${alias.owner}; the mapping is ambiguous.`)
    }
    aliasOwners.set(alias.key, alias.owner)
  }
}

function assertCollectionIdUniqueness(host: JsonObject): void {
  for (const collection of RESOURCE_COLLECTIONS) {
    if (!Array.isArray(host[collection])) continue
    const ids = new Set<number>()
    for (const [index, raw] of host[collection].entries()) {
      const resource = object(raw)
      if (!resource || resource.id === undefined) continue
      const id = positiveInteger(resource.id, `compatibility.host.${collection}[${index}].id`)
      if (ids.has(id)) throw new Error(`Host resource id ${id} is duplicated in ${collection}.`)
      ids.add(id)
    }
  }
}

function sortResourceCollections(host: JsonObject): void {
  for (const collection of RESOURCE_COLLECTIONS) {
    if (!Array.isArray(host[collection])) continue
    host[collection] = [...host[collection]].sort((left, right) => {
      const leftResource = object(left)
      const rightResource = object(right)
      const leftId = typeof leftResource?.id === 'number' ? leftResource.id : Number.MAX_SAFE_INTEGER
      const rightId = typeof rightResource?.id === 'number' ? rightResource.id : Number.MAX_SAFE_INTEGER
      if (leftId !== rightId) return leftId - rightId
      const leftKey = typeof leftResource?.key === 'string' ? leftResource.key : canonicalJson(left)
      const rightKey = typeof rightResource?.key === 'string' ? rightResource.key : canonicalJson(right)
      return leftKey.localeCompare(rightKey, 'en-US')
    })
  }
}

function canonicalizeHostV12(value: unknown, options: { migrateLegacyResources: boolean }): CatalogTemplateItem {
  const item = canonicalizeCatalogItemV9(value)
  const compatibility = object(item.compatibility)
  const host = object(compatibility?.host)
  if (!compatibility || !host) throw new Error('Fingerprint-v12 host templates require compatibility.host.')
  const optional = Array.isArray(host.optionalModuleSlots) ? host.optionalModuleSlots : []
  const expansion = Array.isArray(host.expansionSlots) ? host.expansionSlots : []
  const movedIds = new Set<number>()
  const canonicalOptional: JsonValue[] = []
  let affected = 0

  for (const [index, raw] of optional.entries()) {
    const resource = object(raw)
    if (!resource || !isM2AeResource(resource)) {
      canonicalOptional.push(raw)
      continue
    }
    canonicalOptional.push(canonicalM2Resource(
      resource,
      `compatibility.host.optionalModuleSlots[${index}]`,
      { preserveLabel: !options.migrateLegacyResources },
    ))
    affected += 1
  }

  const remainingExpansion: JsonValue[] = []
  for (const [index, raw] of expansion.entries()) {
    const resource = object(raw)
    if (!options.migrateLegacyResources || !resource || !isM2AeResource(resource)) {
      remainingExpansion.push(raw)
      continue
    }
    const canonical = canonicalM2Resource(resource, `compatibility.host.expansionSlots[${index}]`)
    const id = Number(canonical.id)
    if (canonicalOptional.some((entry) => Number(object(entry)?.id) === id)) {
      throw new Error(`M.2 A/E resource id ${id} collides across host resource collections.`)
    }
    canonicalOptional.push(canonical)
    movedIds.add(id)
    affected += 1
  }
  if (options.migrateLegacyResources && affected === 0) {
    throw new Error('Fingerprint-v12 host template has no physical M.2 A/E resource.')
  }

  if (Array.isArray(host.optionalModuleSlots) || canonicalOptional.length > 0) host.optionalModuleSlots = canonicalOptional
  if (Array.isArray(host.expansionSlots)) host.expansionSlots = remainingExpansion
  updateConstraintReferences(host, movedIds)
  assertCollectionIdUniqueness(host)
  assertHostAliasUniqueness(host)
  sortResourceCollections(host)
  compatibility.host = host
  item.compatibility = compatibility
  return sanitizeCatalogItemV9(item)
}

function canonicalizeNetworkV12(value: unknown): CatalogTemplateItem {
  const source = sanitizeCatalogItemV9(value)
  const specs = object(source.specs)
  const sourceInterface = object(specs?.hostInterface)
  if (!specs || !sourceInterface || sourceInterface.family !== 'm2-ae') {
    throw new Error('Fingerprint-v12 network templates require an M.2 A/E host interface.')
  }
  const compatibility = object(source.compatibility)
  const requirements = object(compatibility?.requirements)
  const expansion = object(requirements?.expansion)
  const interfaceRequirements = sourceInterface.requiredBuses
  const compatibilityRequirements = expansion?.requiredBuses
  if (interfaceRequirements === undefined && compatibilityRequirements !== undefined) {
    throw new Error('compatibility.requirements.expansion.requiredBuses requires specs.hostInterface.requiredBuses.')
  }
  const normalizedRequirements = interfaceRequirements === undefined
    ? undefined
    : canonicalRequiredBuses(interfaceRequirements, 'specs.hostInterface.requiredBuses')
  if (compatibilityRequirements !== undefined
    && canonicalJson(canonicalRequiredBuses(compatibilityRequirements, 'compatibility.requirements.expansion.requiredBuses'))
      !== canonicalJson(normalizedRequirements)) {
    throw new Error('Component requiredBuses conflict between hostInterface and compatibility requirements.')
  }

  const baseInput = structuredClone(source) as CatalogTemplateItem
  const baseSpecs = object(baseInput.specs)!
  const baseInterface = object(baseSpecs.hostInterface)!
  delete baseInterface.requiredBuses
  const baseCompatibility = object(baseInput.compatibility)
  const baseRequirements = object(baseCompatibility?.requirements)
  const baseExpansion = object(baseRequirements?.expansion)
  if (baseExpansion) delete baseExpansion.requiredBuses
  const item = canonicalizeCatalogItemV11(baseInput)
  const itemSpecs = object(item.specs)!
  const hostInterface = object(itemSpecs.hostInterface)!
  hostInterface.key = canonicalModuleKey(hostInterface.key, 'specs.hostInterface.key')
  if (normalizedRequirements) hostInterface.requiredBuses = normalizedRequirements as unknown as JsonValue
  itemSpecs.hostInterface = hostInterface
  item.specs = itemSpecs
  const itemCompatibility = object(item.compatibility) ?? {}
  const itemRequirements = object(itemCompatibility.requirements) ?? {}
  const itemExpansion = object(itemRequirements.expansion) ?? {}
  itemExpansion.key = hostInterface.key
  if (normalizedRequirements) itemExpansion.requiredBuses = normalizedRequirements as unknown as JsonValue
  itemRequirements.expansion = itemExpansion
  itemCompatibility.requirements = itemRequirements
  item.compatibility = itemCompatibility
  return sanitizeCatalogItemV9(item)
}

export function canonicalizeCatalogItemV12(value: unknown): CatalogTemplateItem {
  const source = sanitizeCatalogItemV9(value)
  return source.type === 'network'
    ? canonicalizeNetworkV12(source)
    : canonicalizeHostV12(source, { migrateLegacyResources: true })
}

export function canonicalizeCatalogItemV12UpdateCurrent(value: unknown): CatalogTemplateItem {
  const source = sanitizeCatalogItemV9(value)
  return source.type === 'network'
    ? canonicalizeNetworkV12(source)
    : canonicalizeHostV12(source, { migrateLegacyResources: false })
}

export function assertCanonicalCatalogItemV12(value: unknown): void {
  const canonical = canonicalizeCatalogItemV12(value)
  if (canonicalJson(canonical) !== canonicalJson(sanitizeCatalogItemV9(value))) {
    throw new Error('Fingerprint-v12 item is not in canonical form.')
  }
}
