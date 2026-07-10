import { describe, expect, it } from 'vitest'
import {
  getPatchPanelRowOrderValue,
  getPatchPanelRowSides,
  getSwappedPatchPanelRowOrderValue,
} from '@/lib/patch-panel'
import type { InventoryItem } from '@/types/inventory'

const patchPanel: InventoryItem = {
  id: 1,
  name: 'Patch Panel',
  type: 'patchPanel',
}

describe('patch panel row display', () => {
  it('defaults to back row above front row', () => {
    expect(getPatchPanelRowOrderValue(patchPanel)).toBe('back-front')
    expect(getPatchPanelRowSides(patchPanel)).toEqual(['back', 'front'])
  })

  it('reads and toggles the persisted row order preference', () => {
    const frontFirst: InventoryItem = {
      ...patchPanel,
      properties: { patchPanelRowOrder: 'front-back' },
    }

    expect(getPatchPanelRowSides(frontFirst)).toEqual(['front', 'back'])
    expect(getSwappedPatchPanelRowOrderValue(frontFirst)).toBe('back-front')
    expect(getSwappedPatchPanelRowOrderValue(patchPanel)).toBe('front-back')
  })
})
