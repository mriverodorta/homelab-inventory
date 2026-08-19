import { describe, expect, it } from 'vitest'
import {
  findFirstInventoryDialogErrorTab,
  getInventoryDialogTabs,
  INVENTORY_DIALOG_TAB_ORDER,
} from './dialog-tab-policy'

describe('inventory dialog tab policy', () => {
  it('keeps the approved tab order', () => {
    expect(INVENTORY_DIALOG_TAB_ORDER).toEqual([
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
      'metadata',
    ])
  })

  it.each([
    ['server', ['specs', 'compatibility', 'resources', 'ports', 'metadata']],
    ['nas', ['specs', 'compatibility', 'resources', 'ports', 'metadata']],
    ['motherboard', ['specs', 'cpu', 'memory', 'storage', 'expansion', 'ports', 'power', 'compatibility', 'metadata']],
    ['cpu', ['specs', 'compatibility', 'metadata']],
    ['ram', ['specs', 'compatibility', 'metadata']],
    ['gpu', ['specs', 'compatibility', 'ports', 'metadata']],
    ['network', ['specs', 'compatibility', 'ports', 'metadata']],
    ['switch', ['specs', 'ports', 'metadata']],
    ['patchPanel', ['specs', 'ports', 'metadata']],
    ['storage', ['specs', 'metadata']],
    ['powerStrip', ['specs', 'smart', 'metadata']],
  ] as const)('returns the available tabs for %s', (type, tabs) => {
    expect(getInventoryDialogTabs(type)).toEqual(tabs)
  })

  it('does not expose physical port editing for radio-only adapters', () => {
    expect(getInventoryDialogTabs('network', 'wifi')).toEqual(['specs', 'compatibility', 'metadata'])
    expect(getInventoryDialogTabs('network', 'cellular')).toEqual(['specs', 'compatibility', 'metadata'])
  })

  it('routes to the first available tab containing an error', () => {
    expect(findFirstInventoryDialogErrorTab('server', {
      quantity: 'Quantity is required.',
      hostCpuMaxTdpWatts: 'Maximum TDP is invalid.',
      storageSlotGroups: 'A storage group is invalid.',
      portGroups: 'A port group is invalid.',
    })).toBe('specs')

    expect(findFirstInventoryDialogErrorTab('server', {
      hostCpuMaxTdpWatts: 'Maximum TDP is invalid.',
      storageSlotGroups: 'A storage group is invalid.',
      portGroups: 'A port group is invalid.',
    })).toBe('compatibility')

    expect(findFirstInventoryDialogErrorTab('server', {
      expansionSlotGroups: 'An expansion group is invalid.',
      portGroups: 'A port group is invalid.',
    })).toBe('resources')

    expect(findFirstInventoryDialogErrorTab('server', {
      portGroups: 'A port group is invalid.',
    })).toBe('ports')

    expect(findFirstInventoryDialogErrorTab('motherboard', {
      hostMemorySlots: 'Memory slot count is invalid.',
      expansionSlotGroups: 'An expansion group is invalid.',
    })).toBe('memory')

    expect(findFirstInventoryDialogErrorTab('motherboard', {
      motherboardPowerConnectors: 'A power connector is invalid.',
    })).toBe('power')
  })

  it('ignores errors owned by tabs that are unavailable for the type', () => {
    expect(findFirstInventoryDialogErrorTab('storage', {
      cpuTdpWatts: 'TDP is invalid.',
      portGroups: 'A port group is invalid.',
    })).toBeNull()
  })

  it('returns null when the form has no validation errors', () => {
    expect(findFirstInventoryDialogErrorTab('server', {})).toBeNull()
  })
})
