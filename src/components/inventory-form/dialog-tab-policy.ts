import type { InventoryType } from '@/types/inventory'
import { inventoryTypeHasPorts, type InventoryFormErrors } from './model'

export const INVENTORY_DIALOG_TAB_IDS = [
  'specs',
  'compatibility',
  'resources',
  'ports',
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
    'capacityGb',
    'baseClockGhz',
    'boostClockGhz',
    'driveBays',
    'm2Slots',
    'speedMt',
    'secondarySpeedMt',
    'capacity',
    'vramGb',
    'switchingCapacityGbps',
    'rackUnits',
    'ratedWatts',
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
  compatibility: [
    'moduleCount',
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
    'hostMaxExpansionPowerWatts',
  ],
  ports: ['portGroups'],
}

function includesInventoryType(
  types: readonly InventoryType[],
  type: InventoryType,
): boolean {
  return types.includes(type)
}

export function getInventoryDialogTabs(type: InventoryType): InventoryDialogTabId[] {
  return INVENTORY_DIALOG_TAB_ORDER.filter((tab) => {
    if (tab === 'compatibility') {
      return includesInventoryType(INVENTORY_DIALOG_COMPATIBILITY_TYPES, type)
    }
    if (tab === 'resources') {
      return includesInventoryType(INVENTORY_DIALOG_RESOURCE_TYPES, type)
    }
    if (tab === 'ports') return inventoryTypeHasPorts(type)
    return true
  })
}

export function findFirstInventoryDialogErrorTab(
  type: InventoryType,
  errors: InventoryDialogFormErrors,
): InventoryDialogTabId | null {
  return getInventoryDialogTabs(type).find((tab) =>
    INVENTORY_DIALOG_ERROR_FIELDS[tab].some((field) => Boolean(errors[field])),
  ) ?? null
}
