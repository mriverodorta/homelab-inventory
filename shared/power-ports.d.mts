import type { InventoryItem, InventoryPort } from '../src/types/inventory'

export const NAS_POWER_CONFIGURATIONS: readonly ['internal-psu', 'external-adapter']
export function isNasPowerConfiguration(value: unknown): value is 'internal-psu' | 'external-adapter'
export function canonicalPowerPorts(item: InventoryItem): InventoryPort[]
export function withCanonicalPowerPorts<T extends InventoryItem>(item: T): T
export function legacyPowerPortKey(item: InventoryItem, legacyPortId: unknown): string | undefined
