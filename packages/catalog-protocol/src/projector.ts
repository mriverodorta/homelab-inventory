import { canonicalJson } from './canonicalize'
import { canonicalizeCatalogItemV10, canonicalizeCatalogItemV11, canonicalizeCatalogItemV9 } from './canonical-units'
import { canonicalizeCatalogItemV12, projectM2PhysicalHashValue } from './m2-ae-v12'
import { computeCatalogDigestsWithIdentity, sha256Hex } from './hash'
import { normalizeBoardIdentifier, normalizeText, normalizeVariantKey } from './normalization'
import { sanitizeCatalogItem } from './sanitize'
import type {
  CatalogEligibilityReason,
  CatalogProductFamily,
  CatalogProjection,
  CatalogSourceRef,
  CatalogTemplateItem,
  CatalogVariantEvidence,
  FingerprintVersion,
  JsonValue,
} from './types'
import {
  FINGERPRINT_VERSION,
  LEGACY_FINGERPRINT_VERSION,
  MOTHERBOARD_FINGERPRINT_VERSION,
  M2_AE_FINGERPRINT_VERSION,
  NAS_FINGERPRINT_VERSION,
  NETWORK_FINGERPRINT_VERSION,
  OEM_FINGERPRINT_VERSION,
  RAM_FINGERPRINT_VERSION,
  CANONICAL_UNITS_FINGERPRINT_VERSION,
  SERVER_FINGERPRINT_VERSION,
  SUPPORTED_FINGERPRINT_VERSIONS,
  WORKSTATION_FINGERPRINT_VERSION,
} from './types'

type SourceItem = Record<string, unknown> & {
  id?: unknown
  type?: unknown
  name?: unknown
  manufacturer?: unknown
  family?: unknown
  model?: unknown
  number?: unknown
  specs?: Record<string, unknown>
  hardwareClass?: unknown
}

const SUPPORTED_TYPES = new Set([
  'desktop', 'workstation', 'server', 'nas', 'cpu', 'ram', 'storage', 'motherboard', 'gpu', 'network', 'wireless',
  'cpuCooler', 'case', 'powerSupply', 'soundCard', 'powerAdapter', 'switch', 'patchPanel',
  'monitor', 'ups', 'powerStrip',
])

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return normalized || undefined
}

function scalar(specs: Record<string, JsonValue> | undefined, key: string): JsonValue | undefined {
  return specs?.[key]
}

function identityObject(entries: Array<[string, JsonValue | undefined]>): Record<string, JsonValue> {
  return Object.fromEntries(entries.filter((entry): entry is [string, JsonValue] => entry[1] !== undefined))
}

function canonicalName(item: CatalogTemplateItem): string {
  const manufacturer = text(item.manufacturer)
  const model = text(item.model)
  const number = text(item.number)
  const family = text(item.family)
  if (item.type === 'cpu') {
    const identifier = number ?? model
    const familyParts = family?.split(' ') ?? []
    const familyTier = familyParts.at(-1)
    const repeatsFamilyTier = Boolean(
      familyTier
      && identifier?.toLowerCase().startsWith(`${familyTier.toLowerCase()}-`),
    )
    const canonicalFamily = repeatsFamilyTier ? familyParts.slice(0, -1).join(' ') : family
    return [manufacturer, canonicalFamily, identifier].filter(Boolean).join(' ')
  }
  if (item.type === 'ram' && !model) {
    return [scalar(item.specs, 'capacityGb') ? `${scalar(item.specs, 'capacityGb')}GB` : undefined,
      scalar(item.specs, 'generation'), scalar(item.specs, 'speedMt') ? `${scalar(item.specs, 'speedMt')}MT/s` : undefined,
      scalar(item.specs, 'formFactor')].filter(Boolean).join(' ')
  }
  return [manufacturer, model ?? number ?? family].filter(Boolean).join(' ')
}

function canonicalNameForFingerprint(item: CatalogTemplateItem, fingerprintVersion: FingerprintVersion): string {
  if ((fingerprintVersion === RAM_FINGERPRINT_VERSION || fingerprintVersion === CANONICAL_UNITS_FINGERPRINT_VERSION) && item.type === 'ram') {
    return [text(item.manufacturer), text(item.number)].filter(Boolean).join(' ')
  }
  if ((fingerprintVersion === MOTHERBOARD_FINGERPRINT_VERSION || fingerprintVersion === CANONICAL_UNITS_FINGERPRINT_VERSION) && item.type === 'motherboard') {
    return text(item.name) ?? canonicalName(item)
  }
  if ((fingerprintVersion === OEM_FINGERPRINT_VERSION
    || fingerprintVersion === WORKSTATION_FINGERPRINT_VERSION
    || fingerprintVersion === SERVER_FINGERPRINT_VERSION
    || fingerprintVersion === CANONICAL_UNITS_FINGERPRINT_VERSION
    || fingerprintVersion === NAS_FINGERPRINT_VERSION
    || fingerprintVersion === M2_AE_FINGERPRINT_VERSION)
    && (item.type === 'desktop' || item.type === 'workstation' || item.type === 'server' || item.type === 'nas')) {
    return text(item.name) ?? canonicalName(item)
  }
  return canonicalName(item)
}

function canonicalV9StandardIdentity(item: CatalogTemplateItem): Record<string, JsonValue> | CatalogEligibilityReason {
  const identity = legacyProductIdentity(item)
  if (typeof identity === 'string') return identity
  switch (item.type) {
    case 'storage':
      if (item.specs?.capacityBytes !== undefined) identity.capacityBytes = item.specs.capacityBytes
      delete identity.capacityGb
      delete identity.capacityTb
      return identity
    case 'powerSupply':
      if (item.specs?.ratedPowerMw !== undefined) identity.ratedPowerMw = item.specs.ratedPowerMw
      delete identity.ratedWatts
      return identity
    case 'powerAdapter':
      if (item.specs?.ratedPowerMw !== undefined) identity.ratedPowerMw = item.specs.ratedPowerMw
      delete identity.wattageWatts
      return identity
    case 'monitor':
      if (item.specs?.diagonalMm !== undefined) identity.diagonalMm = item.specs.diagonalMm
      delete identity.sizeInches
      return identity
    case 'ups':
      if (item.specs?.capacityMillivoltAmps !== undefined) identity.capacityMillivoltAmps = item.specs.capacityMillivoltAmps
      delete identity.capacityVa
      return identity
    default:
      return identity
  }
}

function ramProductIdentity(item: CatalogTemplateItem): Record<string, JsonValue> | CatalogEligibilityReason {
  if (item.type !== 'ram') return 'unsupported-type'
  const manufacturer = text(item.manufacturer)
  const partNumber = text(item.number)
  if (!manufacturer || !partNumber) return 'insufficient-identity'
  const generation = text(item.specs?.generation)?.toUpperCase()
  const formFactor = text(item.specs?.formFactor)?.toUpperCase()
  if (
    generation?.startsWith('LPDDR')
    || formFactor === 'LP-DIMM'
    || formFactor === 'ONBOARD'
  ) {
    return 'insufficient-identity'
  }
  const normalizedPartNumber = normalizeBoardIdentifier(partNumber)
  if (!normalizedPartNumber) return 'insufficient-identity'
  return {
    type: 'ram',
    manufacturer,
    partNumber: normalizedPartNumber,
  }
}

function networkProductIdentity(item: CatalogTemplateItem): Record<string, JsonValue> | CatalogEligibilityReason {
  if (item.type !== 'network') return 'unsupported-type'
  const manufacturer = text(item.manufacturer)
  const model = text(item.model)
  const specs = item.specs
  const technology = text(specs?.networkTechnology)
  const hostInterface = specs?.hostInterface && typeof specs.hostInterface === 'object' && !Array.isArray(specs.hostInterface)
    ? specs.hostInterface
    : undefined
  const formFactor = text(specs?.formFactor)
  if (!manufacturer || !model || !technology || !hostInterface || !formFactor) return 'insufficient-identity'

  const portTopology = item.ports?.map((port) => identityObject([
    ['slotNumber', port.slotNumber],
    ['connector', port.type],
    ['networkTechnology', port.networkTechnology],
    ['operatingModes', port.operatingModes],
  ]))
  const radioTopology = technology === 'wifi' || technology === 'cellular'
    ? identityObject([
        ['wifiGenerations', specs?.wifiGenerations],
        ['radioGenerations', specs?.radioGenerations],
        ['frequencyBandsGhz', specs?.frequencyBandsGhz],
        ['spatialStreams', specs?.spatialStreams],
      ])
    : undefined

  const identityHostInterface = { ...hostInterface }
  if (identityHostInterface.family === 'pcie') {
    // Fingerprint v11 originally received only inferred minimums equal to connector width.
    // Preserve that identity representation while functional minima evolve as content.
    identityHostInterface.minimumElectricalLanes = identityHostInterface.connectorLanes
  }

  return identityObject([
    ['type', 'network'],
    ['manufacturer', manufacturer],
    ['model', model],
    ['hardwareRevision', specs?.hardwareRevision],
    ['networkTechnology', technology],
    ['hostInterface', identityHostInterface],
    ['formFactor', formFactor],
    ['portTopology', portTopology as JsonValue | undefined],
    ['radioTopology', radioTopology && Object.keys(radioTopology).length > 0 ? radioTopology : undefined],
  ])
}

function hasAll(item: CatalogTemplateItem, fields: Array<'manufacturer' | 'model' | 'number'>): boolean {
  return fields.every((field) => Boolean(text(item[field])))
}

function legacyProductIdentity(item: CatalogTemplateItem): Record<string, JsonValue> | CatalogEligibilityReason {
  const specs = item.specs
  const common = [['type', item.type], ['subtype', item.subtype], ['manufacturer', item.manufacturer]] as Array<[string, JsonValue | undefined]>
  switch (item.type) {
    case 'pcBuild':
      return 'custom-build'
    case 'desktop':
    case 'server':
      if (!hasAll(item, ['manufacturer', 'model'])) return 'insufficient-identity'
      return identityObject([...common, ['model', item.model], ['boardVariant', scalar(specs, 'boardVariant')],
        ['motherboardPartNumber', scalar(specs, 'motherboardPartNumber')], ['formFactor', scalar(specs, 'formFactor')]])
    case 'nas':
      if (!hasAll(item, ['manufacturer', 'model'])) return 'insufficient-identity'
      return identityObject([...common, ['model', item.model], ['hardwareRevision', scalar(specs, 'hardwareRevision')],
        ['boardRevision', scalar(specs, 'boardRevision')]])
    case 'cpu':
      if (!text(item.manufacturer) || (!text(item.number) && !text(item.model))) return 'insufficient-identity'
      return identityObject([...common, ['family', item.family], ['number', item.number ?? item.model]])
    case 'ram': {
      if (scalar(specs, 'moduleCount') !== undefined || item.secondaryManufacturer || scalar(specs, 'secondarySpeedMt') !== undefined) {
        return 'legacy-ram-kit'
      }
      const capacityGb = scalar(specs, 'capacityGb') ?? scalar(specs, 'capacityGB')
      const genericComplete = capacityGb !== undefined && scalar(specs, 'generation') !== undefined
        && scalar(specs, 'speedMt') !== undefined && scalar(specs, 'formFactor') !== undefined
        && typeof scalar(specs, 'ecc') === 'boolean'
      const knownProduct = Boolean(text(item.manufacturer) && (text(item.model) || text(item.number)))
      if (!knownProduct && !genericComplete) return 'insufficient-identity'
      return identityObject([...common, ['model', item.model ?? item.number], ['capacityGb', capacityGb],
        ['generation', scalar(specs, 'generation')], ['speedMt', scalar(specs, 'speedMt')],
        ['formFactor', scalar(specs, 'formFactor')], ['ecc', scalar(specs, 'ecc')], ['rank', scalar(specs, 'rank')]])
    }
    case 'storage':
      if (!hasAll(item, ['manufacturer', 'model']) && !(text(item.manufacturer) && text(item.number))) return 'insufficient-identity'
      return identityObject([...common, ['model', item.model ?? item.number], ['capacityGb', scalar(specs, 'capacityGb') ?? scalar(specs, 'capacityGB')],
        ['capacityTb', scalar(specs, 'capacityTb')], ['interface', scalar(specs, 'interface')]])
    case 'motherboard':
      if (!hasAll(item, ['manufacturer', 'model'])) return 'insufficient-identity'
      return identityObject([...common, ['model', item.model], ['boardRevision', scalar(specs, 'boardRevision')]])
    case 'gpu':
      if (!hasAll(item, ['manufacturer', 'model'])) return 'insufficient-identity'
      return identityObject([...common, ['model', item.model], ['number', item.number], ['formFactor', scalar(specs, 'formFactor')], ['slotWidth', scalar(specs, 'slotWidth')]])
    case 'network':
    case 'wireless':
      if (!hasAll(item, ['manufacturer', 'model'])) return 'insufficient-identity'
      return identityObject([...common, ['model', item.model], ['interface', scalar(specs, 'interface')], ['formFactor', scalar(specs, 'formFactor')]])
    case 'cpuCooler':
      if (!hasAll(item, ['manufacturer', 'model'])) return 'insufficient-identity'
      return identityObject([...common, ['model', item.model], ['coolerType', scalar(specs, 'coolerType')], ['radiatorSizeMm', scalar(specs, 'radiatorSizeMm')]])
    case 'case':
      if (!hasAll(item, ['manufacturer', 'model'])) return 'insufficient-identity'
      return identityObject([...common, ['model', item.model], ['formFactor', scalar(specs, 'formFactor')]])
    case 'powerSupply':
      if (!hasAll(item, ['manufacturer', 'model'])) return 'insufficient-identity'
      return identityObject([...common, ['model', item.model], ['ratedWatts', scalar(specs, 'ratedWatts')], ['formFactor', scalar(specs, 'formFactor')]])
    case 'soundCard':
      if (!hasAll(item, ['manufacturer', 'model'])) return 'insufficient-identity'
      return identityObject([...common, ['model', item.model], ['interface', scalar(specs, 'interface')]])
    case 'powerAdapter':
      if (!text(item.manufacturer) || (!text(item.model) && !text(item.number))) return 'insufficient-identity'
      return identityObject([...common, ['model', item.model ?? item.number], ['wattageWatts', scalar(specs, 'wattageWatts')], ['connector', scalar(specs, 'connector')]])
    case 'switch':
      if (!hasAll(item, ['manufacturer', 'model'])) return 'insufficient-identity'
      return identityObject([...common, ['model', item.model], ['hardwareRevision', scalar(specs, 'hardwareRevision')]])
    case 'patchPanel':
      if (!hasAll(item, ['manufacturer', 'model'])) return 'insufficient-identity'
      return identityObject([...common, ['model', item.model], ['ports', scalar(specs, 'ports')], ['interface', scalar(specs, 'interface')]])
    case 'monitor':
      if (!hasAll(item, ['manufacturer', 'model'])) return 'insufficient-identity'
      return identityObject([...common, ['model', item.model], ['sizeInches', scalar(specs, 'sizeInches')], ['resolution', scalar(specs, 'resolution')]])
    case 'ups':
      if (!hasAll(item, ['manufacturer', 'model'])) return 'insufficient-identity'
      return identityObject([...common, ['model', item.model], ['capacityVa', scalar(specs, 'capacityVa')], ['region', scalar(specs, 'region')]])
    case 'powerStrip':
      if (!hasAll(item, ['manufacturer', 'model'])) return 'insufficient-identity'
      return identityObject([...common, ['model', item.model], ['outlets', scalar(specs, 'outlets')], ['region', scalar(specs, 'region')]])
    default:
      return 'unsupported-type'
  }
}

function asObject(value: unknown): Record<string, JsonValue> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : undefined
}

function extractMaterialTopology(item: CatalogTemplateItem): Record<string, JsonValue> | undefined {
  const host = asObject(item.compatibility?.host)
  if (!host) return undefined
  const topology = identityObject([
    ['cpu', host.cpu],
    ['memory', host.memory],
    ['expansionSlots', host.expansionSlots],
    ['storageSlots', host.storageSlots],
  ])
  return Object.keys(topology).length > 0 ? topology : undefined
}

function extractOemMaterialTopology(item: CatalogTemplateItem): Record<string, JsonValue> | undefined {
  const host = asObject(item.compatibility?.host)
  if (!host) return undefined
  const fixedPorts = item.ports?.filter((port) => port.origin === 'fixed')
  const topology = identityObject([
    ['cpu', host.cpu],
    ['memory', host.memory],
    ['expansionSlots', host.expansionSlots],
    ['storageSlots', host.storageSlots],
    ['optionalModuleSlots', host.optionalModuleSlots],
    ['power', host.power],
    ['fixedPorts', fixedPorts],
  ])
  return Object.keys(topology).length > 0 ? topology : undefined
}

function extractWorkstationMaterialTopology(item: CatalogTemplateItem): Record<string, JsonValue> | undefined {
  const host = asObject(item.compatibility?.host)
  if (!host) return undefined
  const fixedPorts = item.ports?.filter((port) => port.origin === 'fixed')
  const topology = identityObject([
    ['formFactor', item.specs?.formFactor],
    ['cpu', host.cpu],
    ['memory', host.memory],
    ['expansionSlots', host.expansionSlots],
    ['storageSlots', host.storageSlots],
    ['optionalModuleSlots', host.optionalModuleSlots],
    ['power', host.power],
    ['constraintGroups', host.constraintGroups],
    ['fixedPorts', fixedPorts],
  ])
  return Object.keys(topology).length > 0 ? topology : undefined
}

function extractServerMaterialTopology(item: CatalogTemplateItem): Record<string, JsonValue> | undefined {
  const host = asObject(item.compatibility?.host)
  if (!host) return undefined
  const fixedPorts = item.ports?.filter((port) => port.origin === 'fixed')
  const topology = identityObject([
    ['formFactor', item.specs?.formFactor],
    ['rackUnits', item.specs?.rackUnits],
    ['cpu', host.cpu],
    ['memory', host.memory],
    ['storageSlots', host.storageSlots],
    ['expansionSlots', host.expansionSlots],
    ['optionalModuleSlots', host.optionalModuleSlots],
    ['controllerSlots', host.controllerSlots],
    ['bootDeviceSlots', host.bootDeviceSlots],
    ['power', host.power],
    ['coolingProfiles', host.coolingProfiles],
    ['management', host.management],
    ['constraintGroups', host.constraintGroups],
    ['fixedPorts', fixedPorts],
  ])
  return Object.keys(topology).length > 0 ? topology : undefined
}

function extractNasMaterialTopology(item: CatalogTemplateItem): Record<string, JsonValue> | undefined {
  const host = asObject(item.compatibility?.host)
  if (!host) return undefined
  const memory = asObject(host.memory)
  const fixedPorts = item.ports?.filter((port) => port.origin === 'fixed').map((port) => identityObject([
    ['kind', port.kind],
    ['type', port.type],
    ['slotNumber', port.slotNumber],
    ['speedBps', port.speedBps],
    ['origin', port.origin],
  ]))
  const fixedComponents = item.fixedComponents?.map((component) => identityObject([
    ['componentType', component.componentType],
    ['disposition', component.disposition],
    ['manufacturer', component.item.manufacturer],
    ['model', component.item.model],
    ['number', component.item.number],
    ['capacityMib', component.item.specs?.capacityMib],
    ['generation', component.item.specs?.generation],
  ]))
  const storageSlots = Array.isArray(host.storageSlots) ? host.storageSlots.map((entry) => {
    const slot = asObject(entry)
    return identityObject([
      ['key', slot?.key],
      ['count', slot?.count],
      ['interfaces', slot?.interfaces],
      ['formFactors', slot?.formFactors],
      ['pcieGeneration', slot?.pcieGeneration],
      ['location', slot?.location],
      ['hotSwap', slot?.hotSwap],
      ['controllerSlotIds', slot?.controllerSlotIds],
    ])
  }) : undefined
  const expansionSlots = Array.isArray(host.expansionSlots) ? host.expansionSlots.map((entry) => {
    const slot = asObject(entry)
    return identityObject([
      ['key', slot?.key],
      ['count', slot?.count],
      ['interfaceFamily', slot?.interfaceFamily],
      ['pcieGeneration', slot?.pcieGeneration],
      ['mechanicalLanes', slot?.mechanicalLanes],
      ['electricalLanes', slot?.electricalLanes],
      ['acceptedHeights', slot?.acceptedHeights],
      ['maxSlotWidth', slot?.maxSlotWidth],
      ['acceptedModuleKinds', slot?.acceptedModuleKinds],
    ])
  }) : undefined
  const power = asObject(host.power)
  const topology = identityObject([
    ['formFactor', item.specs?.formFactor],
    ['rackUnits', item.specs?.rackUnits],
    ['hardwareRevision', item.specs?.hardwareRevision],
    ['boardRevision', item.specs?.boardRevision],
    ['fixedComponents', fixedComponents as unknown as JsonValue],
    ['memory', memory ? identityObject([
      ['slots', memory.slots],
      ['generations', memory.generations],
      ['moduleTypes', memory.moduleTypes],
      ['eccSupport', memory.eccSupport],
    ]) : undefined],
    ['storageSlots', storageSlots as JsonValue | undefined],
    ['expansionSlots', expansionSlots as JsonValue | undefined],
    ['optionalModuleSlots', host.optionalModuleSlots],
    ['controllerSlots', host.controllerSlots],
    ['power', power ? identityObject([
      ['configuration', power.configuration],
      ['adapterDisposition', power.adapterDisposition],
      ['connector', power.connector],
      ['psuBayCount', power.psuBayCount],
      ['psuType', power.psuType],
    ]) : undefined],
    ['fixedPorts', fixedPorts as unknown as JsonValue],
  ])
  return Object.keys(topology).length > 0 ? topology : undefined
}

function extractMotherboardMaterialTopology(item: CatalogTemplateItem): Record<string, JsonValue> | undefined {
  const host = asObject(item.compatibility?.host)
  if (!host) return undefined
  const fixedPorts = item.ports?.filter((port) => port.origin === 'fixed')
  const topology = identityObject([
    ['chipset', item.specs?.chipset],
    ['formFactor', item.specs?.formFactor],
    ['boardRevision', item.specs?.boardRevision],
    ['wifiGeneration', item.specs?.wifiGeneration],
    ['wireless', item.specs?.wireless],
    ['cpu', host.cpu],
    ['memory', host.memory],
    ['storageSlots', host.storageSlots],
    ['expansionSlots', host.expansionSlots],
    ['powerConnectors', host.powerConnectors],
    ['fixedPorts', fixedPorts],
  ])
  return Object.keys(topology).length > 0 ? topology : undefined
}

function topologyCompleteness(item: CatalogTemplateItem): 'complete' | 'partial' | 'conflicting' {
  const host = asObject(item.compatibility?.host)
  const declared = text(item.specs?.topologyCompleteness) ?? text(host?.topologyCompleteness)
  if (declared === 'complete' || declared === 'partial' || declared === 'conflicting') return declared
  if (item.specs?.topologyComplete === true || host?.topologyComplete === true) return 'complete'
  return 'partial'
}

function splitBoardIdentity(item: CatalogTemplateItem): {
  partNumber?: string
  revision?: string
} {
  const rawPartNumber = text(item.specs?.motherboardPartNumber) ?? text(item.specs?.partNumber)
  const explicitRevision = text(item.specs?.motherboardRevision) ?? text(item.specs?.boardRevision)
  if (!rawPartNumber) return { revision: explicitRevision ? normalizeBoardIdentifier(explicitRevision) : undefined }
  const combined = normalizeText(rawPartNumber).match(/^(.+?)[\s/_-]+([A-Z]\d{2})$/i)
  return {
    partNumber: normalizeBoardIdentifier(combined?.[1] ?? rawPartNumber),
    revision: normalizeBoardIdentifier(explicitRevision ?? combined?.[2] ?? '' ) || undefined,
  }
}

function topologySummary(topology: Record<string, JsonValue> | undefined): string | undefined {
  if (!topology) return undefined
  const expansion = Array.isArray(topology.expansionSlots) ? topology.expansionSlots : []
  const expansionSummary = expansion
    .map((slot) => {
      const entry = asObject(slot)
      if (!entry) return undefined
      const generation = typeof entry.pcieGeneration === 'number' ? `PCIe Gen${entry.pcieGeneration}` : undefined
      const lanes = typeof entry.electricalLanes === 'number' ? `x${entry.electricalLanes}` : undefined
      const label = typeof entry.label === 'string' ? normalizeText(entry.label) : undefined
      return [generation, lanes, label].filter(Boolean).join(' ')
    })
    .filter(Boolean)
  if (expansionSummary.length > 0) return expansionSummary.join(' · ')
  const storage = Array.isArray(topology.storageSlots) ? topology.storageSlots.length : 0
  const memory = asObject(topology.memory)
  const memorySlots = typeof memory?.slots === 'number' ? memory.slots : undefined
  const parts = [storage > 0 ? `${storage} storage group${storage === 1 ? '' : 's'}` : undefined,
    memorySlots ? `${memorySlots} memory slots` : undefined].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

function hasDiscriminatingExpansionTopology(topology: Record<string, JsonValue> | undefined): boolean {
  if (!topology || !Array.isArray(topology.expansionSlots)) return false
  return topology.expansionSlots.some((slot) => {
    const entry = asObject(slot)
    return text(entry?.interfaceFamily)?.toLowerCase() === 'pcie'
  })
}

async function variantIdentity(item: CatalogTemplateItem): Promise<{
  identityPayload: Record<string, JsonValue>
  productFamily?: CatalogProductFamily
  variantEvidence?: CatalogVariantEvidence
} | CatalogEligibilityReason> {
  const legacyIdentity = legacyProductIdentity(item)
  if (typeof legacyIdentity === 'string') return legacyIdentity
  if (item.type !== 'desktop' && item.type !== 'server' && item.type !== 'nas') {
    return { identityPayload: legacyIdentity }
  }

  const manufacturer = text(item.manufacturer)
  const model = text(item.model)
  if (!manufacturer || !model) return 'insufficient-identity'
  const productFamily: CatalogProductFamily = { manufacturer, model, physicalClass: item.type }
  const topology = extractMaterialTopology(item)
  const completeness = topologyCompleteness(item)
  const board = splitBoardIdentity(item)
  const explicitVariant = text(item.specs?.boardVariant) ?? text(item.specs?.variantKey)
  const topologySignature = topology ? await sha256Hex(`hli:topology:v3:${canonicalJson(topology)}`) : undefined

  if (board.partNumber) {
    const label = explicitVariant ?? `Board ${board.partNumber}${board.revision ? ` ${board.revision}` : ''}`
    return {
      productFamily,
      variantEvidence: {
        source: 'motherboard',
        completeness,
        label,
        motherboardPartNumber: board.partNumber,
        ...(board.revision ? { motherboardRevision: board.revision } : {}),
        ...(explicitVariant ? { variantKey: normalizeVariantKey(explicitVariant) } : {}),
        ...(topologySignature ? { topologySignature } : {}),
        ...(topologySummary(topology) ? { structuralSummary: topologySummary(topology) } : {}),
      },
      identityPayload: identityObject([
        ['productFamily', productFamily],
        ['motherboardPartNumber', board.partNumber],
        ['motherboardRevision', board.revision],
      ]),
    }
  }

  if (topology && topologySignature
    && (completeness === 'complete' || hasDiscriminatingExpansionTopology(topology))) {
    return {
      productFamily,
      variantEvidence: {
        source: 'topology', completeness, label: explicitVariant ?? 'Topology-defined variant',
        ...(explicitVariant ? { variantKey: normalizeVariantKey(explicitVariant) } : {}),
        topologySignature,
        ...(topologySummary(topology) ? { structuralSummary: topologySummary(topology) } : {}),
      },
      identityPayload: { productFamily, topologySignature },
    }
  }

  return {
    productFamily,
    variantEvidence: {
      source: 'generic', completeness,
      label: explicitVariant ?? 'Generic family',
      ...(explicitVariant ? { variantKey: normalizeVariantKey(explicitVariant) } : {}),
      ...(topologySignature ? { topologySignature } : {}),
      ...(topologySummary(topology) ? { structuralSummary: topologySummary(topology) } : {}),
    },
    identityPayload: { productFamily },
  }
}

async function oemVariantIdentity(item: CatalogTemplateItem): Promise<{
  identityPayload: Record<string, JsonValue>
  productFamily?: CatalogProductFamily
  variantEvidence?: CatalogVariantEvidence
} | CatalogEligibilityReason> {
  const legacyIdentity = legacyProductIdentity(item)
  if (typeof legacyIdentity === 'string') return legacyIdentity
  if (item.type !== 'desktop' && item.type !== 'server' && item.type !== 'nas') {
    return { identityPayload: legacyIdentity }
  }

  const manufacturer = text(item.manufacturer)
  const model = text(item.model)
  if (!manufacturer || !model) return 'insufficient-identity'
  const productFamily: CatalogProductFamily = { manufacturer, model, physicalClass: item.type }
  const topology = extractOemMaterialTopology(item)
  const completeness = topologyCompleteness(item)
  const board = splitBoardIdentity(item)
  const explicitVariant = text(item.specs?.boardVariant) ?? text(item.specs?.variantKey)
  const topologySignature = topology
    ? await sha256Hex(`hli:topology:v${OEM_FINGERPRINT_VERSION}:${canonicalJson(topology)}`)
    : undefined

  if (board.partNumber) {
    const label = explicitVariant ?? `Board ${board.partNumber}${board.revision ? ` ${board.revision}` : ''}`
    return {
      productFamily,
      variantEvidence: {
        source: 'motherboard',
        completeness,
        label,
        motherboardPartNumber: board.partNumber,
        ...(board.revision ? { motherboardRevision: board.revision } : {}),
        ...(explicitVariant ? { variantKey: normalizeVariantKey(explicitVariant) } : {}),
        ...(topologySignature ? { topologySignature } : {}),
        ...(topologySummary(topology) ? { structuralSummary: topologySummary(topology) } : {}),
      },
      identityPayload: identityObject([
        ['productFamily', productFamily],
        ['motherboardPartNumber', board.partNumber],
        ['motherboardRevision', board.revision],
      ]),
    }
  }

  if (topology && topologySignature
    && (completeness === 'complete' || hasDiscriminatingExpansionTopology(topology))) {
    return {
      productFamily,
      variantEvidence: {
        source: 'topology',
        completeness,
        label: explicitVariant ?? 'Topology-defined variant',
        ...(explicitVariant ? { variantKey: normalizeVariantKey(explicitVariant) } : {}),
        topologySignature,
        ...(topologySummary(topology) ? { structuralSummary: topologySummary(topology) } : {}),
      },
      identityPayload: { productFamily, topologySignature },
    }
  }

  return {
    productFamily,
    variantEvidence: {
      source: 'generic',
      completeness,
      label: explicitVariant ?? 'Generic family',
      ...(explicitVariant ? { variantKey: normalizeVariantKey(explicitVariant) } : {}),
      ...(topologySignature ? { topologySignature } : {}),
      ...(topologySummary(topology) ? { structuralSummary: topologySummary(topology) } : {}),
    },
    identityPayload: { productFamily },
  }
}

async function workstationVariantIdentity(item: CatalogTemplateItem): Promise<{
  identityPayload: Record<string, JsonValue>
  productFamily: CatalogProductFamily
  variantEvidence: CatalogVariantEvidence
} | CatalogEligibilityReason> {
  if (item.type !== 'workstation') return 'unsupported-type'
  const manufacturer = text(item.manufacturer)
  const model = text(item.model)
  if (!manufacturer || !model) return 'insufficient-identity'

  const productFamily: CatalogProductFamily = { manufacturer, model, physicalClass: item.type }
  const topology = extractWorkstationMaterialTopology(item)
  const completeness = topologyCompleteness(item)
  const board = splitBoardIdentity(item)
  const explicitVariant = text(item.specs?.boardVariant) ?? text(item.specs?.variantKey)
  const topologySignature = topology
    ? await sha256Hex(`hli:topology:v${WORKSTATION_FINGERPRINT_VERSION}:${canonicalJson(topology)}`)
    : undefined
  const structuralSummary = topologySummary(topology)

  if (board.partNumber) {
    const label = explicitVariant ?? `Board ${board.partNumber}${board.revision ? ` ${board.revision}` : ''}`
    return {
      productFamily,
      variantEvidence: {
        source: 'motherboard',
        completeness,
        label,
        motherboardPartNumber: board.partNumber,
        ...(board.revision ? { motherboardRevision: board.revision } : {}),
        ...(explicitVariant ? { variantKey: normalizeVariantKey(explicitVariant) } : {}),
        ...(topologySignature ? { topologySignature } : {}),
        ...(structuralSummary ? { structuralSummary } : {}),
      },
      identityPayload: identityObject([
        ['productFamily', productFamily],
        ['motherboardPartNumber', board.partNumber],
        ['motherboardRevision', board.revision],
        ['topologySignature', topologySignature],
      ]),
    }
  }

  if (!topology || !topologySignature || completeness !== 'complete') return 'insufficient-identity'
  return {
    productFamily,
    variantEvidence: {
      source: 'topology',
      completeness,
      label: explicitVariant ?? 'Topology-defined variant',
      ...(explicitVariant ? { variantKey: normalizeVariantKey(explicitVariant) } : {}),
      topologySignature,
      ...(structuralSummary ? { structuralSummary } : {}),
    },
    identityPayload: { productFamily, topologySignature },
  }
}

async function serverVariantIdentity(item: CatalogTemplateItem): Promise<{
  identityPayload: Record<string, JsonValue>
  productFamily: CatalogProductFamily
  variantEvidence: CatalogVariantEvidence
} | CatalogEligibilityReason> {
  if (item.type !== 'server') return 'unsupported-type'
  const manufacturer = text(item.manufacturer)
  const model = text(item.model)
  if (!manufacturer || !model) return 'insufficient-identity'

  const productFamily: CatalogProductFamily = { manufacturer, model, physicalClass: item.type }
  const topology = extractServerMaterialTopology(item)
  const completeness = topologyCompleteness(item)
  const board = splitBoardIdentity(item)
  const explicitVariant = text(item.specs?.boardVariant) ?? text(item.specs?.variantKey)
  const topologySignature = topology
    ? await sha256Hex(`hli:topology:v${SERVER_FINGERPRINT_VERSION}:${canonicalJson(topology)}`)
    : undefined
  const structuralSummary = topologySummary(topology)

  if (!topology || !topologySignature || completeness !== 'complete') return 'insufficient-identity'

  const variantEvidence: CatalogVariantEvidence = {
    source: board.partNumber ? 'motherboard' : 'topology',
    completeness,
    label: explicitVariant
      ?? (board.partNumber ? `Board ${board.partNumber}${board.revision ? ` ${board.revision}` : ''}` : 'Topology-defined variant'),
    ...(board.partNumber ? { motherboardPartNumber: board.partNumber } : {}),
    ...(board.revision ? { motherboardRevision: board.revision } : {}),
    ...(explicitVariant ? { variantKey: normalizeVariantKey(explicitVariant) } : {}),
    topologySignature,
    ...(structuralSummary ? { structuralSummary } : {}),
  }

  return {
    productFamily,
    variantEvidence,
    identityPayload: identityObject([
      ['productFamily', productFamily],
      ['motherboardPartNumber', board.partNumber],
      ['motherboardRevision', board.revision],
      ['topologySignature', topologySignature],
    ]),
  }
}

async function nasVariantIdentity(item: CatalogTemplateItem): Promise<{
  identityPayload: Record<string, JsonValue>
  productFamily: CatalogProductFamily
  variantEvidence: CatalogVariantEvidence
} | CatalogEligibilityReason> {
  if (item.type !== 'nas') return 'unsupported-type'
  const manufacturer = text(item.manufacturer)
  const model = text(item.model)
  if (!manufacturer || !model) return 'insufficient-identity'

  const productFamily: CatalogProductFamily = { manufacturer, model, physicalClass: item.type }
  const identityProductFamily: CatalogProductFamily = {
    manufacturer: normalizeText(manufacturer).toLowerCase(),
    model: normalizeText(model).toLowerCase(),
    physicalClass: item.type,
  }
  const topology = extractNasMaterialTopology(item)
  const completeness = topologyCompleteness(item)
  const hardwareRevision = text(item.specs?.hardwareRevision)
  const boardRevision = text(item.specs?.boardRevision)
  const explicitVariant = text(item.specs?.variantKey)
  const topologySignature = topology
    ? await sha256Hex(`hli:topology:v${NAS_FINGERPRINT_VERSION}:${canonicalJson(topology)}`)
    : undefined
  if (!topology || !topologySignature || completeness !== 'complete') return 'insufficient-identity'

  return {
    productFamily,
    variantEvidence: {
      source: boardRevision || hardwareRevision ? 'motherboard' : 'topology',
      completeness,
      label: explicitVariant ?? hardwareRevision ?? boardRevision ?? 'Topology-defined variant',
      ...(boardRevision ? { motherboardRevision: normalizeBoardIdentifier(boardRevision) } : {}),
      ...(explicitVariant ? { variantKey: normalizeVariantKey(explicitVariant) } : {}),
      topologySignature,
      ...(topologySummary(topology) ? { structuralSummary: topologySummary(topology) } : {}),
    },
    identityPayload: identityObject([
      ['productFamily', identityProductFamily],
      ['hardwareRevision', hardwareRevision ? normalizeText(hardwareRevision) : undefined],
      ['boardRevision', boardRevision ? normalizeText(boardRevision) : undefined],
      ['topologySignature', topologySignature],
    ]),
  }
}

function stripV12IdentityNeutral(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(stripV12IdentityNeutral)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'keyAliases' && key !== 'intendedModuleKinds' && key !== 'label')
    .map(([key, entry]) => [key, stripV12IdentityNeutral(entry)]))
}

async function m2PhysicalVariantIdentity(item: CatalogTemplateItem): Promise<{
  identityPayload: Record<string, JsonValue>
  productFamily?: CatalogProductFamily
  variantEvidence?: CatalogVariantEvidence
} | CatalogEligibilityReason> {
  if (item.type === 'network') {
    const identityPayload = networkProductIdentity(item)
    return typeof identityPayload === 'string' ? identityPayload : { identityPayload }
  }
  if (!['desktop', 'workstation', 'server', 'nas'].includes(item.type)) return 'unsupported-type'
  const manufacturer = text(item.manufacturer)
  const model = text(item.model)
  if (!manufacturer || !model) return 'insufficient-identity'

  const productFamily: CatalogProductFamily = { manufacturer, model, physicalClass: item.type }
  const topology = item.type === 'workstation'
    ? extractWorkstationMaterialTopology(item)
    : item.type === 'server'
      ? extractServerMaterialTopology(item)
      : item.type === 'nas'
        ? extractNasMaterialTopology(item)
        : extractOemMaterialTopology(item)
  if (!topology) return 'insufficient-identity'
  const materialTopology = projectM2PhysicalHashValue(
    stripV12IdentityNeutral(topology),
  ) as Record<string, JsonValue>
  const topologySignature = await sha256Hex(
    `hli:topology:v${M2_AE_FINGERPRINT_VERSION}:${canonicalJson(materialTopology)}`,
  )
  const board = splitBoardIdentity(item)
  const explicitVariant = text(item.specs?.boardVariant) ?? text(item.specs?.variantKey)
  const completeness = topologyCompleteness(item)
  const structuralSummary = topologySummary(materialTopology)
  const variantEvidence: CatalogVariantEvidence = {
    source: board.partNumber ? 'motherboard' : 'topology',
    completeness,
    label: explicitVariant
      ?? (board.partNumber ? `Board ${board.partNumber}${board.revision ? ` ${board.revision}` : ''}` : 'Topology-defined variant'),
    ...(board.partNumber ? { motherboardPartNumber: board.partNumber } : {}),
    ...(board.revision ? { motherboardRevision: board.revision } : {}),
    ...(explicitVariant ? { variantKey: normalizeVariantKey(explicitVariant) } : {}),
    topologySignature,
    ...(structuralSummary ? { structuralSummary } : {}),
  }
  return {
    productFamily,
    variantEvidence,
    identityPayload: identityObject([
      ['productFamily', productFamily],
      ['motherboardPartNumber', board.partNumber],
      ['motherboardRevision', board.revision],
      ['topologySignature', topologySignature],
    ]),
  }
}

async function motherboardVariantIdentity(item: CatalogTemplateItem): Promise<{
  identityPayload: Record<string, JsonValue>
  productFamily: CatalogProductFamily
  variantEvidence: CatalogVariantEvidence
} | CatalogEligibilityReason> {
  if (item.type !== 'motherboard') return 'unsupported-type'
  const manufacturer = text(item.manufacturer)
  const model = text(item.model)
  if (!manufacturer || !model) return 'insufficient-identity'

  const topology = extractMotherboardMaterialTopology(item)
  if (!topology) return 'insufficient-identity'
  const productFamily: CatalogProductFamily = { manufacturer, model, physicalClass: item.type }
  const boardRevision = text(item.specs?.boardRevision)
  const topologySignature = await sha256Hex(
    `hli:topology:v${MOTHERBOARD_FINGERPRINT_VERSION}:${canonicalJson(topology)}`,
  )
  const structuralSummary = topologySummary(topology)

  return {
    productFamily,
    variantEvidence: {
      source: 'topology',
      completeness: 'complete',
      label: boardRevision ? `Board revision ${boardRevision}` : 'Topology-defined variant',
      ...(boardRevision ? { motherboardRevision: normalizeText(boardRevision) } : {}),
      topologySignature,
      ...(structuralSummary ? { structuralSummary } : {}),
    },
    identityPayload: identityObject([
      ['productFamily', productFamily],
      ['boardRevision', boardRevision ? normalizeText(boardRevision) : undefined],
      ['topologySignature', topologySignature],
    ]),
  }
}

export async function projectCatalogItem(
  value: unknown,
  options: { fingerprintVersion?: FingerprintVersion } = {},
): Promise<CatalogProjection> {
  const source = value as SourceItem
  const sourceType = text(source?.type) ?? ''
  const hardwareClass = text(source?.hardwareClass)
  const type = sourceType === 'server' && (
    hardwareClass === 'desktop'
    || hardwareClass === 'workstation'
    || hardwareClass === 'server'
  )
    ? hardwareClass
    : sourceType
  const itemId = Number(source?.id)
  const sourceRef: CatalogSourceRef = { itemType: sourceType, itemId }
  if (!Number.isSafeInteger(itemId) || itemId < 1 || !SUPPORTED_TYPES.has(type)) {
    return { status: 'ineligible', source: sourceRef, reason: 'unsupported-type' }
  }
  if (type === 'pcBuild') return { status: 'ineligible', source: sourceRef, reason: 'custom-build' }
  if (type === 'ram' && (
    source.secondaryManufacturer !== undefined
    || source.specs?.moduleCount !== undefined
    || source.specs?.secondarySpeedMt !== undefined
  )) {
    return { status: 'ineligible', source: sourceRef, reason: 'legacy-ram-kit' }
  }

  const fingerprintVersion = options.fingerprintVersion ?? FINGERPRINT_VERSION
  if (!SUPPORTED_FINGERPRINT_VERSIONS.includes(fingerprintVersion)) {
    throw new Error(`Unsupported catalog fingerprint version ${fingerprintVersion}.`)
  }
  const item = fingerprintVersion === M2_AE_FINGERPRINT_VERSION
    ? canonicalizeCatalogItemV12({ ...source, type })
    : fingerprintVersion === NETWORK_FINGERPRINT_VERSION
    ? canonicalizeCatalogItemV11({ ...source, type })
    : fingerprintVersion === NAS_FINGERPRINT_VERSION
      ? canonicalizeCatalogItemV10({ ...source, type })
    : fingerprintVersion === CANONICAL_UNITS_FINGERPRINT_VERSION
      ? canonicalizeCatalogItemV9({ ...source, type })
      : sanitizeCatalogItem({ ...source, type })
  let identityPayload: Record<string, JsonValue>
  let productFamily: CatalogProductFamily | undefined
  let variantEvidence: CatalogVariantEvidence | undefined
  if (fingerprintVersion === M2_AE_FINGERPRINT_VERSION) {
    if (['network', 'desktop', 'workstation', 'server', 'nas'].includes(item.type)) {
      const variant = await m2PhysicalVariantIdentity(item)
      if (typeof variant === 'string') return { status: 'ineligible', source: sourceRef, reason: variant }
      identityPayload = variant.identityPayload
      productFamily = variant.productFamily
      variantEvidence = variant.variantEvidence
    } else if (item.type === 'ram') {
      const identity = ramProductIdentity(item)
      if (typeof identity === 'string') return { status: 'ineligible', source: sourceRef, reason: identity }
      identityPayload = identity
    } else if (item.type === 'motherboard') {
      const variant = await motherboardVariantIdentity(item)
      if (typeof variant === 'string') return { status: 'ineligible', source: sourceRef, reason: variant }
      identityPayload = variant.identityPayload
      productFamily = variant.productFamily
      variantEvidence = variant.variantEvidence
    } else {
      const identity = canonicalV9StandardIdentity(item)
      if (typeof identity === 'string') return { status: 'ineligible', source: sourceRef, reason: identity }
      identityPayload = identity
    }
  } else if (fingerprintVersion === NETWORK_FINGERPRINT_VERSION) {
    const identity = networkProductIdentity(item)
    if (typeof identity === 'string') return { status: 'ineligible', source: sourceRef, reason: identity }
    identityPayload = identity
  } else if (fingerprintVersion === NAS_FINGERPRINT_VERSION) {
    const variant = await nasVariantIdentity(item)
    if (typeof variant === 'string') return { status: 'ineligible', source: sourceRef, reason: variant }
    identityPayload = variant.identityPayload
    productFamily = variant.productFamily
    variantEvidence = variant.variantEvidence
  } else if (fingerprintVersion === CANONICAL_UNITS_FINGERPRINT_VERSION) {
    if (item.type === 'ram') {
      const identity = ramProductIdentity(item)
      if (typeof identity === 'string') return { status: 'ineligible', source: sourceRef, reason: identity }
      identityPayload = identity
    } else if (item.type === 'motherboard') {
      const variant = await motherboardVariantIdentity(item)
      if (typeof variant === 'string') return { status: 'ineligible', source: sourceRef, reason: variant }
      identityPayload = variant.identityPayload
      productFamily = variant.productFamily
      variantEvidence = variant.variantEvidence
    } else if (item.type === 'workstation') {
      const variant = await workstationVariantIdentity(item)
      if (typeof variant === 'string') return { status: 'ineligible', source: sourceRef, reason: variant }
      identityPayload = variant.identityPayload
      productFamily = variant.productFamily
      variantEvidence = variant.variantEvidence
    } else if (item.type === 'desktop') {
      const variant = await oemVariantIdentity(item)
      if (typeof variant === 'string') return { status: 'ineligible', source: sourceRef, reason: variant }
      identityPayload = variant.identityPayload
      productFamily = variant.productFamily
      variantEvidence = variant.variantEvidence
    } else if (item.type === 'server' || item.type === 'nas') {
      const variant = await serverVariantIdentity(item)
      if (typeof variant === 'string') return { status: 'ineligible', source: sourceRef, reason: variant }
      identityPayload = variant.identityPayload
      productFamily = variant.productFamily
      variantEvidence = variant.variantEvidence
    } else {
      const identity = canonicalV9StandardIdentity(item)
      if (typeof identity === 'string') return { status: 'ineligible', source: sourceRef, reason: identity }
      identityPayload = identity
    }
  } else if (fingerprintVersion === LEGACY_FINGERPRINT_VERSION) {
    const identity = legacyProductIdentity(item)
    if (typeof identity === 'string') return { status: 'ineligible', source: sourceRef, reason: identity }
    identityPayload = identity
  } else if (fingerprintVersion === OEM_FINGERPRINT_VERSION) {
    const variant = await oemVariantIdentity(item)
    if (typeof variant === 'string') return { status: 'ineligible', source: sourceRef, reason: variant }
    identityPayload = variant.identityPayload
    productFamily = variant.productFamily
    variantEvidence = variant.variantEvidence
  } else if (fingerprintVersion === WORKSTATION_FINGERPRINT_VERSION) {
    const variant = await workstationVariantIdentity(item)
    if (typeof variant === 'string') return { status: 'ineligible', source: sourceRef, reason: variant }
    identityPayload = variant.identityPayload
    productFamily = variant.productFamily
    variantEvidence = variant.variantEvidence
  } else if (fingerprintVersion === SERVER_FINGERPRINT_VERSION) {
    const variant = await serverVariantIdentity(item)
    if (typeof variant === 'string') return { status: 'ineligible', source: sourceRef, reason: variant }
    identityPayload = variant.identityPayload
    productFamily = variant.productFamily
    variantEvidence = variant.variantEvidence
  } else if (fingerprintVersion === MOTHERBOARD_FINGERPRINT_VERSION) {
    const variant = await motherboardVariantIdentity(item)
    if (typeof variant === 'string') return { status: 'ineligible', source: sourceRef, reason: variant }
    identityPayload = variant.identityPayload
    productFamily = variant.productFamily
    variantEvidence = variant.variantEvidence
  } else if (fingerprintVersion === RAM_FINGERPRINT_VERSION) {
    const identity = ramProductIdentity(item)
    if (typeof identity === 'string') return { status: 'ineligible', source: sourceRef, reason: identity }
    identityPayload = identity
  } else {
    const variant = await variantIdentity(item)
    if (typeof variant === 'string') return { status: 'ineligible', source: sourceRef, reason: variant }
    identityPayload = variant.identityPayload
    productFamily = variant.productFamily
    variantEvidence = variant.variantEvidence
  }
  const name = canonicalNameForFingerprint(item, fingerprintVersion)
  if (!name) return { status: 'ineligible', source: sourceRef, reason: 'insufficient-identity' }
  const canonicalItem = { ...item, name }
  const digests = await computeCatalogDigestsWithIdentity(canonicalItem, identityPayload, fingerprintVersion)
  return {
    status: 'eligible', source: sourceRef, item: canonicalItem, fingerprintVersion, identityPayload,
    ...(fingerprintVersion === LEGACY_FINGERPRINT_VERSION ? {} : {
      ...(productFamily ? { productFamily } : {}),
      ...(variantEvidence ? { variantEvidence } : {}),
    }),
    ...digests,
  }
}

export async function projectCatalogItemV2(value: unknown): Promise<CatalogProjection> {
  return projectCatalogItem(value, { fingerprintVersion: LEGACY_FINGERPRINT_VERSION })
}

export async function digestCatalogTemplate(
  value: unknown,
  options: { fingerprintVersion?: FingerprintVersion } = {},
): Promise<Extract<CatalogProjection, { status: 'eligible' }>> {
  const projection = await projectCatalogItem({ ...(value as Record<string, unknown>), id: 1 }, options)
  if (projection.status !== 'eligible') {
    throw new Error(`Catalog template is not eligible for publication: ${projection.reason}.`)
  }
  return projection
}

export function catalogItemMeetsEligibility(item: CatalogTemplateItem): boolean {
  if (item.type === 'workstation') return Boolean(text(item.manufacturer) && text(item.model))
  if (item.type === 'motherboard') return Boolean(text(item.manufacturer) && text(item.model))
  return typeof legacyProductIdentity(item) !== 'string'
}
