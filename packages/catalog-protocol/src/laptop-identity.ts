import { canonicalJson } from './canonicalize'
import { sha256Hex } from './hash'
import { LAPTOP_MEMBER_COLLECTIONS, LAPTOP_RESOURCE_COLLECTIONS, projectLaptopHashValue } from './laptop-v13'
import { normalizeBoardIdentifier, normalizeFingerprintText, normalizeManufacturer, normalizeVariantKey } from './normalization'
import type { CatalogTemplateItem, JsonValue } from './types'

type Obj = Record<string, JsonValue>
const FIELDS: Record<string, string[]> = {
  cpu: ['sockets', 'socketCount'],
  memory: ['slots', 'generations', 'formFactors', 'moduleTypes', 'eccSupport', 'slotsPerCpu'],
  storageSlots: ['key', 'count', 'interfaces', 'formFactors', 'pcieGeneration', 'location', 'hotSwap', 'backplane', 'directConnect', 'controllerSlotIds'],
  expansionSlots: ['key', 'count', 'interfaceFamily', 'pcieGeneration', 'mechanicalLanes', 'electricalLanes', 'acceptedHeights', 'maxSlotWidth', 'proprietaryRiser', 'riserCapability', 'requiredCpuSockets', 'riserGroup'],
  optionalModuleSlots: ['key', 'count', 'interfaceFamily', 'socketKeys', 'moduleSizes', 'availableBuses', 'acceptedModuleKinds'],
  controllerSlots: ['key', 'count', 'acceptedControllerKinds', 'interfaceFamily', 'dedicated', 'requiredCpuSockets'],
  bootDeviceSlots: ['key', 'count', 'acceptedDeviceKinds', 'interfaces', 'formFactors', 'controllerSlotId', 'requiredCpuSockets'],
  coolingProfiles: ['key', 'fanCount', 'redundant', 'conditions'],
  constraintGroups: ['key', 'kind', 'members'],
  power: ['configuration', 'adapterDisposition', 'connector', 'adapterType'],
}
const FIXED_SPECS: Record<string, string[]> = {
  cpu: ['socket', 'generation'],
  ram: ['capacityMib', 'generation', 'formFactor', 'moduleType', 'ecc', 'rank'],
  storage: ['capacityBytes', 'interface', 'formFactor'], gpu: ['vramMib', 'interface', 'formFactor'],
  network: ['networkTechnology', 'formFactor', 'hostInterface'], powerAdapter: ['connector'],
  powerSupply: ['formFactor'], cpuCooler: ['coolerType', 'formFactor', 'mount'], soundCard: ['interface', 'formFactor'],
}
function pick(value: Obj, keys: string[]): Obj {
  return Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, structuredClone(value[key])]))
}

/** Input has passed v13 validation; all relationships resolve by numeric ID, never array position. */
export function projectLaptopTopology(item: CatalogTemplateItem): Obj {
  const host = item.compatibility!.host as Obj
  const topology: Obj = { topologyCompleteness: host.topologyCompleteness ?? 'partial' }
  const specs = pick(item.specs ?? {}, ['formFactor', 'hardwareRevision', 'boardRevision'])
  if (Object.keys(specs).length) topology.specs = specs
  const targets = new Map<string, Map<number, JsonValue>>()
  for (const collection of LAPTOP_RESOURCE_COLLECTIONS) {
    targets.set(collection, new Map(((host[collection] ?? []) as Obj[]).map((resource) => [Number(resource.id), resource.key])))
  }
  for (const [field, fields] of Object.entries(FIELDS)) {
    if (host[field] === undefined) continue
    if (!Array.isArray(host[field])) {
      const projected = pick(host[field] as Obj, fields)
      if (Object.keys(projected).length || Object.keys(host[field] as Obj).length === 0) topology[field] = projected
      continue
    }
    topology[field] = (host[field] as Obj[]).map((resource) => {
      const projected = pick(resource, fields)
      if (field === 'optionalModuleSlots' && resource.interfaceFamily === 'm2-ae') delete projected.acceptedModuleKinds
      if (field === 'storageSlots' && resource.controllerSlotIds !== undefined) projected.controllerSlotIds = (resource.controllerSlotIds as number[]).map((id) => targets.get('controllerSlots')!.get(id)!)
      if (field === 'bootDeviceSlots' && resource.controllerSlotId !== undefined) projected.controllerSlotId = targets.get('controllerSlots')!.get(Number(resource.controllerSlotId))!
      if (field === 'constraintGroups') projected.members = (resource.members as Obj[]).map((member) => ({
        resourceType: member.resourceType,
        resourceKey: targets.get(LAPTOP_MEMBER_COLLECTIONS[String(member.resourceType)])!.get(Number(member.resourceId))!,
      }))
      return projected
    })
  }
  if (item.ports !== undefined) topology.ports = item.ports.filter((port) => port.origin === 'fixed').map((port) => pick(port as unknown as Obj, [
    'key', 'kind', 'type', 'origin', 'speedBps', 'supportedSpeedsBps', 'networkTechnology', 'operatingModes', 'media', 'vendorLock', 'poe',
  ]))
  if (item.fixedComponents !== undefined) topology.fixedComponents = item.fixedComponents.map((component) => {
    const embedded = pick(component.item as unknown as Obj, ['type', 'manufacturer', 'family', 'model', 'number'])
    if (embedded.manufacturer) embedded.manufacturer = normalizeManufacturer(String(embedded.manufacturer))
    if (component.item.specs !== undefined) {
      const specs = pick(component.item.specs, FIXED_SPECS[component.componentType])
      if (Object.keys(specs).length || Object.keys(component.item.specs).length === 0) embedded.specs = specs
    }
    return { componentType: component.componentType, disposition: component.disposition, item: embedded }
  })
  return topology
}

export async function laptopIdentityPayload(item: CatalogTemplateItem): Promise<Obj> {
  const specs = item.specs ?? {}
  const payload: Obj = {
    type: 'laptop', manufacturer: normalizeManufacturer(item.manufacturer!), model: normalizeFingerprintText(item.model!),
    topologySignature: await sha256Hex(`hli:topology:v13:${canonicalJson(projectLaptopHashValue(projectLaptopTopology(item)))}`),
  }
  for (const key of ['motherboardPartNumber', 'motherboardRevision']) {
    if (typeof specs[key] === 'string') payload[key] = normalizeBoardIdentifier(specs[key])
  }
  const variant = specs.boardVariant ?? specs.variantKey
  if (typeof variant === 'string') payload.variantKey = normalizeVariantKey(variant)
  return payload
}
