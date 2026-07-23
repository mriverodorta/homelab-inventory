import type { InventoryItem } from '../../src/types/inventory'

type PersistedNas = Omit<InventoryItem, 'key' | 'type'>

export function migrateSchema11To12<
  Inventory extends Record<string, unknown> & { nas?: PersistedNas[] },
  Project extends Record<string, unknown>,
>(inventory: Inventory, project: Project): {
  inventory: Inventory
  project: Project
}
