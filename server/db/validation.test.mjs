import { describe, expect, it } from 'vitest'
import { assertInventoryStoreShape } from './validation.mjs'

function inventoryWith(item) {
  return {
    servers: [], cpus: [item], ram: [], storage: [], networkCards: [], gpus: [],
    nas: [], switches: [], patchPanels: [],
  }
}

describe('inventory lifecycle validation', () => {
  it('accepts an absent or valid ISO archivedAt timestamp', () => {
    expect(() => assertInventoryStoreShape(inventoryWith({ id: 1, name: 'CPU' }))).not.toThrow()
    expect(() => assertInventoryStoreShape(inventoryWith({
      id: 1,
      name: 'CPU',
      archivedAt: '2026-07-19T12:00:00.000Z',
    }))).not.toThrow()
  })

  it('rejects invalid archivedAt values', () => {
    for (const archivedAt of ['', 'not-a-date', 123]) {
      expect(() => assertInventoryStoreShape(inventoryWith({ id: 1, name: 'CPU', archivedAt })))
        .toThrow('archivedAt')
    }
  })
})
