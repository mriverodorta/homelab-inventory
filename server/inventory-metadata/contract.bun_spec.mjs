import { describe, expect, test } from 'bun:test'
import {
  COLOR_TOKENS,
  FIELD_TYPES,
  InventoryMetadataError,
  normalizeFieldDefinitionInput,
  normalizeMetadataValueInput,
  normalizeTagInput,
} from './contract.mjs'

describe('inventory metadata contract', () => {
  test('publishes the frozen field and color vocabularies', () => {
    expect(FIELD_TYPES).toEqual([
      'shortText', 'longText', 'number', 'boolean', 'date',
      'dateTime', 'singleSelect', 'multiSelect', 'url',
    ])
    expect(COLOR_TOKENS).toContain('green')
    expect(Object.isFrozen(FIELD_TYPES)).toBeTrue()
  })

  test('normalizes field definitions and select options', () => {
    expect(normalizeFieldDefinitionInput({
      name: '  Lifecycle  ',
      description: '  Current hardware lifecycle ',
      fieldType: 'singleSelect',
      applicableItemTypes: ['server', 'server', 'nas'],
      options: [
        { label: ' Active ', colorToken: 'green' },
        { label: ' Retired ', colorToken: 'gray' },
      ],
    })).toEqual({
      name: 'Lifecycle',
      normalizedName: 'lifecycle',
      description: 'Current hardware lifecycle',
      fieldType: 'singleSelect',
      applicableItemTypes: ['server', 'nas'],
      unit: null,
      numberMinimum: null,
      numberMaximum: null,
      numberPrecision: null,
      options: [
        { label: 'Active', normalizedLabel: 'active', colorToken: 'green' },
        { label: 'Retired', normalizedLabel: 'retired', colorToken: 'gray' },
      ],
    })
  })

  test('validates numeric configuration and canonical values', () => {
    const definition = normalizeFieldDefinitionInput({
      name: 'Rack units',
      fieldType: 'number',
      applicableItemTypes: ['server'],
      unit: 'U',
      numberMinimum: 1,
      numberMaximum: 48,
      numberPrecision: 0,
    })
    expect(normalizeMetadataValueInput(definition, 42)).toEqual({ numberValue: 42, optionIds: [] })
    expect(() => normalizeMetadataValueInput(definition, 42.5)).toThrow(InventoryMetadataError)
    expect(() => normalizeMetadataValueInput(definition, 49)).toThrow(/maximum/iu)
  })

  test('accepts canonical dates, date-times, booleans, and safe URLs', () => {
    expect(normalizeMetadataValueInput({ fieldType: 'date' }, '2026-08-19')).toEqual({ dateValue: '2026-08-19', optionIds: [] })
    expect(normalizeMetadataValueInput({ fieldType: 'dateTime' }, '2026-08-19T15:30:00.000Z')).toEqual({ dateTimeValue: '2026-08-19T15:30:00.000Z', optionIds: [] })
    expect(normalizeMetadataValueInput({ fieldType: 'boolean' }, false)).toEqual({ booleanValue: false, optionIds: [] })
    expect(normalizeMetadataValueInput({ fieldType: 'url' }, 'https://example.test/device')).toEqual({ textValue: 'https://example.test/device', optionIds: [] })
    expect(() => normalizeMetadataValueInput({ fieldType: 'url' }, 'javascript:alert(1)')).toThrow(/http/iu)
    expect(() => normalizeMetadataValueInput({ fieldType: 'date' }, '2026-02-30')).toThrow(/date/iu)
  })

  test('normalizes option IDs and rejects invalid text lengths', () => {
    expect(normalizeMetadataValueInput({ fieldType: 'multiSelect' }, [3, 1, 3])).toEqual({ optionIds: [1, 3] })
    expect(() => normalizeMetadataValueInput({ fieldType: 'singleSelect' }, [1, 2])).toThrow(/one option/iu)
    expect(() => normalizeMetadataValueInput({ fieldType: 'shortText' }, 'x'.repeat(256))).toThrow(/255/iu)
    expect(() => normalizeMetadataValueInput({ fieldType: 'longText' }, 'x'.repeat(10_001))).toThrow(/10000/iu)
  })

  test('normalizes tags and emits structured errors', () => {
    expect(normalizeTagInput({ name: ' Production ', colorToken: 'red' })).toEqual({
      name: 'Production',
      normalizedName: 'production',
      colorToken: 'red',
    })
    try {
      normalizeTagInput({ name: '', colorToken: 'red' })
      throw new Error('Expected validation to fail.')
    } catch (error) {
      expect(error).toBeInstanceOf(InventoryMetadataError)
      expect(error.code).toBe('inventory-metadata-validation')
      expect(error.status).toBe(400)
    }
  })
})
