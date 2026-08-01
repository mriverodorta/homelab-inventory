import { describe, expect, it } from 'vitest'
import { assertCatalogProtocolContract, digestCatalogTemplate, FINGERPRINT_VERSION, projectCatalogItem } from '../src'

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

  it('projects an OEM computer by physical class without leaking its local usage role', async () => {
    const base = {
      id: 1,
      type: 'server',
      name: 'Proxmox node',
      manufacturer: 'Dell',
      model: 'OptiPlex Micro 7090',
      hardwareClass: 'desktop',
      specs: { formFactor: 'Micro' },
    }
    const serverRole = await projectCatalogItem({ ...base, usageRole: 'server' })
    const workstationRole = await projectCatalogItem({ ...base, id: 2, usageRole: 'workstation' })

    expect(serverRole).toMatchObject({
      status: 'eligible',
      source: { itemType: 'server', itemId: 1 },
      item: { type: 'desktop', name: 'Dell OptiPlex Micro 7090' },
    })
    expect(workstationRole).toMatchObject({
      status: 'eligible',
      source: { itemType: 'server', itemId: 2 },
      item: { type: 'desktop', name: 'Dell OptiPlex Micro 7090' },
    })
    if (serverRole.status === 'eligible' && workstationRole.status === 'eligible') {
      expect(serverRole.identityHash).toBe(workstationRole.identityHash)
      expect(serverRole.contentHash).toBe(workstationRole.contentHash)
      expect(serverRole.item).not.toHaveProperty('usageRole')
    }
  })

  it('keeps desktop and server products as distinct physical catalog identities', async () => {
    const product = {
      id: 1,
      name: 'OEM system',
      manufacturer: 'Dell',
      model: 'PowerEdge T40',
      specs: { formFactor: 'Tower' },
    }
    const desktop = await projectCatalogItem({ ...product, type: 'desktop' })
    const server = await projectCatalogItem({ ...product, type: 'server' })

    expect(desktop.status).toBe('eligible')
    expect(server.status).toBe('eligible')
    if (desktop.status === 'eligible' && server.status === 'eligible') {
      expect(desktop.identityHash).not.toBe(server.identityHash)
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

  it('does not duplicate a CPU family tier already present in its number', async () => {
    const projection = await projectCatalogItem({
      id: 1,
      type: 'cpu',
      name: 'CPU',
      manufacturer: 'Intel',
      family: 'Core i5',
      number: 'i5-10500T',
    })

    expect(projection).toMatchObject({
      status: 'eligible',
      item: { name: 'Intel Core i5-10500T' },
    })
  })

  it('keeps a CPU family tier when the number does not repeat it', async () => {
    const projection = await projectCatalogItem({
      id: 2,
      type: 'cpu',
      name: 'CPU',
      manufacturer: 'AMD',
      family: 'Ryzen 5',
      number: '4650GE',
    })

    expect(projection).toMatchObject({
      status: 'eligible',
      item: { name: 'AMD Ryzen 5 4650GE' },
    })
  })

  it('preserves the immutable fingerprint-v2 revision-3 CPU contract', async () => {
    expect(FINGERPRINT_VERSION).toBe(2)

    const projection = await digestCatalogTemplate({
      type: 'cpu',
      name: 'Intel Core i5-10500T',
      manufacturer: 'Intel',
      family: 'Core i5',
      model: 'i5-10500T',
      specs: {
        cores: 6,
        socket: 'LGA1200',
        threads: 12,
        tdpWatts: 35,
        generation: '10th Gen',
        baseClockGhz: 2.3,
        boostClockGhz: 3.8,
      },
    })

    expect(projection.item).toEqual({
      type: 'cpu',
      name: 'Intel Core i5-10500T',
      manufacturer: 'Intel',
      family: 'Core i5',
      model: 'i5-10500T',
      specs: {
        cores: 6,
        socket: 'LGA1200',
        threads: 12,
        tdpWatts: 35,
        generation: '10th Gen',
        baseClockGhz: 2.3,
        boostClockGhz: 3.8,
      },
    })
    expect(projection.identityHash).toBe('f253f149aac5c3df2ec7bff68f985e49138ebe6f7c19795536738f23b0969416')
    expect(projection.contentHash).toBe('e404ed4bb011bda97f3d2edfe9d07e4ccc0caa816ff35c3a6c51029501590af2')
    await expect(assertCatalogProtocolContract()).resolves.toBeUndefined()
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
