export const MIN_INVENTORY_WIDTH = 390
export const MAX_INVENTORY_WIDTH = 460
export const DEFAULT_INVENTORY_WIDTH = 390

const INVENTORY_VISIBLE_KEY = 'homelab-inventory:inventory-visible'
const INVENTORY_WIDTH_KEY = 'homelab-inventory:inventory-width'
const AUTO_CENTER_ON_SELECT_KEY = 'homelab-inventory:auto-center-on-select'
const CABLES_VISIBLE_KEY = 'homelab-inventory:cables-visible'

const UI_PREFERENCE_KEYS = [
  INVENTORY_VISIBLE_KEY,
  INVENTORY_WIDTH_KEY,
  AUTO_CENTER_ON_SELECT_KEY,
  CABLES_VISIBLE_KEY,
] as const

export type UiPreferences = {
  inventoryVisible: boolean
  inventoryWidth: number
  autoCenterOnSelect: boolean
  cablesVisible: boolean
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  inventoryVisible: true,
  inventoryWidth: DEFAULT_INVENTORY_WIDTH,
  autoCenterOnSelect: true,
  cablesVisible: true,
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

export function getStoredCablesVisible(): boolean {
  if (typeof window === 'undefined') {
    return DEFAULT_UI_PREFERENCES.cablesVisible
  }

  try {
    return window.localStorage.getItem(CABLES_VISIBLE_KEY) !== 'false'
  } catch {
    return DEFAULT_UI_PREFERENCES.cablesVisible
  }
}

export function storeCablesVisible(visible: boolean): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(CABLES_VISIBLE_KEY, String(visible))
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }
}

export function getStoredUiPreferences(): UiPreferences {
  return {
    inventoryVisible: getStoredInventoryVisible(),
    inventoryWidth: getStoredInventoryWidth(),
    autoCenterOnSelect: getStoredAutoCenterOnSelect(),
    cablesVisible: getStoredCablesVisible(),
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
