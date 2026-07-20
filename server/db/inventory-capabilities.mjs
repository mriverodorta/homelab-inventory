export const HOST_TYPES = Object.freeze([
  'server',
  'nas',
  'pcBuild',
])

export const CANVAS_EQUIPMENT_TYPES = Object.freeze([
  ...HOST_TYPES,
  'switch',
  'patchPanel',
  'monitor',
  'ups',
  'powerStrip',
])

export const ASSIGNABLE_COMPONENT_TYPES = Object.freeze([
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
])

export const INVENTORY_TYPES = Object.freeze([
  ...CANVAS_EQUIPMENT_TYPES,
  ...ASSIGNABLE_COMPONENT_TYPES,
])

export const HOST_TYPE_SET = new Set(HOST_TYPES)
export const CANVAS_EQUIPMENT_TYPE_SET = new Set(CANVAS_EQUIPMENT_TYPES)
export const ASSIGNABLE_COMPONENT_TYPE_SET = new Set(ASSIGNABLE_COMPONENT_TYPES)
export const INVENTORY_TYPE_SET = new Set(INVENTORY_TYPES)

export const isHostType = (type) => HOST_TYPE_SET.has(type)
export const isCanvasEquipmentType = (type) => CANVAS_EQUIPMENT_TYPE_SET.has(type)
export const isAssignableComponentType = (type) => ASSIGNABLE_COMPONENT_TYPE_SET.has(type)
export const isInventoryType = (type) => INVENTORY_TYPE_SET.has(type)
