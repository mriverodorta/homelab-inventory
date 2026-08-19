import { z } from 'zod'

export const inventoryMetadataFieldTypes = [
  'shortText',
  'longText',
  'number',
  'boolean',
  'date',
  'dateTime',
  'singleSelect',
  'multiSelect',
  'url',
] as const

export const inventoryMetadataColorTokens = [
  'gray', 'red', 'orange', 'amber', 'yellow', 'green',
  'teal', 'blue', 'indigo', 'purple', 'pink',
] as const

export type InventoryMetadataFieldType = typeof inventoryMetadataFieldTypes[number]
export type InventoryMetadataColorToken = typeof inventoryMetadataColorTokens[number]

const positiveId = z.number().int().safe().positive()
const revision = positiveId
const timestamp = z.iso.datetime({ offset: true })
const nullableTimestamp = timestamp.nullable()

export const inventoryMetadataOptionSchema = z.strictObject({
  id: positiveId,
  label: z.string().trim().min(1).max(80),
  colorToken: z.enum(inventoryMetadataColorTokens),
  displayOrder: z.number().int().nonnegative(),
  revision,
  archivedAt: nullableTimestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
})

export const customFieldDefinitionSchema = z.strictObject({
  id: positiveId,
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).nullable(),
  fieldType: z.enum(inventoryMetadataFieldTypes),
  unit: z.string().trim().min(1).max(24).nullable(),
  numberMinimum: z.number().finite().nullable(),
  numberMaximum: z.number().finite().nullable(),
  numberPrecision: z.number().int().min(0).max(6).nullable(),
  displayOrder: z.number().int().nonnegative(),
  revision,
  archivedAt: nullableTimestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
  applicableItemTypes: z.array(z.string().trim().min(1)).min(1),
  options: z.array(inventoryMetadataOptionSchema),
})

export const inventoryTagSchema = z.strictObject({
  id: positiveId,
  name: z.string().trim().min(1).max(80),
  colorToken: z.enum(inventoryMetadataColorTokens),
  displayOrder: z.number().int().nonnegative(),
  revision,
  archivedAt: nullableTimestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
})

export const inventoryMetadataCatalogSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  definitions: z.array(customFieldDefinitionSchema),
  tags: z.array(inventoryTagSchema),
})

export const inventoryMetadataValueSchema = z.strictObject({
  definitionId: positiveId,
  value: z.union([z.string(), z.number().finite(), z.boolean()]).optional(),
  optionIds: z.array(positiveId),
  revision,
})

export const inventoryItemMetadataSchema = z.strictObject({
  itemId: positiveId,
  definitions: z.array(customFieldDefinitionSchema),
  values: z.array(inventoryMetadataValueSchema),
  tags: z.array(inventoryTagSchema),
})

export const inventoryMetadataImpactSchema = z.strictObject({
  definitionId: positiveId.optional(),
  tagId: positiveId.optional(),
  itemCount: z.number().int().nonnegative(),
  savedViewCount: z.number().int().nonnegative().optional(),
  optionSelectionCount: z.number().int().nonnegative().optional(),
  affectedItemTypes: z.array(z.strictObject({
    type: z.string().trim().min(1),
    itemCount: z.number().int().nonnegative(),
  })).optional(),
})

export type InventoryMetadataOption = z.infer<typeof inventoryMetadataOptionSchema>
export type CustomFieldDefinition = z.infer<typeof customFieldDefinitionSchema>
export type InventoryTag = z.infer<typeof inventoryTagSchema>
export type InventoryMetadataCatalog = z.infer<typeof inventoryMetadataCatalogSchema>
export type InventoryMetadataValue = z.infer<typeof inventoryMetadataValueSchema>
export type InventoryItemMetadata = z.infer<typeof inventoryItemMetadataSchema>
export type InventoryMetadataImpact = z.infer<typeof inventoryMetadataImpactSchema>

export type InventoryMetadataItemRef = Readonly<{
  type: string
  id: number
}>

export type CustomFieldDefinitionInput = Readonly<{
  name: string
  description?: string | null
  fieldType: InventoryMetadataFieldType
  unit?: string | null
  numberMinimum?: number | null
  numberMaximum?: number | null
  numberPrecision?: number | null
  applicableItemTypes: readonly string[]
  options?: readonly Readonly<{
    id?: number
    label: string
    colorToken: InventoryMetadataColorToken
  }>[]
}>

export type InventoryTagInput = Readonly<{
  name: string
  colorToken: InventoryMetadataColorToken
}>

export type InventoryItemMetadataInput = Readonly<{
  values: readonly Readonly<{
    definitionId: number
    value: string | number | boolean | readonly number[] | null
  }>[]
  tagIds: readonly number[]
}>

export type InventoryMetadataFilter =
  | Readonly<{ operator: 'tags-any'; tagIds: readonly number[] }>
  | Readonly<{ operator: 'has-tags' | 'no-tags' }>
  | Readonly<{ operator: 'contains'; definitionId: number; text: string }>
  | Readonly<{ operator: 'set' | 'unset' | 'yes' | 'no'; definitionId: number }>
  | Readonly<{ operator: 'range'; definitionId: number; minimum?: number | null; maximum?: number | null }>
  | Readonly<{ operator: 'date-range'; definitionId: number; after?: string | null; before?: string | null }>
  | Readonly<{ operator: 'options'; definitionId: number; optionIds: readonly number[] }>

const inventoryMetadataProjectionTagSchema = z.strictObject({
  id: positiveId,
  name: z.string().trim().min(1).max(80),
  colorToken: z.enum(inventoryMetadataColorTokens),
})

const inventoryMetadataProjectionValueSchema = z.strictObject({
  value: z.union([z.string(), z.number().finite(), z.boolean()]).nullable(),
  optionIds: z.array(positiveId),
  display: z.string().nullable(),
})

export const inventoryMetadataProjectProjectionSchema = z.strictObject({
  projectId: positiveId,
  rows: z.array(z.strictObject({
    itemId: positiveId,
    itemType: z.string().trim().min(1),
    legacyId: positiveId,
    tags: z.array(inventoryMetadataProjectionTagSchema),
    values: z.record(z.string(), inventoryMetadataProjectionValueSchema),
    searchText: z.string().optional(),
  })),
  matchingItemIds: z.array(positiveId),
})

export type InventoryMetadataProjectProjection = z.infer<typeof inventoryMetadataProjectProjectionSchema>
export type InventoryMetadataProjectionRow = InventoryMetadataProjectProjection['rows'][number]
export type InventoryMetadataProjectionTag = z.infer<typeof inventoryMetadataProjectionTagSchema>
export type InventoryMetadataProjectionValue = z.infer<typeof inventoryMetadataProjectionValueSchema>

export function readyInventoryMetadataFilters(filters: readonly InventoryMetadataFilter[]) {
  return filters.filter((filter) => {
    if (filter.operator === 'contains') return filter.text.trim().length > 0
    if (filter.operator === 'range') return filter.minimum != null || filter.maximum != null
    if (filter.operator === 'date-range') return Boolean(filter.after || filter.before)
    if (filter.operator === 'options') return filter.optionIds.length > 0
    if (filter.operator === 'tags-any') return filter.tagIds.length > 0
    return true
  })
}
