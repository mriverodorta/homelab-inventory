import type { InventoryItem } from '@/types/inventory'

const itemTypeLabels: Partial<Record<InventoryItem['type'], string>> = {
  cpu: 'CPU',
  cpuCooler: 'CPU Cooler',
  case: 'Case',
  gpu: 'GPU',
  motherboard: 'Motherboard',
  monitor: 'Monitor',
  nas: 'NAS',
  network: 'Network Card',
  patchPanel: 'Patch Panel',
  pcBuild: 'PC Build',
  powerAdapter: 'Power Adapter',
  powerStrip: 'Power Strip',
  powerSupply: 'Power Supply',
  ram: 'RAM',
  server: 'Server',
  soundCard: 'Sound Card',
  storage: 'Storage',
  switch: 'Switch',
  ups: 'UPS',
}

export function itemTypeLabel(type: InventoryItem['type']): string {
  return itemTypeLabels[type] ?? type
}

export function formatBytes(value: unknown): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'Unknown'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)}${units[unitIndex]}`
}

export function formatRelativeAge(ageMs: number | null | undefined): string {
  if (typeof ageMs !== 'number') {
    return 'Never'
  }

  if (ageMs < 60_000) {
    return `${Math.max(1, Math.round(ageMs / 1000))}s ago`
  }

  if (ageMs < 3_600_000) {
    return `${Math.round(ageMs / 60_000)}m ago`
  }

  return `${Math.round(ageMs / 3_600_000)}h ago`
}
