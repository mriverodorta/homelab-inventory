import type { EquipmentUsageRole, HardwareClass, InventoryItem } from '@/types/inventory'

export const HARDWARE_CLASSES: readonly HardwareClass[] = ['desktop', 'workstation', 'server']
export const EQUIPMENT_USAGE_ROLES: readonly EquipmentUsageRole[] = ['server', 'desktop', 'workstation', 'other']

export function normalizeHardwareClass(value: unknown): HardwareClass {
  return HARDWARE_CLASSES.includes(value as HardwareClass) ? value as HardwareClass : 'desktop'
}

export function normalizeEquipmentUsageRole(value: unknown): EquipmentUsageRole {
  if (value === 'desktop' || value === 'workstation' || value === 'other') return value
  return 'server'
}

export function equipmentUsageRoleLabel(value: unknown): string {
  const role = normalizeEquipmentUsageRole(value)
  if (role === 'workstation') return 'Workstation'
  if (role === 'desktop') return 'Desktop'
  if (role === 'other') return 'Other'
  return 'Server'
}

export function hardwareClassLabel(value: unknown): string {
  const hardwareClass = normalizeHardwareClass(value)
  if (hardwareClass === 'workstation') return 'Workstation'
  if (hardwareClass === 'server') return 'Server'
  return 'Desktop'
}

export function catalogTypeForLocalItem(item: Pick<InventoryItem, 'type' | 'hardwareClass'>): string {
  return item.type === 'server' ? normalizeHardwareClass(item.hardwareClass) : item.type
}
