import { classifyShareField } from '../../packages/share-contract/src/index.ts'

const SAFE_DEFINITION_FIELDS = new Set([
  'type', 'manufacturer', 'model', 'family', 'number', 'productNumber', 'subtype',
  'formFactor', 'hardwareClass', 'physicalClass', 'usageRole', 'specs',
  'compatibility', 'dimensions', 'power', 'capacity', 'interface', 'connector',
])
const SAFE_LOCAL_OVERRIDE_FIELDS = new Set(['usageRole'])

export function sanitizeShareJson(value, path = '$') {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Share field ${path} must be finite.`)
    return value
  }
  if (Array.isArray(value)) return value.map((entry, index) => sanitizeShareJson(entry, `${path}[${index}]`))
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`Share field ${path} is not JSON data.`)
  }
  const result = {}
  for (const [field, entry] of Object.entries(value)) {
    if (classifyShareField(field) === 'forbidden') continue
    if (classifyShareField(field) === 'explicit-opt-in') continue
    result[field] = sanitizeShareJson(entry, `${path}.${field}`)
  }
  return result
}

export function sanitizeCustomDefinition(item) {
  const source = item.definition ?? item
  const result = {}
  for (const field of SAFE_DEFINITION_FIELDS) {
    if (source[field] !== undefined) result[field] = sanitizeShareJson(source[field], `$.${field}`)
  }
  return result
}

export function sanitizeLocalOverrides(value) {
  const result = {}
  for (const field of SAFE_LOCAL_OVERRIDE_FIELDS) {
    if (value?.[field] !== undefined) result[field] = sanitizeShareJson(value[field], `$.localOverrides.${field}`)
  }
  return result
}

export function selectedMetadata(metadata, { fieldDefinitionIds = [], tagIds = [] } = {}) {
  const selectedFields = new Set(fieldDefinitionIds)
  const selectedTags = new Set(tagIds)
  return {
    tags: (metadata?.tags ?? []).filter((tag) => selectedTags.has(tag.id)),
    fields: (metadata?.customFields ?? []).filter((field) => selectedFields.has(field.definitionId)),
  }
}
