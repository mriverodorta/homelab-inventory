import type { InventoryItem } from '@/types/inventory'

const EXPANSION_TYPES = new Set(['gpu', 'network', 'soundCard'])

export function isExpansionItem(item: InventoryItem): boolean {
  return EXPANSION_TYPES.has(item.type)
}

export function assignedExpansionInterfaceLabel(item: InventoryItem): string | null {
  const candidates = [
    item.specs?.interface,
    item.specs?.pcie,
    item.compatibility?.requirements?.expansion?.interfaceFamily,
  ]

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const normalized = candidate.trim().toLowerCase()
    if (!normalized) continue
    if (normalized.includes('pcie') || normalized.includes('pci-e') || normalized.includes('pci express')) return 'PCIE'
    if (normalized.includes('m.2') || normalized.includes('m2')) return 'M.2'
    if (normalized.includes('usb')) return 'USB'
  }

  return null
}
