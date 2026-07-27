import { canonicalJson, sanitizeCatalogItem } from '../../packages/catalog-protocol/src/index.ts'

const CATALOG_FIELDS = [
  'name',
  'subtype',
  'manufacturer',
  'secondaryManufacturer',
  'family',
  'model',
  'number',
  'specs',
  'ports',
  'compatibility',
]

function valueAt(item, field) {
  return Object.hasOwn(item, field) ? item[field] : undefined
}

export function catalogFieldDiff(currentValue, nextValue) {
  const current = sanitizeCatalogItem(currentValue)
  const next = sanitizeCatalogItem(nextValue)
  return CATALOG_FIELDS.flatMap((field) => (
    canonicalJson(valueAt(current, field)) === canonicalJson(valueAt(next, field))
      ? []
      : [{ field, current: valueAt(current, field), next: valueAt(next, field) }]
  ))
}

export function mergeCatalogUpdate(currentValue, nextValue) {
  const current = structuredClone(currentValue)
  const next = sanitizeCatalogItem(nextValue)
  const result = { ...next }
  for (const [key, value] of Object.entries(current)) {
    if (key === 'id' || key === 'key' || key === 'type' || CATALOG_FIELDS.includes(key)) continue
    result[key] = value
  }
  return result
}
