export const MIN_INVENTORY_WIDTH = 390
export const MAX_INVENTORY_WIDTH = 460
export const DEFAULT_INVENTORY_WIDTH = 390

const INVENTORY_VISIBLE_KEY = 'homelab-inventory:inventory-visible'
const INVENTORY_WIDTH_KEY = 'homelab-inventory:inventory-width'
const AUTO_CENTER_ON_SELECT_KEY = 'homelab-inventory:auto-center-on-select'
const CABLES_VISIBLE_KEY = 'homelab-inventory:cables-visible'
const NETWORK_CABLES_VISIBLE_KEY = 'homelab-inventory:network-cables-visible'
const POWER_CABLES_VISIBLE_KEY = 'homelab-inventory:power-cables-visible'
const DISPLAY_CABLES_VISIBLE_KEY = 'homelab-inventory:display-cables-visible'
const OPEN_CREATED_CONNECTION_INSPECTOR_KEY = 'homelab-inventory:open-created-connection-inspector'
const SNAP_CABLES_TO_GRID_KEY = 'homelab-inventory:snap-cables-to-grid'
const AVOID_CABLE_COLLISIONS_GLOBALLY_KEY = 'homelab-inventory:avoid-cable-collisions-globally'
const SNAP_ITEMS_TO_GRID_KEY = 'homelab-inventory:snap-items-to-grid'

const UI_PREFERENCE_KEYS = [
  INVENTORY_VISIBLE_KEY,
  INVENTORY_WIDTH_KEY,
  AUTO_CENTER_ON_SELECT_KEY,
  CABLES_VISIBLE_KEY,
  NETWORK_CABLES_VISIBLE_KEY,
  POWER_CABLES_VISIBLE_KEY,
  DISPLAY_CABLES_VISIBLE_KEY,
  OPEN_CREATED_CONNECTION_INSPECTOR_KEY,
  SNAP_CABLES_TO_GRID_KEY,
  AVOID_CABLE_COLLISIONS_GLOBALLY_KEY,
  SNAP_ITEMS_TO_GRID_KEY,
] as const

export type UiPreferences = {
  inventoryVisible: boolean
  inventoryWidth: number
  autoCenterOnSelect: boolean
  networkCablesVisible: boolean
  powerCablesVisible: boolean
  displayCablesVisible: boolean
  openCreatedConnectionInspector: boolean
  snapCablesToGrid: boolean
  avoidCableCollisionsGlobally: boolean
  snapItemsToGrid: boolean
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  inventoryVisible: true,
  inventoryWidth: DEFAULT_INVENTORY_WIDTH,
  autoCenterOnSelect: true,
  networkCablesVisible: true,
  powerCablesVisible: true,
  displayCablesVisible: true,
  openCreatedConnectionInspector: false,
  snapCablesToGrid: false,
  avoidCableCollisionsGlobally: false,
  snapItemsToGrid: false,
}

export function clampInventoryWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_INVENTORY_WIDTH

  return Math.min(MAX_INVENTORY_WIDTH, Math.max(MIN_INVENTORY_WIDTH, width))
}

export function getStoredInventoryVisible(): boolean {
  if (typeof window === 'undefined') return true

  try {
    return window.localStorage.getItem(INVENTORY_VISIBLE_KEY) !== 'false'
  } catch {
    return true
  }
}

export function storeInventoryVisible(visible: boolean): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(INVENTORY_VISIBLE_KEY, String(visible))
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }
}

export function getStoredInventoryWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_INVENTORY_WIDTH

  try {
    const storedWidth = window.localStorage.getItem(INVENTORY_WIDTH_KEY)
    if (storedWidth === null || storedWidth.trim() === '') {
      return DEFAULT_INVENTORY_WIDTH
    }

    const parsedWidth = Number(storedWidth)
    return Number.isFinite(parsedWidth)
      ? clampInventoryWidth(parsedWidth)
      : DEFAULT_INVENTORY_WIDTH
  } catch {
    return DEFAULT_INVENTORY_WIDTH
  }
}

export function storeInventoryWidth(width: number): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(
      INVENTORY_WIDTH_KEY,
      String(clampInventoryWidth(width)),
    )
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }
}

export function getStoredAutoCenterOnSelect(): boolean {
  if (typeof window === 'undefined') {
    return DEFAULT_UI_PREFERENCES.autoCenterOnSelect
  }

  try {
    return window.localStorage.getItem(AUTO_CENTER_ON_SELECT_KEY) !== 'false'
  } catch {
    return DEFAULT_UI_PREFERENCES.autoCenterOnSelect
  }
}

export function storeAutoCenterOnSelect(enabled: boolean): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(AUTO_CENTER_ON_SELECT_KEY, String(enabled))
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }
}

function getStoredCableTypeVisible(key: string): boolean {
  if (typeof window === 'undefined') {
    return true
  }

  try {
    const storedValue = window.localStorage.getItem(key)
    if (storedValue !== null) return storedValue !== 'false'

    return window.localStorage.getItem(CABLES_VISIBLE_KEY) !== 'false'
  } catch {
    return true
  }
}

export function getStoredNetworkCablesVisible(): boolean {
  return getStoredCableTypeVisible(NETWORK_CABLES_VISIBLE_KEY)
}

export function storeNetworkCablesVisible(visible: boolean): void {
  storeBooleanPreference(NETWORK_CABLES_VISIBLE_KEY, visible)
}

export function getStoredPowerCablesVisible(): boolean {
  return getStoredCableTypeVisible(POWER_CABLES_VISIBLE_KEY)
}

export function storePowerCablesVisible(visible: boolean): void {
  storeBooleanPreference(POWER_CABLES_VISIBLE_KEY, visible)
}

export function getStoredDisplayCablesVisible(): boolean {
  return getStoredCableTypeVisible(DISPLAY_CABLES_VISIBLE_KEY)
}

export function storeDisplayCablesVisible(visible: boolean): void {
  storeBooleanPreference(DISPLAY_CABLES_VISIBLE_KEY, visible)
}

export function getStoredOpenCreatedConnectionInspector(): boolean {
  if (typeof window === 'undefined') {
    return DEFAULT_UI_PREFERENCES.openCreatedConnectionInspector
  }

  try {
    return window.localStorage.getItem(OPEN_CREATED_CONNECTION_INSPECTOR_KEY) === 'true'
  } catch {
    return DEFAULT_UI_PREFERENCES.openCreatedConnectionInspector
  }
}

export function storeOpenCreatedConnectionInspector(enabled: boolean): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(OPEN_CREATED_CONNECTION_INSPECTOR_KEY, String(enabled))
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }
}

function getStoredOptInBoolean(key: string): boolean {
  if (typeof window === 'undefined') return false

  try {
    return window.localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}

function storeBooleanPreference(key: string, enabled: boolean): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(key, String(enabled))
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }
}

export function getStoredSnapCablesToGrid(): boolean {
  return getStoredOptInBoolean(SNAP_CABLES_TO_GRID_KEY)
}

export function storeSnapCablesToGrid(enabled: boolean): void {
  storeBooleanPreference(SNAP_CABLES_TO_GRID_KEY, enabled)
}

export function getStoredAvoidCableCollisionsGlobally(): boolean {
  return getStoredOptInBoolean(AVOID_CABLE_COLLISIONS_GLOBALLY_KEY)
}

export function storeAvoidCableCollisionsGlobally(enabled: boolean): void {
  storeBooleanPreference(AVOID_CABLE_COLLISIONS_GLOBALLY_KEY, enabled)
}

export function getStoredSnapItemsToGrid(): boolean {
  return getStoredOptInBoolean(SNAP_ITEMS_TO_GRID_KEY)
}

export function storeSnapItemsToGrid(enabled: boolean): void {
  storeBooleanPreference(SNAP_ITEMS_TO_GRID_KEY, enabled)
}

export function getStoredUiPreferences(): UiPreferences {
  return {
    inventoryVisible: getStoredInventoryVisible(),
    inventoryWidth: getStoredInventoryWidth(),
    autoCenterOnSelect: getStoredAutoCenterOnSelect(),
    networkCablesVisible: getStoredNetworkCablesVisible(),
    powerCablesVisible: getStoredPowerCablesVisible(),
    displayCablesVisible: getStoredDisplayCablesVisible(),
    openCreatedConnectionInspector: getStoredOpenCreatedConnectionInspector(),
    snapCablesToGrid: getStoredSnapCablesToGrid(),
    avoidCableCollisionsGlobally: getStoredAvoidCableCollisionsGlobally(),
    snapItemsToGrid: getStoredSnapItemsToGrid(),
  }
}

export function resetStoredUiPreferences(): void {
  if (typeof window === 'undefined') return

  for (const key of UI_PREFERENCE_KEYS) {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // Storage may be unavailable in privacy-restricted browser contexts.
    }
  }
}
