import { sql } from 'drizzle-orm'
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { inventoryItems, inventoryItemTypes } from './inventory-base.ts'

export const customFieldDefinitions = sqliteTable('custom_field_definitions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  description: text('description'),
  fieldType: text('field_type').notNull(),
  unit: text('unit'),
  numberMinimum: real('number_minimum'),
  numberMaximum: real('number_maximum'),
  numberPrecision: integer('number_precision'),
  displayOrder: integer('display_order').notNull(),
  revision: integer('revision').notNull().default(1),
  archivedAtMs: integer('archived_at_ms'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('custom_field_definitions_normalized_name_unique').on(table.normalizedName),
  index('custom_field_definitions_archived_index').on(table.archivedAtMs, table.displayOrder, table.id),
  check('custom_field_definitions_name_check', sql`length(trim(${table.name})) BETWEEN 1 AND 80`),
  check('custom_field_definitions_normalized_name_check', sql`${table.normalizedName} = lower(trim(${table.normalizedName})) AND length(${table.normalizedName}) BETWEEN 1 AND 80`),
  check('custom_field_definitions_description_check', sql`${table.description} IS NULL OR length(${table.description}) <= 500`),
  check('custom_field_definitions_type_check', sql`${table.fieldType} IN ('shortText','longText','number','boolean','date','dateTime','singleSelect','multiSelect','url')`),
  check('custom_field_definitions_unit_check', sql`${table.unit} IS NULL OR length(trim(${table.unit})) BETWEEN 1 AND 24`),
  check('custom_field_definitions_number_configuration_check', sql`
    (
      ${table.fieldType} = 'number'
      AND (${table.numberMinimum} IS NULL OR typeof(${table.numberMinimum}) IN ('integer','real'))
      AND (${table.numberMaximum} IS NULL OR typeof(${table.numberMaximum}) IN ('integer','real'))
      AND (${table.numberMinimum} IS NULL OR ${table.numberMaximum} IS NULL OR ${table.numberMinimum} <= ${table.numberMaximum})
      AND (${table.numberPrecision} IS NULL OR ${table.numberPrecision} BETWEEN 0 AND 12)
    ) OR (
      ${table.fieldType} <> 'number'
      AND ${table.numberMinimum} IS NULL
      AND ${table.numberMaximum} IS NULL
      AND ${table.numberPrecision} IS NULL
      AND ${table.unit} IS NULL
    )
  `),
  check('custom_field_definitions_order_check', sql`${table.displayOrder} >= 0`),
  check('custom_field_definitions_revision_check', sql`${table.revision} > 0`),
])

export const customFieldApplicability = sqliteTable('custom_field_applicability', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  definitionId: integer('definition_id').notNull().references(() => customFieldDefinitions.id, { onDelete: 'cascade' }),
  itemTypeId: integer('item_type_id').notNull().references(() => inventoryItemTypes.id, { onDelete: 'restrict' }),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [
  uniqueIndex('custom_field_applicability_definition_type_unique').on(table.definitionId, table.itemTypeId),
  index('custom_field_applicability_type_index').on(table.itemTypeId, table.definitionId),
])

export const customFieldOptions = sqliteTable('custom_field_options', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  definitionId: integer('definition_id').notNull().references(() => customFieldDefinitions.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  normalizedLabel: text('normalized_label').notNull(),
  colorToken: text('color_token').notNull(),
  displayOrder: integer('display_order').notNull(),
  revision: integer('revision').notNull().default(1),
  archivedAtMs: integer('archived_at_ms'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('custom_field_options_definition_label_unique').on(table.definitionId, table.normalizedLabel),
  index('custom_field_options_definition_archived_index').on(table.definitionId, table.archivedAtMs, table.displayOrder, table.id),
  check('custom_field_options_label_check', sql`length(trim(${table.label})) BETWEEN 1 AND 80`),
  check('custom_field_options_normalized_label_check', sql`${table.normalizedLabel} = lower(trim(${table.normalizedLabel})) AND length(${table.normalizedLabel}) BETWEEN 1 AND 80`),
  check('custom_field_options_color_check', sql`${table.colorToken} IN ('gray','red','orange','amber','yellow','green','teal','blue','indigo','purple','pink')`),
  check('custom_field_options_order_check', sql`${table.displayOrder} >= 0`),
  check('custom_field_options_revision_check', sql`${table.revision} > 0`),
])

export const inventoryCustomFieldValues = sqliteTable('inventory_custom_field_values', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  definitionId: integer('definition_id').notNull().references(() => customFieldDefinitions.id, { onDelete: 'cascade' }),
  itemId: integer('item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  textValue: text('text_value'),
  numberValue: real('number_value'),
  booleanValue: integer('boolean_value', { mode: 'boolean' }),
  dateValue: text('date_value'),
  dateTimeValue: text('date_time_value'),
  revision: integer('revision').notNull().default(1),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('inventory_custom_field_values_definition_item_unique').on(table.definitionId, table.itemId),
  index('inventory_custom_field_values_item_index').on(table.itemId, table.definitionId),
  index('inventory_custom_field_values_text_index').on(table.definitionId, table.textValue),
  index('inventory_custom_field_values_number_index').on(table.definitionId, table.numberValue),
  index('inventory_custom_field_values_date_index').on(table.definitionId, table.dateValue),
  index('inventory_custom_field_values_date_time_index').on(table.definitionId, table.dateTimeValue),
  check('inventory_custom_field_values_boolean_check', sql`${table.booleanValue} IS NULL OR ${table.booleanValue} IN (0, 1)`),
  check('inventory_custom_field_values_revision_check', sql`${table.revision} > 0`),
])

export const inventoryCustomFieldOptionValues = sqliteTable('inventory_custom_field_option_values', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  valueId: integer('value_id').notNull().references(() => inventoryCustomFieldValues.id, { onDelete: 'cascade' }),
  optionId: integer('option_id').notNull().references(() => customFieldOptions.id, { onDelete: 'cascade' }),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [
  uniqueIndex('inventory_custom_field_option_values_value_option_unique').on(table.valueId, table.optionId),
  index('inventory_custom_field_option_values_option_index').on(table.optionId, table.valueId),
])

export const inventoryTags = sqliteTable('inventory_tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  colorToken: text('color_token').notNull(),
  displayOrder: integer('display_order').notNull(),
  revision: integer('revision').notNull().default(1),
  archivedAtMs: integer('archived_at_ms'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('inventory_tags_normalized_name_unique').on(table.normalizedName),
  index('inventory_tags_archived_index').on(table.archivedAtMs, table.displayOrder, table.id),
  check('inventory_tags_name_check', sql`length(trim(${table.name})) BETWEEN 1 AND 80`),
  check('inventory_tags_normalized_name_check', sql`${table.normalizedName} = lower(trim(${table.normalizedName})) AND length(${table.normalizedName}) BETWEEN 1 AND 80`),
  check('inventory_tags_color_check', sql`${table.colorToken} IN ('gray','red','orange','amber','yellow','green','teal','blue','indigo','purple','pink')`),
  check('inventory_tags_order_check', sql`${table.displayOrder} >= 0`),
  check('inventory_tags_revision_check', sql`${table.revision} > 0`),
])

export const inventoryItemTags = sqliteTable('inventory_item_tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  tagId: integer('tag_id').notNull().references(() => inventoryTags.id, { onDelete: 'cascade' }),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [
  uniqueIndex('inventory_item_tags_item_tag_unique').on(table.itemId, table.tagId),
  index('inventory_item_tags_tag_index').on(table.tagId, table.itemId),
])

export const inventoryItemMetadataRevisions = sqliteTable('inventory_item_metadata_revisions', {
  itemId: integer('item_id').primaryKey().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull().default(1),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  check('inventory_item_metadata_revisions_revision_check', sql`${table.revision} > 0`),
])
