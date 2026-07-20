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
  'pcBuild',
  'motherboard',
  'cpuCooler',
  'case',
  'powerSupply',
  'soundCard',
  'wireless',
  'powerAdapter',
  'monitor',
  'ups',
  'powerStrip',
]

describe('inventory form placeholders', () => {
  it.each(inventoryTypes)('provides distinct common examples for %s', (type) => {
    expect(INVENTORY_FORM_PLACEHOLDERS[type]).toEqual(expect.objectContaining({
      name: expect.any(String),
      manufacturer: expect.any(String),
      model: expect.any(String),
    }))
    expect(INVENTORY_FORM_PLACEHOLDERS[type].name).not.toHaveLength(0)
    if (type !== 'pcBuild') {
      expect(INVENTORY_FORM_PLACEHOLDERS[type].model).not.toHaveLength(0)
    }
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

  it('uses the approved examples for PC, component, and power equipment forms', () => {
    expect(INVENTORY_FORM_PLACEHOLDERS).toMatchObject({
      pcBuild: { name: 'Gaming PC', manufacturer: '', model: '' },
      motherboard: {
        name: 'ASUS ROG Strix B650E-I',
        manufacturer: 'ASUS',
        model: 'ROG Strix B650E-I',
      },
      cpuCooler: { name: 'Noctua NH-L12S', manufacturer: 'Noctua', model: 'NH-L12S' },
      powerSupply: { name: 'Corsair SF750', manufacturer: 'Corsair', model: 'SF750' },
      monitor: {
        name: 'Dell UltraSharp U2723QE',
        manufacturer: 'Dell',
        model: 'U2723QE',
      },
      ups: { name: 'APC Back-UPS Pro', manufacturer: 'APC', model: 'BR1500MS2' },
      powerStrip: {
        name: 'Kasa Smart Plug Power Strip',
        manufacturer: 'TP-Link',
        model: 'HS300',
      },
    })
  })
})
