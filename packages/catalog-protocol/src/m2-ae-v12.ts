import { canonicalizeCatalogItemV11, canonicalizeCatalogItemV9, CanonicalMeasurementError, CANONICAL_MEASUREMENT_INVALID } from './canonical-units'
import { sanitizeCatalogItemV9 } from './sanitize'
import {
  canonicalModuleKey,
  normalizeUsbGenerationV12,
} from './m2-ae-compatibility'
import type {
  CatalogAvailableBus,
  CatalogRequiredBus,
  CatalogTemplateItem,
  JsonValue,
} from './types'

export {
  USB_GENERATIONS_V12,
  canonicalModuleKey,
  moduleKeyFitsSocket,
  normalizeUsbGenerationV12,
  usbGenerationAtLeastV12,
} from './m2-ae-compatibility'

type JsonObject = Record<string, JsonValue>

function error(path: string, message: string): never {
  throw new CanonicalMeasurementError(CANONICAL_MEASUREMENT_INVALID, path, message)
}

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') error(path, `${path} is required.`)
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ')
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) error(path, `${path} must be a positive safe integer.`)
  return Number(value)
}

function optionalStrings(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) error(path, `${path} must be an array.`)
  return [...new Set(value.map((entry, index) => text(entry, `${path}[${index}]`)))]
    .sort((left, right) => left.localeCompare(right, 'en-US'))
}

function canonicalAvailableBuses(value: unknown, path: string): CatalogAvailableBus[] {
  if (!Array.isArray(value)) error(path, `${path} must be an array.`)
  const families = new Set<string>()
  const buses = value.map((entry, index) => {
    const bus = object(entry)
    const busPath = `${path}[${index}]`
    if (!bus) error(busPath, `${busPath} must be an object.`)
    const family = text(bus.family, `${busPath}.family`).toLowerCase()
    if (family !== 'pcie' && family !== 'usb') error(`${busPath}.family`, `${busPath}.family is unsupported.`)
    if (families.has(family)) error(`${busPath}.family`, `${path} contains duplicate family ${family}.`)
    families.add(family)
    if (family === 'pcie') {
      if (bus.usbGeneration !== undefined) error(`${busPath}.usbGeneration`, 'PCIe bus evidence cannot declare a USB generation.')
      return {
        family,
        ...(bus.lanes === undefined ? {} : { lanes: positiveInteger(bus.lanes, `${busPath}.lanes`) }),
        ...(bus.pcieGeneration === undefined ? {} : {
          pcieGeneration: positiveInteger(bus.pcieGeneration, `${busPath}.pcieGeneration`),
        }),
      } satisfies CatalogAvailableBus
    }
    if (bus.lanes !== undefined || bus.pcieGeneration !== undefined) {
      error(busPath, 'USB bus evidence cannot declare PCIe lanes or generation.')
    }
    const generation = bus.usbGeneration === undefined
      ? undefined
      : normalizeUsbGenerationV12(bus.usbGeneration)
    if (bus.usbGeneration !== undefined && !generation) {
      error(`${busPath}.usbGeneration`, `${busPath}.usbGeneration is not canonical v12 USB evidence.`)
    }
    return { family, ...(generation ? { usbGeneration: generation } : {}) } satisfies CatalogAvailableBus
  })
  return buses.sort((left, right) => left.family.localeCompare(right.family, 'en-US'))
}

function canonicalRequiredBuses(value: unknown, path: string): CatalogRequiredBus[] {
  if (!Array.isArray(value)) error(path, `${path} must be an array.`)
  const families = new Set<string>()
  const buses = value.map((entry, index) => {
    const bus = object(entry)
    const busPath = `${path}[${index}]`
    if (!bus) error(busPath, `${busPath} must be an object.`)
    const family = text(bus.family, `${busPath}.family`).toLowerCase()
    if (family !== 'pcie' && family !== 'usb') error(`${busPath}.family`, `${busPath}.family is unsupported.`)
    if (families.has(family)) error(`${busPath}.family`, `${path} contains duplicate family ${family}.`)
    families.add(family)
    if (family === 'pcie') {
      if (bus.minimumUsbGeneration !== undefined) error(`${busPath}.minimumUsbGeneration`, 'PCIe requirements cannot declare a USB generation.')
      return {
        family,
        ...(bus.minimumLanes === undefined ? {} : {
          minimumLanes: positiveInteger(bus.minimumLanes, `${busPath}.minimumLanes`),
        }),
        ...(bus.minimumPcieGeneration === undefined ? {} : {
          minimumPcieGeneration: positiveInteger(bus.minimumPcieGeneration, `${busPath}.minimumPcieGeneration`),
        }),
      } satisfies CatalogRequiredBus
    }
    if (bus.minimumLanes !== undefined || bus.minimumPcieGeneration !== undefined) {
      error(busPath, 'USB requirements cannot declare PCIe lanes or generation.')
    }
    const generation = bus.minimumUsbGeneration === undefined
      ? undefined
      : normalizeUsbGenerationV12(bus.minimumUsbGeneration)
    if (bus.minimumUsbGeneration !== undefined && !generation) {
      error(`${busPath}.minimumUsbGeneration`, `${busPath}.minimumUsbGeneration is not canonical v12 USB evidence.`)
    }
    return { family, ...(generation ? { minimumUsbGeneration: generation } : {}) } satisfies CatalogRequiredBus
  })
  return buses.sort((left, right) => left.family.localeCompare(right.family, 'en-US'))
}

function canonicalOptionalModuleResources(item: CatalogTemplateItem): void {
  const host = object(object(item.compatibility)?.host)
  const resources = host?.optionalModuleSlots
  if (resources === undefined) return
  if (!Array.isArray(resources)) error('compatibility.host.optionalModuleSlots', 'Optional module slots must be an array.')
  resources.forEach((entry, index) => {
    const resource = object(entry)
    const path = `compatibility.host.optionalModuleSlots[${index}]`
    if (!resource) error(path, `${path} must be an object.`)
    resource.id = positiveInteger(resource.id, `${path}.id`)
    resource.count = positiveInteger(resource.count, `${path}.count`)
    resource.key = text(resource.key, `${path}.key`)
    resource.label = text(resource.label, `${path}.label`)
    if (resource.aliases !== undefined || resource.acceptedKeys !== undefined) {
      error(path, 'Fingerprint-v12 resources must use keyAliases and socketKeys.')
    }
    if (resource.keyAliases !== undefined) resource.keyAliases = optionalStrings(resource.keyAliases, `${path}.keyAliases`)
    if (resource.socketKeys !== undefined) {
      const socketKeys = optionalStrings(resource.socketKeys, `${path}.socketKeys`).map((key, keyIndex) => {
        const canonical = canonicalModuleKey(key)
        if (!canonical || canonical === 'A+E') error(`${path}.socketKeys[${keyIndex}]`, 'Host socket keys must be A or E.')
        return canonical
      })
      resource.socketKeys = [...new Set(socketKeys)].sort()
    }
    if (resource.moduleSizes !== undefined) resource.moduleSizes = optionalStrings(resource.moduleSizes, `${path}.moduleSizes`)
    if (resource.intendedModuleKinds !== undefined) {
      resource.intendedModuleKinds = optionalStrings(resource.intendedModuleKinds, `${path}.intendedModuleKinds`)
    }
    if (Object.hasOwn(resource, 'availableBuses')) {
      resource.availableBuses = canonicalAvailableBuses(resource.availableBuses, `${path}.availableBuses`) as unknown as JsonValue
    }
    if (resource.interfaceFamily === 'm2-ae' && resource.acceptedModuleKinds !== undefined) {
      error(`${path}.acceptedModuleKinds`, 'Fingerprint-v12 M.2 A/E resources must use descriptive intendedModuleKinds.')
    }
  })
}

const HOST_RESOURCE_COLLECTIONS = [
  'storageSlots',
  'expansionSlots',
  'optionalModuleSlots',
  'controllerSlots',
  'bootDeviceSlots',
  'psuBays',
] as const

function validateHostResourceAliases(item: CatalogTemplateItem): void {
  const host = object(object(item.compatibility)?.host)
  if (!host) return
  const keys = new Map<string, string>()
  const aliasEntries: Array<{ alias: string; path: string }> = []
  for (const collection of HOST_RESOURCE_COLLECTIONS) {
    const resources = host[collection]
    if (resources === undefined) continue
    if (!Array.isArray(resources)) continue
    for (const [index, entry] of resources.entries()) {
      const resource = object(entry)
      if (!resource || typeof resource.key !== 'string') continue
      const path = `compatibility.host.${collection}[${index}]`
      const previous = keys.get(resource.key)
      if (previous) error(`${path}.key`, `Resource key ${resource.key} conflicts with ${previous}.`)
      keys.set(resource.key, `${path}.key`)
      for (const alias of (resource.keyAliases as string[] | undefined) ?? []) {
        aliasEntries.push({ alias, path: `${path}.keyAliases` })
      }
    }
  }
  const aliases = new Map<string, string>()
  for (const entry of aliasEntries) {
    const keyPath = keys.get(entry.alias)
    if (keyPath) error(entry.path, `Resource alias ${entry.alias} conflicts with ${keyPath}.`)
    const aliasPath = aliases.get(entry.alias)
    if (aliasPath) error(entry.path, `Resource alias ${entry.alias} conflicts with ${aliasPath}.`)
    aliases.set(entry.alias, entry.path)
  }
}

function canonicalComponentRequirements(item: CatalogTemplateItem): void {
  const specs = object(item.specs)
  const hostInterface = object(specs?.hostInterface)
  if (!hostInterface) return
  if (hostInterface.family === 'm2-ae') {
    const key = canonicalModuleKey(hostInterface.key)
    if (!key) error('specs.hostInterface.key', 'M.2 A/E component key must be A, E, or A+E.')
    hostInterface.key = key
  }
  if (hostInterface.requiredBuses !== undefined) {
    hostInterface.requiredBuses = canonicalRequiredBuses(
      hostInterface.requiredBuses,
      'specs.hostInterface.requiredBuses',
    ) as unknown as JsonValue
  }
  const compatibility = object(item.compatibility) ?? {}
  const requirements = object(compatibility.requirements) ?? {}
  const expansion = object(requirements.expansion) ?? {}
  if (expansion.requiredBuses !== undefined && JSON.stringify(expansion.requiredBuses) !== JSON.stringify(hostInterface.requiredBuses)) {
    error('compatibility.requirements.expansion.requiredBuses', 'Expansion requiredBuses conflict with specs.hostInterface.requiredBuses.')
  }
  if (hostInterface.requiredBuses !== undefined) expansion.requiredBuses = structuredClone(hostInterface.requiredBuses)
  if (hostInterface.key !== undefined) expansion.key = hostInterface.key
  requirements.expansion = expansion
  compatibility.requirements = requirements
  item.compatibility = compatibility
}

export function canonicalizeCatalogItemV12(value: unknown): CatalogTemplateItem {
  const source = value as Record<string, unknown>
  const base = source?.type === 'network'
    ? canonicalizeCatalogItemV11(value)
    : canonicalizeCatalogItemV9(value)
  const item = sanitizeCatalogItemV9(base)
  canonicalOptionalModuleResources(item)
  validateHostResourceAliases(item)
  canonicalComponentRequirements(item)
  return sanitizeCatalogItemV9(item)
}

export function assertCanonicalCatalogItemV12(value: unknown): void {
  canonicalizeCatalogItemV12(value)
}

export function withoutV12IdentityNeutralFields(item: CatalogTemplateItem): CatalogTemplateItem {
  const result = structuredClone(item)
  const host = object(object(result.compatibility)?.host)
  if (Array.isArray(host?.optionalModuleSlots)) {
    for (const entry of host.optionalModuleSlots) {
      const resource = object(entry)
      if (!resource) continue
      delete resource.keyAliases
      delete resource.intendedModuleKinds
    }
  }
  return result
}
