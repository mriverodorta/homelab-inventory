export const MIN_INVENTORY_WIDTH = 390
export const MAX_INVENTORY_WIDTH = 460
export const DEFAULT_INVENTORY_WIDTH = 390

const INVENTORY_VISIBLE_KEY = 'homelab-inventory:inventory-visible'
const INVENTORY_WIDTH_KEY = 'homelab-inventory:inventory-width'

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
