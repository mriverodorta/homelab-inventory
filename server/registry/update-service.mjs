import {
  CANONICAL_UNITS_FINGERPRINT_VERSION,
  NAS_FINGERPRINT_VERSION,
  canonicalJson,
  canonicalizeCatalogItemV10,
  canonicalizeCatalogItemV9,
  sanitizeCatalogItem,
  sanitizeCatalogItemV9,
} from '../../packages/catalog-protocol/src/index.ts'

const CATALOG_FIELDS = [
  'type',
  'name',
  'subtype',
  'manufacturer',
  'secondaryManufacturer',
  'family',
  'model',
  'number',
  'aliases',
  'specs',
  'ports',
  'compatibility',
  'fixedComponents',
]

function valueAt(item, field) {
  return Object.hasOwn(item, field) ? item[field] : undefined
}

function sanitizeForFingerprint(value, fingerprintVersion) {
  return fingerprintVersion === NAS_FINGERPRINT_VERSION
    ? canonicalizeCatalogItemV10(value)
    : fingerprintVersion === CANONICAL_UNITS_FINGERPRINT_VERSION
    ? sanitizeCatalogItemV9(value)
    : sanitizeCatalogItem(value)
}

function sanitizeCurrentForFingerprint(value, fingerprintVersion) {
  if (fingerprintVersion !== NAS_FINGERPRINT_VERSION) return sanitizeForFingerprint(value, fingerprintVersion)
  return canonicalizeCatalogItemV10(canonicalizeCatalogItemV9(value))
}

function assertRamMemoryRequirements(currentValue, nextValue, fingerprintVersion) {
  if (nextValue?.type !== 'ram') return
  const current = currentValue?.compatibility?.requirements?.memory
  const next = nextValue?.compatibility?.requirements?.memory
  const requiredFields = [
    fingerprintVersion === CANONICAL_UNITS_FINGERPRINT_VERSION ? 'capacityMib' : 'capacityGb',
    'generation', 'speedMt', 'formFactor', 'moduleType', 'ecc',
  ]
  if (current && !next) {
    throw new Error('RAM catalog updates cannot remove structured memory requirements.')
  }
  if (!next) return
  for (const field of requiredFields) {
    if (current?.[field] !== undefined && next[field] === undefined) {
      throw new Error(`RAM catalog updates cannot remove memory requirement ${field}.`)
    }
    if (
      next[field] !== undefined
      && nextValue.specs?.[field] !== undefined
      && next[field] !== nextValue.specs[field]
    ) {
      throw new Error(`RAM catalog memory requirement ${field} contradicts its specification.`)
    }
  }
}

export function catalogFieldDiff(currentValue, nextValue, fingerprintVersion) {
  const current = sanitizeCurrentForFingerprint(currentValue, fingerprintVersion)
  const next = sanitizeForFingerprint(nextValue, fingerprintVersion)
  return CATALOG_FIELDS.flatMap((field) => (
    canonicalJson(valueAt(current, field)) === canonicalJson(valueAt(next, field))
      ? []
      : [{ field, current: valueAt(current, field), next: valueAt(next, field) }]
  ))
}

export function mergeCatalogUpdate(currentValue, nextValue, fingerprintVersion) {
  const current = structuredClone(currentValue)
  const next = sanitizeForFingerprint(nextValue, fingerprintVersion)
  assertRamMemoryRequirements(sanitizeCurrentForFingerprint(current, fingerprintVersion), next, fingerprintVersion)
  const result = { ...next, ...(current.name ? { name: current.name } : {}) }
  for (const [key, value] of Object.entries(current)) {
    if (key === 'id' || key === 'key' || key === 'type' || CATALOG_FIELDS.includes(key)) continue
    result[key] = value
  }
  return result
}
