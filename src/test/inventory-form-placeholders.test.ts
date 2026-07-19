import { describe, expect, it } from 'vitest'
import { INVENTORY_FORM_PLACEHOLDERS } from '@/components/inventory-form/placeholders'
import type { InventoryType } from '@/types/inventory'

const inventoryTypes: InventoryType[] = [
  'server',
  'nas',
  'cpu',
  'ram',
  'storage',
  'gpu',
  'network',
  'switch',
  'patchPanel',
]

describe('inventory form placeholders', () => {
  it.each(inventoryTypes)('provides distinct common examples for %s', (type) => {
    expect(INVENTORY_FORM_PLACEHOLDERS[type]).toEqual(expect.objectContaining({
      name: expect.any(String),
      manufacturer: expect.any(String),
      model: expect.any(String),
    }))
    expect(INVENTORY_FORM_PLACEHOLDERS[type].name).not.toHaveLength(0)
    expect(INVENTORY_FORM_PLACEHOLDERS[type].model).not.toHaveLength(0)
  })

  it('uses processor examples for CPU fields instead of server examples', () => {
    expect(INVENTORY_FORM_PLACEHOLDERS.cpu).toMatchObject({
      name: 'Intel Core i5-10500T',
      model: 'Core i5-10500T',
      family: 'Core i5',
      number: 'i5-10500T',
      cores: '6',
      threads: '12',
    })
    expect(Object.values(INVENTORY_FORM_PLACEHOLDERS.cpu)).not.toContain('Dell OptiPlex Micro 7090')
    expect(Object.values(INVENTORY_FORM_PLACEHOLDERS.cpu)).not.toContain('OptiPlex Micro 7090')
  })
})
