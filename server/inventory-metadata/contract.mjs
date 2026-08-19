import { INVENTORY_TYPE_SET } from '../db/inventory-capabilities.mjs'

export const FIELD_TYPES = Object.freeze([
  'shortText',
  'longText',
  'number',
  'boolean',
  'date',
  'dateTime',
  'singleSelect',
  'multiSelect',
  'url',
])

export const COLOR_TOKENS = Object.freeze([
  'gray',
  'red',
  'orange',
  'amber',
  'yellow',
  'green',
  'teal',
  'blue',
  'indigo',
  'purple',
  'pink',
])

const FIELD_TYPE_SET = new Set(FIELD_TYPES)
const COLOR_TOKEN_SET = new Set(COLOR_TOKENS)
const SELECT_FIELD_TYPES = new Set(['singleSelect', 'multiSelect'])

export class InventoryMetadataError extends Error {
  constructor(message, { code = 'inventory-metadata-validation', status = 400, details } = {}) {
    super(message)
    this.name = 'InventoryMetadataError'
    this.code = code
    this.status = status
    this.details = details
  }
}

function fail(message, options) {
  throw new InventoryMetadataError(message, options)
}

function compactText(value, label, maximum, { nullable = false } = {}) {
  if (value == null && nullable) return null
  if (typeof value !== 'string') fail(`${label} must be text.`)
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
  if (!normalized && nullable) return null
  if (!normalized) fail(`${label} is required.`)
  if (normalized.length > maximum) fail(`${label} must be ${maximum} characters or fewer.`)
  return normalized
}

function normalizedName(value, label = 'Name') {
  return compactText(value, label, 80).toLocaleLowerCase('en-US')
}

function optionalFinite(value, label) {
  if (value == null || value === '') return null
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} must be a finite number.`)
  return value
}

function positiveId(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${label} must be a positive safe integer.`)
  return value
}

function canonicalOption(option) {
  const label = compactText(option?.label, 'Option label', 80)
  const colorToken = option?.colorToken
  if (!COLOR_TOKEN_SET.has(colorToken)) fail('Option color is not supported.')
  const canonical = { label, normalizedLabel: normalizedName(label, 'Option label'), colorToken }
  if (option?.id != null) canonical.id = positiveId(option.id, 'Option ID')
  return Object.freeze(canonical)
}

export function normalizeFieldDefinitionInput(input) {
  const name = compactText(input?.name, 'Field name', 80)
  const description = compactText(input?.description, 'Description', 500, { nullable: true })
  const fieldType = input?.fieldType
  if (!FIELD_TYPE_SET.has(fieldType)) fail('Custom field type is not supported.')
  if (!Array.isArray(input?.applicableItemTypes) || input.applicableItemTypes.length === 0) {
    fail('At least one applicable inventory type is required.')
  }
  const applicableItemTypes = []
  for (const itemType of input.applicableItemTypes) {
    if (!INVENTORY_TYPE_SET.has(itemType)) fail(`Inventory type ${String(itemType)} is not supported.`)
    if (!applicableItemTypes.includes(itemType)) applicableItemTypes.push(itemType)
  }

  const numberMinimum = optionalFinite(input.numberMinimum, 'Minimum')
  const numberMaximum = optionalFinite(input.numberMaximum, 'Maximum')
  const numberPrecision = input.numberPrecision == null || input.numberPrecision === ''
    ? null
    : input.numberPrecision
  const unit = compactText(input.unit, 'Unit', 24, { nullable: true })
  if (fieldType === 'number') {
    if (numberMinimum != null && numberMaximum != null && numberMinimum > numberMaximum) {
      fail('Minimum cannot exceed maximum.')
    }
    if (numberPrecision != null && (!Number.isSafeInteger(numberPrecision) || numberPrecision < 0 || numberPrecision > 12)) {
      fail('Number precision must be an integer from 0 through 12.')
    }
  } else if (numberMinimum != null || numberMaximum != null || numberPrecision != null || unit != null) {
    fail('Numeric configuration is available only for number fields.')
  }

  const rawOptions = input.options ?? []
  if (!Array.isArray(rawOptions)) fail('Options must be an array.')
  if (!SELECT_FIELD_TYPES.has(fieldType) && rawOptions.length > 0) fail('Only select fields accept options.')
  if (SELECT_FIELD_TYPES.has(fieldType) && rawOptions.length === 0) fail('Select fields require at least one option.')
  const options = rawOptions.map(canonicalOption)
  if (new Set(options.map((option) => option.normalizedLabel)).size !== options.length) {
    fail('Option labels must be unique within a field.')
  }

  return Object.freeze({
    name,
    normalizedName: normalizedName(name, 'Field name'),
    description,
    fieldType,
    applicableItemTypes: Object.freeze(applicableItemTypes),
    unit,
    numberMinimum,
    numberMaximum,
    numberPrecision,
    options: Object.freeze(options),
  })
}

export function normalizeTagInput(input) {
  const name = compactText(input?.name, 'Tag name', 80)
  const colorToken = input?.colorToken
  if (!COLOR_TOKEN_SET.has(colorToken)) fail('Tag color is not supported.')
  return Object.freeze({ name, normalizedName: normalizedName(name, 'Tag name'), colorToken })
}

function canonicalDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) fail('Date must use YYYY-MM-DD.')
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    fail('Date is not valid.')
  }
  return value
}

function canonicalDateTime(value) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail('Date-time must be a valid UTC ISO timestamp.')
  const canonical = new Date(value).toISOString()
  if (canonical !== value) fail('Date-time must use canonical UTC ISO format.')
  return canonical
}

function canonicalOptionIds(value, single) {
  const values = Array.isArray(value) ? value : [value]
  const ids = [...new Set(values.map((entry) => positiveId(entry, 'Option ID')))].sort((left, right) => left - right)
  if (single && ids.length > 1) fail('Single-select fields accept one option.')
  if (ids.length === 0) fail('At least one option is required.')
  return Object.freeze(ids)
}

export function normalizeMetadataValueInput(definition, value) {
  if (value == null || value === '') return null
  switch (definition?.fieldType) {
    case 'shortText':
      return Object.freeze({ textValue: compactText(value, 'Value', 255), optionIds: Object.freeze([]) })
    case 'longText':
      return Object.freeze({ textValue: compactText(value, 'Value', 10_000), optionIds: Object.freeze([]) })
    case 'url': {
      const textValue = compactText(value, 'URL', 2_048)
      let url
      try {
        url = new URL(textValue)
      } catch {
        fail('URL must be valid.')
      }
      if (!['http:', 'https:'].includes(url.protocol)) fail('URL must use HTTP or HTTPS.')
      return Object.freeze({ textValue: url.toString(), optionIds: Object.freeze([]) })
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) fail('Value must be a finite number.')
      if (definition.numberMinimum != null && value < definition.numberMinimum) fail('Value is below the configured minimum.')
      if (definition.numberMaximum != null && value > definition.numberMaximum) fail('Value exceeds the configured maximum.')
      if (definition.numberPrecision != null && Math.abs(value - Number(value.toFixed(definition.numberPrecision))) > Number.EPSILON * 10) {
        fail(`Value must use no more than ${definition.numberPrecision} decimal places.`)
      }
      return Object.freeze({ numberValue: value, optionIds: Object.freeze([]) })
    }
    case 'boolean':
      if (typeof value !== 'boolean') fail('Value must be yes or no.')
      return Object.freeze({ booleanValue: value, optionIds: Object.freeze([]) })
    case 'date':
      return Object.freeze({ dateValue: canonicalDate(value), optionIds: Object.freeze([]) })
    case 'dateTime':
      return Object.freeze({ dateTimeValue: canonicalDateTime(value), optionIds: Object.freeze([]) })
    case 'singleSelect':
      return Object.freeze({ optionIds: canonicalOptionIds(value, true) })
    case 'multiSelect':
      return Object.freeze({ optionIds: canonicalOptionIds(value, false) })
    default:
      fail('Custom field type is not supported.')
  }
}
