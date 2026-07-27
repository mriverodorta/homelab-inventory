import { describe, expect, it } from 'vitest'
import { projectCatalogItem, reconcileCatalogProjections } from '../src'

describe('local catalog reconciliation', () => {
  it('collapses physical copies while retaining private sources', async () => {
    const projections = await Promise.all([1, 2, 3].map((id) => projectCatalogItem({
      id, type: 'switch', name: `Lab switch #${id}`, manufacturer: 'Netgear', model: 'GS108T', specs: { management: 'Web' },
    })))
    const groups = await reconcileCatalogProjections(projections)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ sources: [
      { itemType: 'switch', itemId: 1 }, { itemType: 'switch', itemId: 2 }, { itemType: 'switch', itemId: 3 },
    ] })
  })

  it('omits conflicting non-identity fields', async () => {
    const projections = await Promise.all([true, false].map((fanless, index) => projectCatalogItem({
      id: index + 1, type: 'switch', name: 'Switch', manufacturer: 'Netgear', model: 'GS108T', specs: { fanless, management: 'Web' },
    })))
    const [group] = await reconcileCatalogProjections(projections)
    expect('status' in group ? group.status : group.item.specs?.fanless).not.toBe(true)
    if (!('status' in group)) expect(group.item.specs).toEqual({ management: 'Web' })
  })
})
