import { createContext } from 'react'
import type {
  InventoryMetadataItemRef,
  InventoryMetadataSavedChange,
} from '@/types/inventory-metadata'
import type { InventoryMetadataSettingsTab } from '@/types/settings-navigation'

export type InspectorInventoryMetadataContextValue = Readonly<{
  projectId: number
  item: InventoryMetadataItemRef
  canEdit: boolean
  onSaved?: (change: InventoryMetadataSavedChange) => void | Promise<void>
  onOpenSettings?: (tab: InventoryMetadataSettingsTab) => void
}> | null

export const InspectorInventoryMetadataContext = createContext<InspectorInventoryMetadataContextValue>(null)
