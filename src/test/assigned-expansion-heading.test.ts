import { describe, expect, it } from 'vitest'
import { assignedExpansionInterfaceLabel, isExpansionItem } from '@/components/assigned-expansion-heading-model'
import type { InventoryItem } from '@/types/inventory'

function item(type: InventoryItem['type'], specs: InventoryItem['specs']): InventoryItem {
  return { id: 1, name: 'Test item', type, specs }
}

describe('assigned expansion heading model', () => {
  it('normalizes supported expansion interfaces to compact pills', () => {
    expect(assignedExpansionInterfaceLabel(item('network', { interface: 'PCIe 3.0 x8' }))).toBe('PCIE')
    expect(assignedExpansionInterfaceLabel(item('wireless', { interface: 'M.2 A+E' }))).toBe('M.2')
    expect(assignedExpansionInterfaceLabel(item('soundCard', { interface: 'USB' }))).toBe('USB')
  })

  it('omits an unreliable or missing interface label', () => {
    expect(assignedExpansionInterfaceLabel(item('gpu', {}))).toBeNull()
    expect(assignedExpansionInterfaceLabel(item('network', { interface: 'Unknown' }))).toBeNull()
  })

  it('limits the special heading to expansion components', () => {
    expect(isExpansionItem(item('gpu', { pcie: 'PCIe 4.0 x16' }))).toBe(true)
    expect(isExpansionItem(item('cpu', {}))).toBe(false)
  })
})
