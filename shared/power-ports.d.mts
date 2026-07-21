import type { InventoryItem, InventoryPort } from '../src/types/inventory'

export function canonicalPowerPorts(item: InventoryItem): InventoryPort[]
export function withCanonicalPowerPorts<T extends InventoryItem>(item: T): T
export function legacyPowerPortKey(item: InventoryItem, legacyPortId: unknown): string | undefined
