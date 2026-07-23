import { describe, expect, it } from 'vitest'
import {
  isCableTypeVisible,
  type CableVisibility,
} from '@/lib/cable-visibility'
import type { InventoryConnectionType } from '@/types/inventory'

const allVisible: CableVisibility = {
  network: true,
  power: true,
  display: true,
}

describe('cable visibility', () => {
  it.each<InventoryConnectionType>(['network', 'power', 'display'])(
    'shows %s connections when their channel is enabled',
    (type) => {
      expect(isCableTypeVisible(type, allVisible)).toBe(true)
    },
  )

  it.each<InventoryConnectionType>(['network', 'power', 'display'])(
    'hides only disabled %s connections',
    (type) => {
      expect(isCableTypeVisible(type, { ...allVisible, [type]: false })).toBe(false)
    },
  )

  it('keeps legacy other connections visible', () => {
    expect(isCableTypeVisible('other', {
      network: false,
      power: false,
      display: false,
    })).toBe(true)
  })
})
