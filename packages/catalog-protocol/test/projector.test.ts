import { describe, expect, it } from 'vitest'
import { projectCatalogItem } from '../src'

function switchItem(id: number, name: string) {
  return { id, type: 'switch', name, manufacturer: 'Netgear', model: 'GS108T', specs: { management: 'Web managed' } }
}

describe('category-aware catalog projection', () => {
  it('ignores local display names for identified products', async () => {
    const first = await projectCatalogItem(switchItem(1, 'Core switch #1'))
    const second = await projectCatalogItem(switchItem(2, 'Garage switch #2'))
    expect(first.status).toBe('eligible')
    expect(second.status).toBe('eligible')
    if (first.status === 'eligible' && second.status === 'eligible') {
      expect(first.identityHash).toBe(second.identityHash)
      expect(first.contentHash).toBe(second.contentHash)
      expect(first.item.name).toBe('Netgear GS108T')
    }
  })

  it('keeps OptiPlex 7090 board variants distinct', async () => {
    const base = { id: 1, type: 'server', name: '7090', manufacturer: 'Dell', model: 'OptiPlex Micro 7090' }
    const discrete = await projectCatalogItem({ ...base, specs: { formFactor: 'Micro', boardVariant: 'Discrete riser' } })
    const standard = await projectCatalogItem({ ...base, id: 2, specs: { formFactor: 'Micro', boardVariant: '65W' } })
    expect(discrete.status).toBe('eligible')
    expect(standard.status).toBe('eligible')
    if (discrete.status === 'eligible' && standard.status === 'eligible') {
      expect(discrete.identityHash).not.toBe(standard.identityHash)
    }
  })

  it('keeps generic RAM speeds distinct', async () => {
    const base = { type: 'ram', name: 'Memory', manufacturer: 'Generic', specs: { capacityGb: 16, generation: 'DDR4', formFactor: 'SO-DIMM', ecc: false } }
    const slow = await projectCatalogItem({ ...base, id: 1, specs: { ...base.specs, speedMt: 2666 } })
    const fast = await projectCatalogItem({ ...base, id: 2, specs: { ...base.specs, speedMt: 3200 } })
    expect(slow.status).toBe('eligible')
    expect(fast.status).toBe('eligible')
    if (slow.status === 'eligible' && fast.status === 'eligible') expect(slow.identityHash).not.toBe(fast.identityHash)
  })

  it('withholds unidentified generic storage', async () => {
    expect(await projectCatalogItem({ id: 1, type: 'storage', name: '256GB NVMe', specs: { capacityGb: 256, interface: 'NVMe' } }))
      .toMatchObject({ status: 'ineligible', reason: 'insufficient-identity' })
  })

  it('rejects legacy paired-RAM records', async () => {
    expect(await projectCatalogItem({ id: 1, type: 'ram', name: '32GB DDR4', manufacturer: 'Crucial', model: 'Kit', specs: { capacityGb: 32, moduleCount: 2, speedMt: 3200 } }))
      .toMatchObject({ status: 'ineligible', reason: 'legacy-ram-kit' })
  })
})
