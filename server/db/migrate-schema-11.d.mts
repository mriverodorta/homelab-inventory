import type { InventoryItem } from '../../src/types/inventory'

type PowerInventoryTable =
  | 'monitors'
  | 'upsSystems'
  | 'powerStrips'
  | 'powerAdapters'
  | 'powerSupplies'

export type PersistedInventoryRecord = Omit<InventoryItem, 'key' | 'ports' | 'type'> & {
  type?: InventoryItem['type']
  ports?: InventoryItem['ports']
}

export type Schema10InventoryStore = Record<string, unknown> &
  Partial<Record<PowerInventoryTable, PersistedInventoryRecord[]>>

type WithMigratedPorts<Value> = Value extends readonly (infer Record)[]
  ? Array<Record & { ports?: InventoryItem['ports'] }>
  : Value

export type Schema11InventoryStore<Store extends Schema10InventoryStore> = {
  [Table in keyof Store]: Table extends PowerInventoryTable
    ? WithMigratedPorts<Store[Table]>
    : Store[Table]
}

export function migrateSchema10To11<Store extends Schema10InventoryStore>(
  inventory: Store,
): Schema11InventoryStore<Store>
