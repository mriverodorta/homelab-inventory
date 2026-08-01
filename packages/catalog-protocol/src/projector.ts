import { canonicalJson } from './canonicalize'
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
  JsonPrimitive,
  JsonValue,
} from './types'
import { FINGERPRINT_VERSION, LEGACY_FINGERPRINT_VERSION } from './types'

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
  'desktop', 'server', 'nas', 'cpu', 'ram', 'storage', 'motherboard', 'gpu', 'network', 'wireless',
  'cpuCooler', 'case', 'powerSupply', 'soundCard', 'powerAdapter', 'switch', 'patchPanel',
  'monitor', 'ups', 'powerStrip',
])

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return normalized || undefined
}

function scalar(specs: Record<string, JsonPrimitive> | undefined, key: string): JsonPrimitive | undefined {
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

  if (topology && completeness === 'complete' && topologySignature) {
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

export async function projectCatalogItem(
  value: unknown,
  options: { fingerprintVersion?: FingerprintVersion } = {},
): Promise<CatalogProjection> {
  const source = value as SourceItem
  const sourceType = text(source?.type) ?? ''
  const hardwareClass = text(source?.hardwareClass)
  const type = sourceType === 'server' && (hardwareClass === 'desktop' || hardwareClass === 'server')
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

  const item = sanitizeCatalogItem({ ...source, type })
  const fingerprintVersion = options.fingerprintVersion ?? FINGERPRINT_VERSION
  let identityPayload: Record<string, JsonValue>
  let productFamily: CatalogProductFamily | undefined
  let variantEvidence: CatalogVariantEvidence | undefined
  if (fingerprintVersion === LEGACY_FINGERPRINT_VERSION) {
    const identity = legacyProductIdentity(item)
    if (typeof identity === 'string') return { status: 'ineligible', source: sourceRef, reason: identity }
    identityPayload = identity
  } else {
    const variant = await variantIdentity(item)
    if (typeof variant === 'string') return { status: 'ineligible', source: sourceRef, reason: variant }
    identityPayload = variant.identityPayload
    productFamily = variant.productFamily
    variantEvidence = variant.variantEvidence
  }
  const name = canonicalName(item)
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
  return typeof legacyProductIdentity(item) !== 'string'
}
