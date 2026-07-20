import {
  getAssignedItemIds,
  getPlacedCanvasItemIds,
  isArchivedItem,
} from '@/lib/project'
import { isCanvasEquipmentType, isHostType } from '@/lib/inventory-capabilities'
import { INVENTORY_TYPE_RANK } from '@/lib/inventory'
import { runtimeItemKey } from '@/lib/item-keys'
import type { InventoryItem, InventoryType, ProjectState } from '@/types/inventory'

export type InventoryStatusFilter = 'available' | 'assigned' | 'archived' | 'all'
export type SortKey = 'type' | 'name' | 'capacity' | 'speed' | 'slot-status'

export type InventoryFilters = {
  query: string
  type: InventoryType | 'all'
  status: InventoryStatusFilter
  sort: SortKey
}

function numericSpec(item: InventoryItem, keys: string[]): number {
  for (const key of keys) {
    const value = item.specs?.[key]

    if (typeof value === 'number') {
      return value
    }
  }

  return 0
}

export function isItemAssigned(project: ProjectState, item: InventoryItem): boolean {
  if (isCanvasEquipmentType(item.type)) {
    return getPlacedCanvasItemIds(project).has(runtimeItemKey(item))
  }

  return getAssignedItemIds(project).has(runtimeItemKey(item))
}

export function filterAndSortInventory(
  project: ProjectState,
  filters: InventoryFilters,
): InventoryItem[] {
  const query = filters.query.trim().toLowerCase()

  return Object.values(project.items)
    .filter((item) => {
      const assigned = isItemAssigned(project, item)
      const archived = isArchivedItem(item)

      if (filters.type !== 'all' && item.type !== filters.type) {
        return false
      }

      if (filters.status === 'available' && (archived || assigned)) {
        return false
      }

      if (filters.status === 'assigned' && (archived || !assigned)) {
        return false
      }

      if (filters.status === 'archived' && !archived) {
        return false
      }

      if (!query) {
        return true
      }

      return [item.name, item.manufacturer, item.model, item.subtype]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
    .sort((a, b) => compareItems(project, a, b, filters.sort))
}

function compareItems(project: ProjectState, a: InventoryItem, b: InventoryItem, sort: SortKey): number {
  if (sort === 'type') {
    return INVENTORY_TYPE_RANK[a.type] - INVENTORY_TYPE_RANK[b.type]
      || a.name.localeCompare(b.name)
  }

  if (sort === 'capacity') {
    return (
      numericSpec(b, ['capacityTb', 'capacityGb', 'vramGb']) -
        numericSpec(a, ['capacityTb', 'capacityGb', 'vramGb']) || a.name.localeCompare(b.name)
    )
  }

  if (sort === 'speed') {
    return (
      numericSpec(b, ['speedMbps', 'speedMt', 'boostClockGhz', 'baseClockGhz']) -
        numericSpec(a, ['speedMbps', 'speedMt', 'boostClockGhz', 'baseClockGhz']) ||
      a.name.localeCompare(b.name)
    )
  }

  if (sort === 'slot-status') {
    const aScore =
      isHostType(a.type)
        ? project.assignments.filter((assignment) => assignment.serverId === runtimeItemKey(a)).length
        : Number(isItemAssigned(project, a))
    const bScore =
      isHostType(b.type)
        ? project.assignments.filter((assignment) => assignment.serverId === runtimeItemKey(b)).length
        : Number(isItemAssigned(project, b))

    return bScore - aScore || a.name.localeCompare(b.name)
  }

  return a.name.localeCompare(b.name)
}
