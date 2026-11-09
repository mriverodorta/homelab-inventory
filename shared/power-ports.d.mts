import type { InventoryItem, InventoryPort } from '../src/types/inventory'

export function isLaptop(item: InventoryItem | undefined): boolean
export function laptopPowerTopology(item: InventoryItem): {
  configuration?: 'internal-psu' | 'external-adapter'
  adapterDisposition?: 'fixed' | 'replaceable'
}
export function laptopOwnsPowerEndpoint(item: InventoryItem): boolean

export const NAS_POWER_CONFIGURATIONS: readonly ['internal-psu', 'external-adapter']
export function isNasPowerConfiguration(value: unknown): value is 'internal-psu' | 'external-adapter'
export function nasPowerTopology(item: InventoryItem): {
  configuration: 'internal-psu' | 'external-adapter'
  adapterDisposition?: 'fixed' | 'replaceable'
}
export function nasOwnsPowerEndpoint(item: InventoryItem): boolean
export function withNasPowerConfiguration<T extends InventoryItem>(
  item: T,
  configuration: 'internal-psu' | 'external-adapter',
): T
export function canonicalPowerPorts(item: InventoryItem): InventoryPort[]
export function withCanonicalPowerPorts<T extends InventoryItem>(item: T): T
export function legacyPowerPortKey(item: InventoryItem, legacyPortId: unknown): string | undefined
