import type { EquipmentUsageRole, HardwareClass, InventoryItem } from '@/types/inventory'

export const HARDWARE_CLASSES: readonly HardwareClass[] = ['desktop', 'server']
export const EQUIPMENT_USAGE_ROLES: readonly EquipmentUsageRole[] = ['server', 'desktop', 'workstation', 'other']

export function normalizeHardwareClass(value: unknown): HardwareClass {
  return value === 'server' ? 'server' : 'desktop'
}

export function normalizeEquipmentUsageRole(value: unknown): EquipmentUsageRole {
  if (value === 'desktop' || value === 'workstation') return value
  return 'server'
}

export function equipmentUsageRoleLabel(value: unknown): string {
  const role = normalizeEquipmentUsageRole(value)
  return role === 'workstation' ? 'Workstation' : role === 'desktop' ? 'Desktop' : 'Server'
}

export function catalogTypeForLocalItem(item: Pick<InventoryItem, 'type' | 'hardwareClass'>): string {
  return item.type === 'server' ? normalizeHardwareClass(item.hardwareClass) : item.type
}
