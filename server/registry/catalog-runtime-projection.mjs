import {
  CANONICAL_UNITS_FINGERPRINT_VERSION,
  NAS_FINGERPRINT_VERSION,
  SUPPORTED_FINGERPRINT_VERSIONS,
  canonicalizeCatalogItemV10,
  canonicalizeCatalogItemV9,
} from '../../packages/catalog-protocol/src/index.ts'

function canonicalizeHistoricalItem(item) {
  const projected = structuredClone(item)
  const ambiguousCacheMb = projected?.specs?.cacheMib === undefined
    && typeof projected?.specs?.cacheMb === 'number'
    ? projected.specs.cacheMb
    : undefined
  if (ambiguousCacheMb !== undefined) delete projected.specs.cacheMb

  const canonical = canonicalizeCatalogItemV9(projected)
  if (ambiguousCacheMb !== undefined) {
    canonical.specs = { ...(canonical.specs ?? {}), cacheMb: ambiguousCacheMb }
  }
  return canonical
}

export function projectCatalogTemplateForRuntime(template) {
  if (!template || typeof template !== 'object') {
    throw new Error('Catalog runtime projection requires a template.')
  }
  if (!SUPPORTED_FINGERPRINT_VERSIONS.includes(template.fingerprintVersion)) {
    throw new Error(`Catalog template ${String(template.templateKey)} uses an unsupported fingerprint version.`)
  }

  const item = template.fingerprintVersion === NAS_FINGERPRINT_VERSION
    ? canonicalizeCatalogItemV10(template.item)
    : template.fingerprintVersion === CANONICAL_UNITS_FINGERPRINT_VERSION
      ? canonicalizeCatalogItemV9(template.item)
      : canonicalizeHistoricalItem(template.item)

  return {
    ...template,
    item,
    runtimeCanonicalVersion: template.fingerprintVersion === NAS_FINGERPRINT_VERSION
      ? NAS_FINGERPRINT_VERSION
      : CANONICAL_UNITS_FINGERPRINT_VERSION,
  }
}
