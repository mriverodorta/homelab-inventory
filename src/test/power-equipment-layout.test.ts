import { describe, expect, it } from 'vitest'
import {
  POWER_EQUIPMENT_ORIENTATION_PROPERTY,
  UPS_OUTLET_GROUP_ORDER_PROPERTY,
  getPowerEquipmentOrientation,
  getSwappedUpsOutletGroupOrder,
  getUpsOutletGroupOrder,
  orderUpsOutletGroups,
} from '@/lib/power-equipment-layout'
import type { InventoryItem } from '@/types/inventory'

function ups(properties?: Record<string, string>): InventoryItem {
  return { id: 1, type: 'ups', name: 'UPS', properties }
}

describe('power equipment layout properties', () => {
  it('defaults missing and invalid orientation values to horizontal', () => {
    expect(getPowerEquipmentOrientation(ups())).toBe('horizontal')
    expect(getPowerEquipmentOrientation(ups({
      [POWER_EQUIPMENT_ORIENTATION_PROPERTY]: 'diagonal',
    }))).toBe('horizontal')
  })

  it('reads persisted vertical orientation', () => {
    expect(getPowerEquipmentOrientation(ups({
      [POWER_EQUIPMENT_ORIENTATION_PROPERTY]: 'vertical',
    }))).toBe('vertical')
  })

  it('defaults missing and invalid UPS order to battery then surge', () => {
    expect(getUpsOutletGroupOrder(ups())).toBe('battery-surge')
    expect(getUpsOutletGroupOrder(ups({
      [UPS_OUTLET_GROUP_ORDER_PROPERTY]: 'unknown',
    }))).toBe('battery-surge')
  })

  it('swaps UPS order in either direction', () => {
    expect(getSwappedUpsOutletGroupOrder(ups())).toBe('surge-battery')
    expect(getSwappedUpsOutletGroupOrder(ups({
      [UPS_OUTLET_GROUP_ORDER_PROPERTY]: 'surge-battery',
    }))).toBe('battery-surge')
  })

  it('reorders groups without changing their objects or contained port IDs', () => {
    const battery = { id: 'battery', label: 'Battery', ports: [{ port: { id: 11 } }] }
    const surge = { id: 'surge', label: 'Surge', ports: [{ port: { id: 12 } }] }

    const ordered = orderUpsOutletGroups(
      ups({ [UPS_OUTLET_GROUP_ORDER_PROPERTY]: 'surge-battery' }),
      [battery, surge],
    )

    expect(ordered).toEqual([surge, battery])
    expect(ordered[0]).toBe(surge)
    expect(ordered[1]).toBe(battery)
  })
})
