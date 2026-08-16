import {
  CANONICAL_UNITS_FINGERPRINT_VERSION,
  NAS_FINGERPRINT_VERSION,
  NETWORK_FINGERPRINT_VERSION,
  canonicalizeCatalogItemV10,
  canonicalizeCatalogItemV11,
  canonicalizeCatalogItemV9,
  sanitizeCatalogItem,
  sanitizeCatalogItemV9,
} from '../../packages/catalog-protocol/src/index.ts'
import { planCatalogUpdate } from './catalog-update-semantics.mjs'

function valueAt(item, field) {
  return Object.hasOwn(item, field) ? item[field] : undefined
}

function sanitizeForFingerprint(value, fingerprintVersion) {
  return fingerprintVersion === NETWORK_FINGERPRINT_VERSION
    ? canonicalizeCatalogItemV11(value)
    : fingerprintVersion === NAS_FINGERPRINT_VERSION
    ? canonicalizeCatalogItemV10(value)
    : fingerprintVersion === CANONICAL_UNITS_FINGERPRINT_VERSION
    ? sanitizeCatalogItemV9(value)
    : sanitizeCatalogItem(value)
}

function sanitizeCurrentForFingerprint(value, fingerprintVersion) {
  if (fingerprintVersion === NETWORK_FINGERPRINT_VERSION) return canonicalizeCatalogItemV9(value)
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
  const semantic = planCatalogUpdate(currentValue, nextValue, fingerprintVersion).changes
  const current = sanitizeCurrentForFingerprint(currentValue, fingerprintVersion)
  const next = sanitizeForFingerprint(nextValue, fingerprintVersion)
  const changedFields = [...new Set(semantic.map((change) => change.path.match(/^[^.[\]]+/)?.[0]).filter(Boolean))]
  return changedFields.map((field) => {
    const result = { field, current: valueAt(current, field), next: valueAt(next, field) }
    Object.defineProperty(result, 'semanticChanges', {
      configurable: false,
      enumerable: false,
      value: semantic.filter((change) => change.path === field || change.path.startsWith(`${field}.`) || change.path.startsWith(`${field}[`)),
    })
    return result
  })
}

export function mergeCatalogUpdate(currentValue, nextValue, fingerprintVersion) {
  const current = sanitizeCurrentForFingerprint(currentValue, fingerprintVersion)
  const next = sanitizeForFingerprint(nextValue, fingerprintVersion)
  assertRamMemoryRequirements(current, next, fingerprintVersion)
  return planCatalogUpdate(currentValue, nextValue, fingerprintVersion).nextItem
}
