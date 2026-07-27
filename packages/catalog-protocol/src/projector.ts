import { computeCatalogDigestsWithIdentity } from './hash'
import { sanitizeCatalogItem } from './sanitize'
import type {
  CatalogEligibilityReason,
  CatalogProjection,
  CatalogSourceRef,
  CatalogTemplateItem,
  JsonPrimitive,
  JsonValue,
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
}

const SUPPORTED_TYPES = new Set([
  'server', 'nas', 'cpu', 'ram', 'storage', 'motherboard', 'gpu', 'network', 'wireless',
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
  if (item.type === 'cpu') return [manufacturer, family, number ?? model].filter(Boolean).join(' ')
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

function productIdentity(item: CatalogTemplateItem): Record<string, JsonValue> | CatalogEligibilityReason {
  const specs = item.specs
  const common = [['type', item.type], ['subtype', item.subtype], ['manufacturer', item.manufacturer]] as Array<[string, JsonValue | undefined]>
  switch (item.type) {
    case 'pcBuild':
      return 'custom-build'
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

export async function projectCatalogItem(value: unknown): Promise<CatalogProjection> {
  const source = value as SourceItem
  const type = text(source?.type) ?? ''
  const itemId = Number(source?.id)
  const sourceRef: CatalogSourceRef = { itemType: type, itemId }
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

  const item = sanitizeCatalogItem(source)
  const identityPayload = productIdentity(item)
  if (typeof identityPayload === 'string') return { status: 'ineligible', source: sourceRef, reason: identityPayload }
  const name = canonicalName(item)
  if (!name) return { status: 'ineligible', source: sourceRef, reason: 'insufficient-identity' }
  const canonicalItem = { ...item, name }
  const digests = await computeCatalogDigestsWithIdentity(canonicalItem, identityPayload)
  return { status: 'eligible', source: sourceRef, item: canonicalItem, identityPayload, ...digests }
}

export async function digestCatalogTemplate(value: unknown): Promise<Extract<CatalogProjection, { status: 'eligible' }>> {
  const projection = await projectCatalogItem({ ...(value as Record<string, unknown>), id: 1 })
  if (projection.status !== 'eligible') {
    throw new Error(`Catalog template is not eligible for publication: ${projection.reason}.`)
  }
  return projection
}

export function catalogItemMeetsEligibility(item: CatalogTemplateItem): boolean {
  return typeof productIdentity(item) !== 'string'
}
