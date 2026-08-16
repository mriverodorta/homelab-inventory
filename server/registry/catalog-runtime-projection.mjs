import {
  CANONICAL_MEASUREMENT_CONFLICT,
  CANONICAL_UNITS_FINGERPRINT_VERSION,
  CanonicalMeasurementError,
  NAS_FINGERPRINT_VERSION,
  SUPPORTED_FINGERPRINT_VERSIONS,
  canonicalizeCatalogItemV10,
  canonicalizeCatalogItemV9,
  legacyMeasurementPathsV9,
} from '../../packages/catalog-protocol/src/index.ts'

function pathSegments(path) {
  return path.match(/[^.[\]]+/g) ?? []
}

function parentAtPath(value, path) {
  const segments = pathSegments(path)
  const key = segments.pop()
  let parent = value

  for (const segment of segments) {
    if (!parent || typeof parent !== 'object') return null
    parent = parent[segment]
  }

  return parent && typeof parent === 'object' && key !== undefined
    ? { parent, key }
    : null
}

function restoreAtPath(value, path, restored) {
  const target = parentAtPath(value, path)
  if (!target) throw new Error(`Unable to restore historical catalog field ${path}.`)
  target.parent[target.key] = restored
}

function canonicalizeHistoricalItem(item) {
  const projected = structuredClone(item)
  const preserved = []

  while (true) {
    try {
      const canonical = canonicalizeCatalogItemV9(projected)
      for (const field of preserved) restoreAtPath(canonical, field.path, field.value)
      return canonical
    } catch (error) {
      const legacyPaths = new Set(legacyMeasurementPathsV9(projected))
      if (!(error instanceof CanonicalMeasurementError)
        || error.code === CANONICAL_MEASUREMENT_CONFLICT
        || !legacyPaths.has(error.path)) {
        throw error
      }

      const target = parentAtPath(projected, error.path)
      if (!target || !(target.key in target.parent)) throw error
      preserved.push({ path: error.path, value: target.parent[target.key] })
      delete target.parent[target.key]
    }
  }
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
