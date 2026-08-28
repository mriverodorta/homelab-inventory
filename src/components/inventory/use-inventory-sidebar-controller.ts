import { useEffect, useState } from 'react'
import {
  readInventorySidebarPreferences,
  writeInventorySidebarPreferences,
} from '@/lib/inventory-sidebar-preferences'
import type { InventoryFilters } from '@/lib/sort'
import type { InventoryType } from '@/types/inventory'
import type { InventoryMetadataFilter } from '@/types/inventory-metadata'

export interface InventorySidebarController {
  filters: InventoryFilters
  setFilters: React.Dispatch<React.SetStateAction<InventoryFilters>>
  metadataFilters: InventoryMetadataFilter[]
  setMetadataFilters: React.Dispatch<React.SetStateAction<InventoryMetadataFilter[]>>
  selectionMode: boolean
  setSelectionMode: React.Dispatch<React.SetStateAction<boolean>>
  selectedItemIds: Set<string>
  setSelectedItemIds: React.Dispatch<React.SetStateAction<Set<string>>>
  collapsedTypes: Set<InventoryType>
  setCollapsedTypes: React.Dispatch<React.SetStateAction<Set<InventoryType>>>
}

export function useInventorySidebarController(preferenceScope: string): InventorySidebarController {
  const [initialPreferences] = useState(() => readInventorySidebarPreferences(preferenceScope))
  const [filters, setFilters] = useState<InventoryFilters>(() => ({ ...initialPreferences.filters }))
  const [metadataFilters, setMetadataFilters] = useState<InventoryMetadataFilter[]>(() => (
    [...initialPreferences.metadataFilters]
  ))
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(() => new Set())
  const [collapsedTypes, setCollapsedTypes] = useState<Set<InventoryType>>(() => (
    new Set(initialPreferences.collapsedTypes)
  ))

  useEffect(() => {
    try {
      writeInventorySidebarPreferences(preferenceScope, {
        version: 1,
        filters,
        metadataFilters,
        collapsedTypes: [...collapsedTypes],
      })
    } catch {
      // Browser storage is an optional preference layer; the in-memory view remains usable.
    }
  }, [collapsedTypes, filters, metadataFilters, preferenceScope])

  return {
    filters,
    setFilters,
    metadataFilters,
    setMetadataFilters,
    selectionMode,
    setSelectionMode,
    selectedItemIds,
    setSelectedItemIds,
    collapsedTypes,
    setCollapsedTypes,
  }
}
