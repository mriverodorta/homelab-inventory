import { createContext } from 'react'
import type { InventoryMetadataItemRef } from '@/types/inventory-metadata'

export type InspectorInventoryMetadataContextValue = Readonly<{
  projectId: number
  item: InventoryMetadataItemRef
  canEdit: boolean
}> | null

export const InspectorInventoryMetadataContext = createContext<InspectorInventoryMetadataContextValue>(null)
