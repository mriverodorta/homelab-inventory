import type {
  CatalogFacet,
  CatalogFacetCategory,
  CatalogFacetIndex,
  CatalogRangeFacet,
  CatalogTermFacet,
} from './types'

export const CATALOG_FACET_SCHEMA_VERSION = 1
export const MAX_FACET_CATEGORIES = 100
export const MAX_FACETS_PER_CATEGORY = 40
export const MAX_TERM_VALUES = 2_000

export const MOTHERBOARD_CATALOG_FACET_KEYS = [
  'manufacturer',
  'family',
  'specs.chipset',
  'compatibility.host.cpu.sockets',
  'compatibility.host.cpu.generations',
  'specs.formFactor',
  'compatibility.host.memory.generations',
  'specs.wifiGeneration',
  'specs.discontinued',
] as const

function nonEmptyString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty string no longer than ${maxLength} characters.`)
  }
  return value
}

function positiveInteger(value: unknown, label: string, allowZero = false): number {
  if (!Number.isSafeInteger(value) || Number(value) < (allowZero ? 0 : 1)) {
    throw new Error(`${label} must be ${allowZero ? 'a non-negative' : 'a positive'} integer.`)
  }
  return Number(value)
}

function validateTermFacet(source: Record<string, unknown>, label: string): CatalogTermFacet {
  if (!Array.isArray(source.values) || source.values.length > MAX_TERM_VALUES) {
    throw new Error(`${label} term values are invalid or exceed the limit.`)
  }
  const seen = new Set<string>()
  const values = source.values.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label} value ${index} is invalid.`)
    const value = raw as Record<string, unknown>
    const term = nonEmptyString(value.value, `${label} value ${index}`, 200)
    if (seen.has(term)) throw new Error(`${label} duplicates term ${term}.`)
    seen.add(term)
    return {
      value: term,
      label: nonEmptyString(value.label, `${label} label ${index}`, 200),
      count: positiveInteger(value.count, `${label} value ${index} count`, true),
    }
  })
  return {
    kind: 'terms',
    key: nonEmptyString(source.key, `${label} key`, 128),
    label: nonEmptyString(source.label, `${label} label`, 80),
    values,
  }
}

function validateRangeFacet(source: Record<string, unknown>, label: string): CatalogRangeFacet {
  const minimum = Number(source.minimum)
  const maximum = Number(source.maximum)
  const step = Number(source.step)
  if (![minimum, maximum, step].every(Number.isFinite) || minimum > maximum || step <= 0) {
    throw new Error(`${label} range is invalid.`)
  }
  return {
    kind: 'range',
    key: nonEmptyString(source.key, `${label} key`, 128),
    label: nonEmptyString(source.label, `${label} label`, 80),
    minimum,
    maximum,
    step,
    ...(source.unit === undefined ? {} : { unit: nonEmptyString(source.unit, `${label} unit`, 24) }),
  }
}

function validateFacet(value: unknown, label: string): CatalogFacet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is invalid.`)
  const source = value as Record<string, unknown>
  if (source.kind === 'terms') return validateTermFacet(source, label)
  if (source.kind === 'range') return validateRangeFacet(source, label)
  throw new Error(`${label} kind is unsupported.`)
}

function validateCategory(value: unknown, index: number): CatalogFacetCategory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Catalog facet category ${index} is invalid.`)
  const source = value as Record<string, unknown>
  if (!Array.isArray(source.facets) || source.facets.length > MAX_FACETS_PER_CATEGORY) {
    throw new Error(`Catalog facet category ${index} facets are invalid or exceed the limit.`)
  }
  const facets = source.facets.map((facet, facetIndex) => validateFacet(facet, `Catalog facet category ${index} facet ${facetIndex}`))
  const keys = new Set<string>()
  for (const facet of facets) {
    if (keys.has(facet.key)) throw new Error(`Catalog facet category ${index} duplicates key ${facet.key}.`)
    keys.add(facet.key)
  }
  return {
    type: nonEmptyString(source.type, `Catalog facet category ${index} type`, 80),
    label: nonEmptyString(source.label, `Catalog facet category ${index} label`, 80),
    count: positiveInteger(source.count, `Catalog facet category ${index} count`, true),
    facets,
  }
}

export function validateCatalogFacetIndex(value: unknown): CatalogFacetIndex {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Catalog facet index must be an object.')
  const source = value as Record<string, unknown>
  if (source.schemaVersion !== CATALOG_FACET_SCHEMA_VERSION) throw new Error('Catalog facet schema is unsupported.')
  const catalogRevision = positiveInteger(source.catalogRevision, 'Catalog facet revision')
  if (typeof source.generatedAt !== 'string' || Number.isNaN(Date.parse(source.generatedAt))) {
    throw new Error('Catalog facet generatedAt must be an ISO timestamp.')
  }
  if (!Array.isArray(source.categories) || source.categories.length > MAX_FACET_CATEGORIES) {
    throw new Error('Catalog facet categories are invalid or exceed the limit.')
  }
  const categories = source.categories.map(validateCategory)
  const types = new Set<string>()
  for (const category of categories) {
    if (types.has(category.type)) throw new Error(`Catalog facet category ${category.type} is duplicated.`)
    types.add(category.type)
  }
  return {
    schemaVersion: CATALOG_FACET_SCHEMA_VERSION,
    catalogRevision,
    generatedAt: source.generatedAt,
    categories,
  }
}
