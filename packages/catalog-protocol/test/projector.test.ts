import { describe, expect, it } from 'vitest'
import {
  assertCatalogProtocolContract,
  digestCatalogTemplate,
  FINGERPRINT_VERSION,
  LEGACY_FINGERPRINT_VERSION,
  projectCatalogItem,
} from '../src'

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
    const base = {
      id: 1,
      type: 'server',
      hardwareClass: 'desktop',
      name: '7090',
      manufacturer: 'Dell',
      model: 'OptiPlex Micro 7090',
      specs: { formFactor: 'Micro', motherboardPartNumber: '014T59', motherboardRevision: 'A00', boardVariant: 'Discrete graphics' },
      compatibility: {
        host: {
          topologyCompleteness: 'complete',
          expansionSlots: [{ id: 1, key: 'dgpu-riser', count: 1, label: 'Proprietary graphics riser', pcieGeneration: 3, electricalLanes: 8 }],
        },
      },
    }
    const discrete = await projectCatalogItem(base)
    const standard = await projectCatalogItem({
      ...base,
      id: 2,
      specs: { formFactor: 'Micro', motherboardPartNumber: '04frx5', motherboardRevision: 'a00', boardVariant: 'Standard' },
      compatibility: { host: { topologyCompleteness: 'complete', expansionSlots: [] } },
    })
    expect(discrete.status).toBe('eligible')
    expect(standard.status).toBe('eligible')
    if (discrete.status === 'eligible' && standard.status === 'eligible') {
      expect(discrete.identityHash).not.toBe(standard.identityHash)
      expect(discrete).toMatchObject({
        fingerprintVersion: 3,
        productFamily: { manufacturer: 'Dell', model: 'OptiPlex Micro 7090', physicalClass: 'desktop' },
        variantEvidence: {
          source: 'motherboard',
          motherboardPartNumber: '014T59',
          motherboardRevision: 'A00',
          variantKey: 'discrete-graphics',
        },
      })
      expect(standard).toMatchObject({
        variantEvidence: { motherboardPartNumber: '04FRX5', motherboardRevision: 'A00' },
      })
    }
  })

  it('normalizes motherboard casing and punctuation before hashing', async () => {
    const base = { id: 1, type: 'server', hardwareClass: 'desktop', name: '7090', manufacturer: 'Dell', model: 'OptiPlex Micro 7090' }
    const first = await projectCatalogItem({ ...base, specs: { motherboardPartNumber: '014t59 a00' } })
    const second = await projectCatalogItem({ ...base, id: 2, specs: { motherboardPartNumber: '014T59', boardRevision: 'A-00' } })
    expect(first.status).toBe('eligible')
    expect(second.status).toBe('eligible')
    if (first.status === 'eligible' && second.status === 'eligible') expect(first.identityHash).toBe(second.identityHash)
  })

  it('uses complete topology as a fallback but does not infer identity from partial topology', async () => {
    const base = { id: 1, type: 'desktop', name: 'System', manufacturer: 'Example', model: 'Mini 1' }
    const topology = { expansionSlots: [{ id: 1, key: 'riser', count: 1, pcieGeneration: 3, electricalLanes: 8 }] }
    const complete = await projectCatalogItem({ ...base, compatibility: { host: { ...topology, topologyCompleteness: 'complete' } } })
    const otherComplete = await projectCatalogItem({ ...base, id: 2, compatibility: { host: { expansionSlots: [], topologyCompleteness: 'complete' } } })
    const partial = await projectCatalogItem({ ...base, id: 3, compatibility: { host: { ...topology, topologyCompleteness: 'partial' } } })
    const generic = await projectCatalogItem({ ...base, id: 4 })
    expect(complete).toMatchObject({ status: 'eligible', variantEvidence: { source: 'topology', completeness: 'complete' } })
    expect(partial).toMatchObject({ status: 'eligible', variantEvidence: { source: 'generic', completeness: 'partial' } })
    if (complete.status === 'eligible' && otherComplete.status === 'eligible') expect(complete.identityHash).not.toBe(otherComplete.identityHash)
    if (partial.status === 'eligible' && generic.status === 'eligible') expect(partial.identityHash).toBe(generic.identityHash)
  })

  it('separates an explicit PCIe riser variant from a generic family without requiring complete topology', async () => {
    const base = {
      type: 'server', hardwareClass: 'desktop', name: '7090', manufacturer: 'Dell', model: 'OptiPlex Micro 7090',
      compatibility: {
        host: {
          expansionSlots: [{
            id: 1, key: 'm2-ae-slot', count: 1, label: 'M.2 2230 A/E network slot',
            interfaceFamily: 'm2-ae', maxPowerWatts: 5,
          }],
        },
      },
    }
    const standard = await projectCatalogItem({ ...base, id: 1 })
    const riser = await projectCatalogItem({
      ...base,
      id: 2,
      compatibility: {
        host: {
          expansionSlots: [
            {
              id: 1, key: 'custom-pcie-slot', count: 1, label: 'Custom low-profile PCIe adapter',
              interfaceFamily: 'pcie', pcieGeneration: 4, mechanicalLanes: 8, electricalLanes: 8,
              acceptedHeights: ['low-profile'], maxSlotWidth: 1, maxPowerWatts: 75,
            },
            ...base.compatibility.host.expansionSlots,
          ],
        },
      },
    })

    expect(standard).toMatchObject({
      status: 'eligible',
      variantEvidence: { source: 'generic', completeness: 'partial', label: 'Generic family' },
    })
    expect(riser).toMatchObject({
      status: 'eligible',
      variantEvidence: {
        source: 'topology', completeness: 'partial', label: 'Topology-defined variant',
        structuralSummary: 'PCIe Gen4 x8 Custom low-profile PCIe adapter · M.2 2230 A/E network slot',
      },
    })
    if (standard.status === 'eligible' && riser.status === 'eligible') {
      expect(standard.identityHash).not.toBe(riser.identityHash)
      expect(standard.contentHash).not.toBe(riser.contentHash)
    }
  })

  it('does not use installed components or slot occupancy as variant identity', async () => {
    const base = {
      id: 1, type: 'desktop', name: 'System', manufacturer: 'Example', model: 'Mini 1',
      specs: { motherboardPartNumber: 'BOARD-1', boardRevision: 'A00' },
    }
    const first = await projectCatalogItem({ ...base, installedCpuId: 1, installedGpuId: 2, assignments: [1, 2] })
    const second = await projectCatalogItem({ ...base, id: 2, installedCpuId: 9, installedGpuId: 10, assignments: [] })
    if (first.status === 'eligible' && second.status === 'eligible') expect(first.identityHash).toBe(second.identityHash)
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
    expect(FINGERPRINT_VERSION).toBe(3)
    expect(LEGACY_FINGERPRINT_VERSION).toBe(2)

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
    }, { fingerprintVersion: LEGACY_FINGERPRINT_VERSION })

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
