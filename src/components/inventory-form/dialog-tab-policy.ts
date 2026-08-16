import type { InventoryType } from '@/types/inventory'
import { inventoryTypeHasPorts, type InventoryFormErrors } from './model'

export const INVENTORY_DIALOG_TAB_IDS = [
  'specs',
  'cpu',
  'memory',
  'storage',
  'expansion',
  'compatibility',
  'resources',
  'ports',
  'power',
  'smart',
] as const

export type InventoryDialogTabId = (typeof INVENTORY_DIALOG_TAB_IDS)[number]

export const INVENTORY_DIALOG_TAB_ORDER: readonly InventoryDialogTabId[] =
  INVENTORY_DIALOG_TAB_IDS

export const INVENTORY_DIALOG_COMPATIBILITY_TYPES = [
  'server',
  'nas',
  'motherboard',
  'cpu',
  'ram',
  'gpu',
  'network',
] as const satisfies readonly InventoryType[]

export const INVENTORY_DIALOG_RESOURCE_TYPES = [
  'server',
  'nas',
  'motherboard',
] as const satisfies readonly InventoryType[]

export type InventoryDialogFormErrors = InventoryFormErrors & {
  quantity?: string
}

type InventoryDialogErrorKey = keyof InventoryDialogFormErrors

export const INVENTORY_DIALOG_ERROR_FIELDS: Readonly<
  Record<InventoryDialogTabId, readonly InventoryDialogErrorKey[]>
> = {
  specs: [
    'name',
    'cores',
    'threads',
    'baseClockGhz',
    'boostClockGhz',
    'driveBays',
    'm2Slots',
    'nasWidthMm',
    'nasHeightMm',
    'nasDepthMm',
    'nasMassGrams',
    'secondarySpeedMt',
    'capacity',
    'vramGb',
    'switchingCapacityGbps',
    'rackUnits',
    'ratedWatts',
    'powerSupplyConnectors',
    'displaySizeInches',
    'refreshRateHz',
    'upsWatts',
    'upsVoltAmps',
    'batteryOutletCount',
    'surgeOutletCount',
    'outletCount',
    'adapterOutputWatts',
    'cpuSocketCount',
    'quantity',
  ],
  cpu: ['hostCpuMaxTdpWatts', 'hostCpuSocketCount', 'hostCpuPopulationModes'],
  memory: [
    'hostMemorySlots',
    'hostMemoryMaxCapacityGb',
    'hostMemoryMaxModuleCapacityGb',
    'hostMemoryOemMaxCapacityMib',
    'hostMemoryOemMaxModuleCapacityMib',
    'hostMemoryVerifiedMaxCapacityMib',
    'hostMemoryVerifiedMaxModuleCapacityMib',
    'hostMemoryMaxSpeedMt',
    'hostMemorySlotsPerCpu',
  ],
  storage: ['storageSlotGroups'],
  expansion: ['expansionSlotGroups', 'hostMaxExpansionPowerWatts'],
  compatibility: [
    'capacityGb',
    'speedMt',
    'hostCpuMaxTdpWatts',
    'hostMemorySlots',
    'hostMemoryMaxCapacityGb',
    'hostMemoryMaxModuleCapacityGb',
    'hostMemoryMaxSpeedMt',
    'cpuTdpWatts',
    'expansionPowerWatts',
  ],
  resources: [
    'storageSlotGroups',
    'expansionSlotGroups',
    'optionalModuleSlotGroups',
    'hostMaxExpansionPowerWatts',
  ],
  ports: ['portGroups'],
  power: ['motherboardPowerConnectors'],
  smart: ['smartDisplayName', 'smartManagementIp', 'smartMacAddress', 'smartOutletNames'],
}

function includesInventoryType(
  types: readonly InventoryType[],
  type: InventoryType,
): boolean {
  return types.includes(type)
}

export function getInventoryDialogTabs(type: InventoryType, networkTechnology?: string): InventoryDialogTabId[] {
  if (type === 'motherboard') {
    return ['specs', 'cpu', 'memory', 'storage', 'expansion', 'ports', 'power', 'compatibility']
  }
  return INVENTORY_DIALOG_TAB_ORDER.filter((tab) => {
    if (['cpu', 'memory', 'storage', 'expansion', 'power'].includes(tab)) return false
    if (tab === 'compatibility') {
      return includesInventoryType(INVENTORY_DIALOG_COMPATIBILITY_TYPES, type)
    }
    if (tab === 'resources') {
      return includesInventoryType(INVENTORY_DIALOG_RESOURCE_TYPES, type)
    }
    if (tab === 'ports') return inventoryTypeHasPorts(type, networkTechnology)
    if (tab === 'smart') return type === 'powerStrip'
    return true
  })
}

export function findFirstInventoryDialogErrorTab(
  type: InventoryType,
  errors: InventoryDialogFormErrors,
  networkTechnology?: string,
): InventoryDialogTabId | null {
  return getInventoryDialogTabs(type, networkTechnology).find((tab) =>
    INVENTORY_DIALOG_ERROR_FIELDS[tab].some((field) => Boolean(errors[field])),
  ) ?? null
}
