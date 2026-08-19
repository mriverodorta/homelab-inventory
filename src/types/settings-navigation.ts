export type InventoryMetadataSettingsTab = 'fields' | 'tags'

export type SettingsCategory =
  | 'general'
  | 'project'
  | 'authentication'
  | 'access'
  | 'inventory-metadata'
  | 'registry'
  | 'notifications'
  | 'backup-restore'
  | 'updates'
  | 'feedback'
  | 'about'

export type SettingsDestination = Readonly<{
  requestId: number
  category: 'inventory-metadata'
  inventoryMetadataTab: InventoryMetadataSettingsTab
}>
