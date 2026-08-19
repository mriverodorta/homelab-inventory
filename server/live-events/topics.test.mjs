import { describe, expect, it } from 'vitest'
import { parseApplicationLiveTopic } from './topics.mjs'

describe('inventory metadata live topics', () => {
  it('authorizes catalog and project-scoped metadata topics', () => {
    expect(parseApplicationLiveTopic('inventory-metadata:catalog')).toEqual({
      value: 'inventory-metadata:catalog',
      permission: 'inventory.view',
      kind: 'inventory-metadata-catalog',
    })
    expect(parseApplicationLiveTopic('inventory-metadata:7')).toEqual({
      value: 'inventory-metadata:7',
      permission: 'inventory.view',
      kind: 'inventory-metadata',
      projectId: 7,
    })
    expect(() => parseApplicationLiveTopic('inventory-metadata:0')).toThrow(/positive/iu)
  })
})
