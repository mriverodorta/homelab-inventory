import type {
  CanvasEquipmentType,
  ComponentType,
  HostType,
  InventoryType,
} from '../types/inventory'

export const HOST_TYPES = [
  'server',
  'nas',
  'pcBuild',
] as const satisfies readonly HostType[]

export const CANVAS_EQUIPMENT_TYPES = [
  ...HOST_TYPES,
  'switch',
  'patchPanel',
  'monitor',
  'ups',
  'powerStrip',
] as const satisfies readonly CanvasEquipmentType[]

export const ASSIGNABLE_COMPONENT_TYPES = [
  'cpu',
  'ram',
  'storage',
  'gpu',
  'network',
  'motherboard',
  'cpuCooler',
  'case',
  'powerSupply',
  'soundCard',
  'wireless',
  'powerAdapter',
] as const satisfies readonly ComponentType[]

export const INVENTORY_TYPES = [
  ...CANVAS_EQUIPMENT_TYPES,
  ...ASSIGNABLE_COMPONENT_TYPES,
] as const satisfies readonly InventoryType[]

export const HOST_TYPE_SET: ReadonlySet<string> = new Set(HOST_TYPES)
export const CANVAS_EQUIPMENT_TYPE_SET: ReadonlySet<string> = new Set(CANVAS_EQUIPMENT_TYPES)
export const ASSIGNABLE_COMPONENT_TYPE_SET: ReadonlySet<string> = new Set(
  ASSIGNABLE_COMPONENT_TYPES,
)
export const INVENTORY_TYPE_SET: ReadonlySet<string> = new Set(INVENTORY_TYPES)

export function isHostType(type: unknown): type is HostType {
  return typeof type === 'string' && HOST_TYPE_SET.has(type)
}

export function isCanvasEquipmentType(type: unknown): type is CanvasEquipmentType {
  return typeof type === 'string' && CANVAS_EQUIPMENT_TYPE_SET.has(type)
}

export function isAssignableComponentType(type: unknown): type is ComponentType {
  return typeof type === 'string' && ASSIGNABLE_COMPONENT_TYPE_SET.has(type)
}

export function isInventoryType(type: unknown): type is InventoryType {
  return typeof type === 'string' && INVENTORY_TYPE_SET.has(type)
}
