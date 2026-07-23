import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_INVENTORY_WIDTH,
  DEFAULT_UI_PREFERENCES,
  MAX_INVENTORY_WIDTH,
  MIN_INVENTORY_WIDTH,
  clampInventoryWidth,
  getStoredAutoCenterOnSelect,
  getStoredAvoidCableCollisionsGlobally,
  getStoredDisplayCablesVisible,
  getStoredInventoryVisible,
  getStoredInventoryWidth,
  getStoredNetworkCablesVisible,
  getStoredOpenCreatedConnectionInspector,
  getStoredPowerCablesVisible,
  getStoredSnapCablesToGrid,
  getStoredSnapItemsToGrid,
  getStoredUiPreferences,
  resetStoredUiPreferences,
  storeAutoCenterOnSelect,
  storeAvoidCableCollisionsGlobally,
  storeDisplayCablesVisible,
  storeInventoryVisible,
  storeInventoryWidth,
  storeNetworkCablesVisible,
  storeOpenCreatedConnectionInspector,
  storePowerCablesVisible,
  storeSnapCablesToGrid,
  storeSnapItemsToGrid,
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
    expect(getStoredAutoCenterOnSelect()).toBe(true)
    expect(getStoredNetworkCablesVisible()).toBe(true)
    expect(getStoredPowerCablesVisible()).toBe(true)
    expect(getStoredDisplayCablesVisible()).toBe(true)
    expect(getStoredOpenCreatedConnectionInspector()).toBe(false)
    expect(getStoredSnapCablesToGrid()).toBe(false)
    expect(getStoredAvoidCableCollisionsGlobally()).toBe(false)
    expect(getStoredSnapItemsToGrid()).toBe(false)
    expect(getStoredUiPreferences()).toEqual(DEFAULT_UI_PREFERENCES)
  })

  it('persists visibility and width independently', () => {
    storeInventoryVisible(false)
    storeInventoryWidth(430)

    expect(getStoredInventoryVisible()).toBe(false)
    expect(getStoredInventoryWidth()).toBe(430)
  })

  it('persists auto-centering and cable-type visibility independently', () => {
    storeAutoCenterOnSelect(false)
    storeNetworkCablesVisible(false)
    storePowerCablesVisible(true)
    storeDisplayCablesVisible(false)

    expect(getStoredAutoCenterOnSelect()).toBe(false)
    expect(getStoredNetworkCablesVisible()).toBe(false)
    expect(getStoredPowerCablesVisible()).toBe(true)
    expect(getStoredDisplayCablesVisible()).toBe(false)
    expect(getStoredUiPreferences()).toMatchObject({
      autoCenterOnSelect: false,
      networkCablesVisible: false,
      powerCablesVisible: true,
      displayCablesVisible: false,
    })
  })

  it.each([true, false])('migrates legacy cable visibility %s to every cable type', (visible) => {
    window.localStorage.setItem('homelab-inventory:cables-visible', String(visible))

    expect(getStoredNetworkCablesVisible()).toBe(visible)
    expect(getStoredPowerCablesVisible()).toBe(visible)
    expect(getStoredDisplayCablesVisible()).toBe(visible)
  })

  it('prefers type-specific cable visibility over the legacy value', () => {
    window.localStorage.setItem('homelab-inventory:cables-visible', 'false')
    storeNetworkCablesVisible(true)

    expect(getStoredNetworkCablesVisible()).toBe(true)
    expect(getStoredPowerCablesVisible()).toBe(false)
    expect(getStoredDisplayCablesVisible()).toBe(false)
  })

  it('enables the new-connection Inspector only for an exact stored true value', () => {
    storeOpenCreatedConnectionInspector(true)
    expect(getStoredOpenCreatedConnectionInspector()).toBe(true)
    expect(getStoredUiPreferences()).toMatchObject({
      openCreatedConnectionInspector: true,
    })

    window.localStorage.setItem(
      'homelab-inventory:open-created-connection-inspector',
      'invalid',
    )
    expect(getStoredOpenCreatedConnectionInspector()).toBe(false)
  })

  it('persists cable and item grid snapping as opt-in preferences', () => {
    storeSnapCablesToGrid(true)
    storeSnapItemsToGrid(true)

    expect(getStoredSnapCablesToGrid()).toBe(true)
    expect(getStoredSnapItemsToGrid()).toBe(true)
    expect(getStoredUiPreferences()).toMatchObject({
      snapCablesToGrid: true,
      snapItemsToGrid: true,
    })
  })

  it('persists global cable collision avoidance as an opt-in preference', () => {
    storeAvoidCableCollisionsGlobally(true)

    expect(getStoredAvoidCableCollisionsGlobally()).toBe(true)
    expect(getStoredUiPreferences()).toMatchObject({
      avoidCableCollisionsGlobally: true,
    })
  })

  it('treats malformed visibility values as visible', () => {
    window.localStorage.setItem('homelab-inventory:inventory-visible', 'invalid')
    window.localStorage.setItem(
      'homelab-inventory:auto-center-on-select',
      'invalid',
    )
    window.localStorage.setItem('homelab-inventory:cables-visible', 'invalid')

    expect(getStoredInventoryVisible()).toBe(true)
    expect(getStoredAutoCenterOnSelect()).toBe(true)
    expect(getStoredNetworkCablesVisible()).toBe(true)
    expect(getStoredPowerCablesVisible()).toBe(true)
    expect(getStoredDisplayCablesVisible()).toBe(true)
  })

  it('resets only the Homelab Inventory UI preference keys', () => {
    storeInventoryVisible(false)
    storeInventoryWidth(430)
    storeAutoCenterOnSelect(false)
    storeNetworkCablesVisible(false)
    storePowerCablesVisible(false)
    storeDisplayCablesVisible(false)
    storeOpenCreatedConnectionInspector(true)
    storeSnapCablesToGrid(true)
    storeAvoidCableCollisionsGlobally(true)
    storeSnapItemsToGrid(true)
    window.localStorage.setItem('unrelated-preference', 'preserved')

    resetStoredUiPreferences()

    expect(getStoredUiPreferences()).toEqual(DEFAULT_UI_PREFERENCES)
    expect(window.localStorage.getItem('unrelated-preference')).toBe('preserved')
    expect(window.localStorage.getItem('homelab-inventory:inventory-visible')).toBeNull()
    expect(window.localStorage.getItem('homelab-inventory:inventory-width')).toBeNull()
    expect(
      window.localStorage.getItem('homelab-inventory:auto-center-on-select'),
    ).toBeNull()
    expect(window.localStorage.getItem('homelab-inventory:cables-visible')).toBeNull()
    expect(window.localStorage.getItem('homelab-inventory:network-cables-visible')).toBeNull()
    expect(window.localStorage.getItem('homelab-inventory:power-cables-visible')).toBeNull()
    expect(window.localStorage.getItem('homelab-inventory:display-cables-visible')).toBeNull()
    expect(
      window.localStorage.getItem('homelab-inventory:open-created-connection-inspector'),
    ).toBeNull()
    expect(window.localStorage.getItem('homelab-inventory:snap-cables-to-grid')).toBeNull()
    expect(window.localStorage.getItem('homelab-inventory:avoid-cable-collisions-globally')).toBeNull()
    expect(window.localStorage.getItem('homelab-inventory:snap-items-to-grid')).toBeNull()
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
    expect(getStoredAutoCenterOnSelect()).toBe(true)
    expect(getStoredNetworkCablesVisible()).toBe(true)
    expect(getStoredPowerCablesVisible()).toBe(true)
    expect(getStoredDisplayCablesVisible()).toBe(true)
    expect(getStoredSnapCablesToGrid()).toBe(false)
    expect(getStoredAvoidCableCollisionsGlobally()).toBe(false)
    expect(getStoredSnapItemsToGrid()).toBe(false)
    expect(getStoredUiPreferences()).toEqual(DEFAULT_UI_PREFERENCES)
  })

  it('does not throw when localStorage writes are unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError')
    })

    expect(() => storeInventoryVisible(false)).not.toThrow()
    expect(() => storeInventoryWidth(430)).not.toThrow()
    expect(() => storeAutoCenterOnSelect(false)).not.toThrow()
    expect(() => storeNetworkCablesVisible(false)).not.toThrow()
    expect(() => storePowerCablesVisible(false)).not.toThrow()
    expect(() => storeDisplayCablesVisible(false)).not.toThrow()
    expect(() => storeSnapCablesToGrid(true)).not.toThrow()
    expect(() => storeAvoidCableCollisionsGlobally(true)).not.toThrow()
    expect(() => storeSnapItemsToGrid(true)).not.toThrow()
  })

  it('does not throw when localStorage resets are unavailable', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError')
    })

    expect(() => resetStoredUiPreferences()).not.toThrow()
  })
})
