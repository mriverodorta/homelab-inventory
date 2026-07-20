import { describe, expect, it } from 'vitest'
import {
  ASSIGNABLE_COMPONENT_TYPES,
  CANVAS_EQUIPMENT_TYPES,
  HOST_TYPES,
  INVENTORY_TYPES,
  isAssignableComponentType,
  isCanvasEquipmentType,
  isHostType,
  isInventoryType,
} from '../lib/inventory-capabilities'

describe('inventory capabilities', () => {
  it('classifies PC build inventory without treating standalone equipment as hosts', () => {
    expect(isHostType('pcBuild')).toBe(true)
    expect(isHostType('monitor')).toBe(false)
    expect(isCanvasEquipmentType('pcBuild')).toBe(true)
    expect(isCanvasEquipmentType('ups')).toBe(true)
    expect(isCanvasEquipmentType('powerStrip')).toBe(true)
    expect(isAssignableComponentType('motherboard')).toBe(true)
    expect(isAssignableComponentType('powerAdapter')).toBe(true)
    expect(isAssignableComponentType('monitor')).toBe(false)
  })

  it('publishes complete, non-overlapping capability collections', () => {
    expect(HOST_TYPES).toHaveLength(3)
    expect(CANVAS_EQUIPMENT_TYPES).toHaveLength(8)
    expect(ASSIGNABLE_COMPONENT_TYPES).toHaveLength(12)
    expect(INVENTORY_TYPES).toHaveLength(20)
    expect(new Set(INVENTORY_TYPES).size).toBe(INVENTORY_TYPES.length)
    expect(INVENTORY_TYPES.every(isInventoryType)).toBe(true)
  })

  it('rejects unknown values and non-string inputs', () => {
    expect(isInventoryType('operatingSystem')).toBe(false)
    expect(isInventoryType('router')).toBe(false)
    expect(isInventoryType(null)).toBe(false)
  })
})
