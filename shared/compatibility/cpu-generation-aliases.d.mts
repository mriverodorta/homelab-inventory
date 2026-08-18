import type { InventoryItem } from '../../src/types/inventory'

export const CPU_GENERATION_ALIAS_VERSION: 1
export function canonicalCpuGenerationTokens(value: unknown): readonly string[]
export function inferCpuProductGenerationTokens(item: InventoryItem): readonly string[]
