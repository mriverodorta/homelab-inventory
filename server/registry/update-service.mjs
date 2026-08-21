import {
  CANONICAL_UNITS_FINGERPRINT_VERSION,
  NAS_FINGERPRINT_VERSION,
  NETWORK_FINGERPRINT_VERSION,
  M2_AE_FINGERPRINT_VERSION,
  canonicalizeCatalogItemV10,
  canonicalizeCatalogItemV11,
  canonicalizeCatalogItemV12,
  canonicalizeCatalogItemV12UpdateCurrent,
  canonicalizeCatalogItemV9,
  sanitizeCatalogItem,
  sanitizeCatalogItemV9,
} from '../../packages/catalog-protocol/src/index.ts'
import { planCatalogUpdate } from './catalog-update-semantics.mjs'

export function catalogUpdateVersionContext(template) {
  return {
    sourceFingerprintVersion: template.fingerprintVersion,
    runtimeCanonicalVersion: template.runtimeCanonicalVersion ?? template.fingerprintVersion,
  }
}

function valueAt(item, field) {
  return Object.hasOwn(item, field) ? item[field] : undefined
}

function sanitizeForFingerprint(value, fingerprintVersion) {
  return fingerprintVersion === M2_AE_FINGERPRINT_VERSION
    ? canonicalizeCatalogItemV12(value)
    : fingerprintVersion === NETWORK_FINGERPRINT_VERSION
    ? canonicalizeCatalogItemV11(value)
    : fingerprintVersion === NAS_FINGERPRINT_VERSION
    ? canonicalizeCatalogItemV10(value)
    : fingerprintVersion === CANONICAL_UNITS_FINGERPRINT_VERSION
    ? sanitizeCatalogItemV9(value)
    : sanitizeCatalogItem(value)
}

function sanitizeCurrentForFingerprint(value, fingerprintVersion) {
  if (fingerprintVersion === M2_AE_FINGERPRINT_VERSION) return canonicalizeCatalogItemV12UpdateCurrent(value)
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

export function catalogFieldDiff(currentValue, nextValue, versionInput) {
  const plan = planCatalogUpdate(currentValue, nextValue, versionInput)
  const runtimeCanonicalVersion = typeof versionInput === 'object'
    ? versionInput.runtimeCanonicalVersion ?? versionInput.sourceFingerprintVersion
    : versionInput
  const semantic = plan.changes
  const current = plan.currentItem
  const next = sanitizeCurrentForFingerprint(plan.nextItem, runtimeCanonicalVersion)
  const operations = semantic.filter((change) => change.kind === 'reclassify-resource')
  const fieldChanges = semantic.filter((change) => change.kind !== 'reclassify-resource')
  const semanticFields = new Set(operations.map((change) => change.path.match(/^[^.[\]]+/)?.[0]).filter(Boolean))
  const detailed = fieldChanges.filter((change) => semanticFields.has(change.path.match(/^[^.[\]]+/)?.[0]))
  const groupedChanges = fieldChanges.filter((change) => !semanticFields.has(change.path.match(/^[^.[\]]+/)?.[0]))
  const changedFields = [...new Set(groupedChanges.map((change) => change.path.match(/^[^.[\]]+/)?.[0]).filter(Boolean))]
  const grouped = changedFields.map((field) => {
    const related = groupedChanges.filter((change) => (
      change.path === field || change.path.startsWith(`${field}.`) || change.path.startsWith(`${field}[`)
    ))
    const direct = related.length === 1 && related[0].path === field ? related[0] : null
    const result = {
      field,
      current: direct && Object.hasOwn(direct, 'current') ? direct.current : valueAt(current, field),
      next: direct && Object.hasOwn(direct, 'next') ? direct.next : valueAt(next, field),
    }
    Object.defineProperty(result, 'semanticChanges', {
      configurable: false,
      enumerable: false,
      value: related,
    })
    return result
  })
  return [...grouped, ...operations, ...detailed]
}

export function mergeCatalogUpdate(currentValue, nextValue, versionInput) {
  const runtimeCanonicalVersion = typeof versionInput === 'object'
    ? versionInput.runtimeCanonicalVersion ?? versionInput.sourceFingerprintVersion
    : versionInput
  const plan = planCatalogUpdate(currentValue, nextValue, versionInput)
  const current = plan.currentItem
  const next = sanitizeForFingerprint(nextValue, runtimeCanonicalVersion)
  assertRamMemoryRequirements(current, next, runtimeCanonicalVersion)
  return plan.nextItem
}
