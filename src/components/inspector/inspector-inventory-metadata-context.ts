import { createContext } from 'react'
import type {
  InventoryMetadataItemRef,
  InventoryMetadataSavedChange,
} from '@/types/inventory-metadata'

export type InspectorInventoryMetadataContextValue = Readonly<{
  projectId: number
  item: InventoryMetadataItemRef
  canEdit: boolean
  onSaved?: (change: InventoryMetadataSavedChange) => void | Promise<void>
}> | null

export const InspectorInventoryMetadataContext = createContext<InspectorInventoryMetadataContextValue>(null)
