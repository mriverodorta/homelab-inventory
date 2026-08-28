import { INVENTORY_CATEGORY_ORDER } from '@/lib/inventory'
import type { InventoryFilters } from '@/lib/sort'
import type { InventoryType } from '@/types/inventory'
import {
  readyInventoryMetadataFilters,
  type InventoryMetadataFilter,
} from '@/types/inventory-metadata'

export type InventorySidebarPreferences = Readonly<{
  version: 1
  filters: InventoryFilters
  metadataFilters: InventoryMetadataFilter[]
  collapsedTypes: InventoryType[]
}>

export const DEFAULT_INVENTORY_SIDEBAR_PREFERENCES: InventorySidebarPreferences = Object.freeze({
  version: 1,
  filters: Object.freeze({
    query: '',
    type: 'all',
    status: 'available',
    sort: 'type',
  }),
  metadataFilters: Object.freeze([]) as unknown as InventoryMetadataFilter[],
  collapsedTypes: Object.freeze([]) as unknown as InventoryType[],
})

const inventoryTypes = new Set<string>(INVENTORY_CATEGORY_ORDER)
const statuses = new Set(['available', 'assigned', 'archived', 'all'])
const sorts = new Set(['type', 'name', 'capacity', 'speed', 'slot-status'])

function storageKey(scope: string) {
  return `homelab-inventory:inventory-sidebar:v1:${scope}`
}

function positiveIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((entry): entry is number => (
    Number.isSafeInteger(entry) && Number(entry) > 0
  )))].sort((left, right) => left - right)
}

function positiveId(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null
}

function finiteOrNull(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 100) : null
}

function normalizeMetadataFilter(value: unknown): InventoryMetadataFilter | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const operator = candidate.operator
  if (operator === 'has-tags' || operator === 'no-tags') return { operator }
  if (operator === 'tags-any') {
    const tagIds = positiveIds(candidate.tagIds)
    return tagIds.length > 0 ? { operator, tagIds } : null
  }

  const definitionId = positiveId(candidate.definitionId)
  if (!definitionId) return null
  if (operator === 'set' || operator === 'unset' || operator === 'yes' || operator === 'no') {
    return { operator, definitionId }
  }
  if (operator === 'contains') {
    return typeof candidate.text === 'string' && candidate.text.trim().length > 0
      ? { operator, definitionId, text: candidate.text.slice(0, 500) }
      : null
  }
  if (operator === 'range') {
    const minimum = finiteOrNull(candidate.minimum)
    const maximum = finiteOrNull(candidate.maximum)
    return minimum !== null || maximum !== null
      ? { operator, definitionId, minimum, maximum }
      : null
  }
  if (operator === 'date-range') {
    const after = stringOrNull(candidate.after)
    const before = stringOrNull(candidate.before)
    return after || before ? { operator, definitionId, after, before } : null
  }
  if (operator === 'options') {
    const optionIds = positiveIds(candidate.optionIds)
    return optionIds.length > 0 ? { operator, definitionId, optionIds } : null
  }
  return null
}

function normalizeMetadataFilters(value: unknown): InventoryMetadataFilter[] {
  if (!Array.isArray(value)) return []
  return readyInventoryMetadataFilters(value
    .map(normalizeMetadataFilter)
    .filter((entry): entry is InventoryMetadataFilter => entry !== null))
    .slice(0, 25)
}

function normalizeCollapsedTypes(value: unknown): InventoryType[] {
  if (!Array.isArray(value)) return []
  const values = new Set(value.filter((entry): entry is InventoryType => (
    typeof entry === 'string' && inventoryTypes.has(entry)
  )))
  return INVENTORY_CATEGORY_ORDER.filter((type) => values.has(type))
}

function normalizePreferences(value: unknown): InventorySidebarPreferences {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const filters = candidate.filters && typeof candidate.filters === 'object'
    ? candidate.filters as Record<string, unknown>
    : {}
  return {
    version: 1,
    filters: {
      query: typeof filters.query === 'string' ? filters.query.slice(0, 200) : '',
      type: filters.type === 'all' || (typeof filters.type === 'string' && inventoryTypes.has(filters.type))
        ? filters.type as InventoryType | 'all'
        : 'all',
      status: typeof filters.status === 'string' && statuses.has(filters.status)
        ? filters.status as InventoryFilters['status']
        : 'available',
      sort: typeof filters.sort === 'string' && sorts.has(filters.sort)
        ? filters.sort as InventoryFilters['sort']
        : 'type',
    },
    metadataFilters: normalizeMetadataFilters(candidate.metadataFilters),
    collapsedTypes: normalizeCollapsedTypes(candidate.collapsedTypes),
  }
}

export function readInventorySidebarPreferences(
  scope: string,
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): InventorySidebarPreferences {
  try {
    return normalizePreferences(JSON.parse(storage.getItem(storageKey(scope)) ?? '{}'))
  } catch {
    return normalizePreferences(null)
  }
}

export function writeInventorySidebarPreferences(
  scope: string,
  preferences: InventorySidebarPreferences,
  storage: Pick<Storage, 'setItem'> = window.localStorage,
) {
  storage.setItem(storageKey(scope), JSON.stringify(normalizePreferences(preferences)))
}

export function clearInventorySidebarPreferences(
  scope: string,
  storage: Pick<Storage, 'removeItem'> = window.localStorage,
) {
  storage.removeItem(storageKey(scope))
}
