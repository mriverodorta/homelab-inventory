import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_INVENTORY_WIDTH,
  MAX_INVENTORY_WIDTH,
  MIN_INVENTORY_WIDTH,
  clampInventoryWidth,
  getStoredInventoryVisible,
  getStoredInventoryWidth,
  storeInventoryVisible,
  storeInventoryWidth,
} from '@/lib/ui-preferences'

describe('inventory UI preferences', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exports the desktop inventory width bounds and default', () => {
    expect(MIN_INVENTORY_WIDTH).toBe(390)
    expect(MAX_INVENTORY_WIDTH).toBe(460)
    expect(DEFAULT_INVENTORY_WIDTH).toBe(390)
  })

  it('defaults to a visible sidebar at the default width', () => {
    expect(getStoredInventoryVisible()).toBe(true)
    expect(getStoredInventoryWidth()).toBe(DEFAULT_INVENTORY_WIDTH)
  })

  it('persists visibility and width independently', () => {
    storeInventoryVisible(false)
    storeInventoryWidth(430)

    expect(getStoredInventoryVisible()).toBe(false)
    expect(getStoredInventoryWidth()).toBe(430)
  })

  it('treats malformed visibility values as visible', () => {
    window.localStorage.setItem('homelab-inventory:inventory-visible', 'invalid')

    expect(getStoredInventoryVisible()).toBe(true)
  })

  it('ignores malformed widths and clamps stored widths', () => {
    window.localStorage.setItem('homelab-inventory:inventory-width', 'invalid')
    expect(getStoredInventoryWidth()).toBe(DEFAULT_INVENTORY_WIDTH)

    window.localStorage.setItem(
      'homelab-inventory:inventory-width',
      String(MAX_INVENTORY_WIDTH + 100),
    )
    expect(getStoredInventoryWidth()).toBe(MAX_INVENTORY_WIDTH)

    window.localStorage.setItem(
      'homelab-inventory:inventory-width',
      String(MIN_INVENTORY_WIDTH - 100),
    )
    expect(getStoredInventoryWidth()).toBe(MIN_INVENTORY_WIDTH)
  })

  it('clamps values before writing them', () => {
    storeInventoryWidth(MAX_INVENTORY_WIDTH + 100)
    expect(window.localStorage.getItem('homelab-inventory:inventory-width')).toBe(
      String(MAX_INVENTORY_WIDTH),
    )

    storeInventoryWidth(MIN_INVENTORY_WIDTH - 100)
    expect(window.localStorage.getItem('homelab-inventory:inventory-width')).toBe(
      String(MIN_INVENTORY_WIDTH),
    )

    expect(clampInventoryWidth(Number.NaN)).toBe(DEFAULT_INVENTORY_WIDTH)
  })

  it('falls back safely when localStorage reads are unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError')
    })

    expect(getStoredInventoryVisible()).toBe(true)
    expect(getStoredInventoryWidth()).toBe(DEFAULT_INVENTORY_WIDTH)
  })

  it('does not throw when localStorage writes are unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError')
    })

    expect(() => storeInventoryVisible(false)).not.toThrow()
    expect(() => storeInventoryWidth(430)).not.toThrow()
  })
})
