import { describe, expect, it } from 'vitest'
import { normalizeHardwareClass, hardwareClassLabel } from '@/lib/equipment-classification'
import { INVENTORY_TYPE_LABELS, normalizeInventory } from '@/lib/inventory'
import { itemPresentationLabel } from '@/components/inspector/shared/item-formatters'
import { physicalClassLabel } from '@/components/workbook/systems-table-columns'
import { resolveComputeHostPresentation } from '@/lib/compute-host-presentation'
import { inventoryItemToFormValues, inventoryFormValuesToInput } from '@/components/inventory-form/model'
import { RAM_FORM_FACTORS, SERVER_FORM_FACTORS, SERVER_HARDWARE_CLASS_OPTIONS, TYPE_LABELS } from '@/components/inventory-form/options'
import type { InventoryItem } from '@/types/inventory'

describe('laptop classification', () => {
  it('labels the existing inventory category as Computer without changing its key', () => {
    expect(INVENTORY_TYPE_LABELS.server).toBe('Computer')
    expect(TYPE_LABELS.server).toBe('Computer')
    expect(itemPresentationLabel({ type: 'server' })).toBe('Computer')
  })

  it.each([
    ['laptop', 'Laptop'], ['desktop', 'Desktop PC'], ['workstation', 'Workstation'], ['server', 'Server'],
  ] as const)('uses physical %s labels independently of the server usage role', (hardwareClass, label) => {
    const item: InventoryItem = { id: 1, name: 'Example', type: 'server', hardwareClass, usageRole: 'server', specs: {} }
    expect(itemPresentationLabel(item)).toBe(label)
    expect(physicalClassLabel(item)).toBe(label)
  })
  it.each(['server', 'desktop', 'workstation', 'other'] as const)('preserves laptop hardware independently of %s usage', (usageRole) => {
    const item: InventoryItem = { id: 1, type: 'server', name: 'Example laptop', hardwareClass: 'laptop', usageRole, specs: { formFactor: 'Laptop' } }
    const [normalized] = normalizeInventory([item])
    expect(normalized.hardwareClass).toBe('laptop')
    const input = inventoryFormValuesToInput(inventoryItemToFormValues(normalized))
    expect(input).toMatchObject({ hardwareClass: 'laptop', usageRole, specs: { formFactor: 'Laptop' } })
    expect(resolveComputeHostPresentation(item)).toEqual({ iconKey: 'laptop', label: 'Laptop' })
  })

  it('keeps physical class, chassis and memory form factors separate', () => {
    expect(normalizeHardwareClass('laptop')).toBe('laptop')
    expect(hardwareClassLabel('laptop')).toBe('Laptop')
    expect(SERVER_HARDWARE_CLASS_OPTIONS).toContainEqual({ value: 'laptop', label: 'Laptop' })
    expect(SERVER_FORM_FACTORS).toEqual(expect.arrayContaining(['Laptop', 'Mini', 'Micro', 'Tiny']))
    expect(RAM_FORM_FACTORS).toEqual(expect.arrayContaining(['DIMM', 'SO-DIMM', 'Onboard']))
    expect(normalizeHardwareClass('mini')).toBe('desktop')
  })
})
