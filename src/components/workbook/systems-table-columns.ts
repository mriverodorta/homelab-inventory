import type { InventoryItem } from '@/types/inventory'

export function physicalClassLabel(item: InventoryItem) {
  if (item.type === 'nas') return 'NAS'
  if (item.type === 'pcBuild') return 'Custom PC'
  if (item.hardwareClass === 'workstation') return 'Workstation'
  if (item.hardwareClass === 'desktop') return 'Desktop'
  return 'Server'
}

export function usageRoleLabel(item: InventoryItem) {
  const role = item.usageRole ?? (item.type === 'server' ? 'server' : item.type === 'pcBuild' ? 'desktop' : 'other')
  return role.charAt(0).toUpperCase() + role.slice(1)
}

export function manufacturerModelLabel(item: InventoryItem) {
  return [item.manufacturer, item.model].filter(Boolean).join(' ') || 'Not specified'
}
