import { describe, expect, it } from 'vitest'
import { createInventoryVirtualRows } from '@/lib/inventory-virtual-rows'
import type { InventoryItem } from '@/types/inventory'

const items: InventoryItem[] = [
  { id: 2, type: 'ram', name: '16GB DDR4' },
  { id: 1, type: 'cpu', name: 'Intel Core i7' },
  { id: 3, type: 'ram', name: '32GB DDR4' },
]

describe('createInventoryVirtualRows', () => {
  it('flattens category and item rows in canonical inventory order', () => {
    expect(createInventoryVirtualRows(items, new Set()).map((row) => row.key)).toEqual([
      'category:cpu',
      'item:cpu:1',
      'category:ram',
      'item:ram:2',
      'item:ram:3',
    ])
  })

  it('retains a collapsed category row while removing its item rows', () => {
    expect(createInventoryVirtualRows(items, new Set(['ram'])).map((row) => row.key)).toEqual([
      'category:cpu',
      'item:cpu:1',
      'category:ram',
    ])
  })
})
