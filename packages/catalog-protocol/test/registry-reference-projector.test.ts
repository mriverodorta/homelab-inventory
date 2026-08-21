import { describe, expect, it } from 'vitest'
import {
  assertCatalogProtocolContract,
  catalogItemMeetsEligibility,
  digestCatalogTemplate,
  FINGERPRINT_VERSION,
  LEGACY_FINGERPRINT_VERSION,
  MOTHERBOARD_FINGERPRINT_VERSION,
  RAM_FINGERPRINT_VERSION,
  OEM_FINGERPRINT_VERSION,
  SERVER_FINGERPRINT_VERSION,
  SUPPORTED_FINGERPRINT_VERSIONS,
  WORKSTATION_FINGERPRINT_VERSION,
  projectCatalogItem,
} from '../src'

function switchItem(id: number, name: string) {
  return { id, type: 'switch', name, manufacturer: 'Netgear', model: 'GS108T', specs: { management: 'Web managed' } }
}

describe('category-aware catalog projection', () => {
  const am5Motherboard = {
    id: 1,
    type: 'motherboard',
    name: 'ASUS ROG Strix B650E-F Gaming WiFi',
    manufacturer: 'ASUS',
    family: 'ROG Strix',
    model: 'B650E-F Gaming WiFi',
    aliases: ['ROG STRIX B650E-F GAMING WIFI'],
    specs: {
      chipset: 'B650E',
      formFactor: 'ATX',
      wifiGeneration: 'Wi-Fi 6E',
      boardRevision: '1.0',
    },
    ports: [{ id: 1, kind: 'network', type: 'rj45', slotNumber: 1, speed: '2.5G', origin: 'fixed' }],
    compatibility: {
      host: {
        cpu: { sockets: ['AM5'], generations: ['Ryzen 7000', 'Ryzen 8000G', 'Ryzen 9000'], socketCount: 1 },
        memory: { slots: 4, generations: ['DDR5'], maxCapacityGb: 192, maxSpeedMt: 8000 },
        storageSlots: [{ id: 1, key: 'm2-1', count: 1, interfaces: ['NVMe'], formFactors: ['2280'], pcieGeneration: 5 }],
        expansionSlots: [{ id: 1, key: 'pcie-x16-1', count: 1, interfaceFamily: 'pcie', mechanicalLanes: 16, electricalLanes: 16, pcieGeneration: 5 }],
        powerConnectors: [
          { id: 1, kind: 'atx-main', connector: '24-pin ATX', count: 1, required: true },
          { id: 2, kind: 'cpu-eps', connector: '8-pin EPS', count: 2, required: true },
        ],
      },
    },
  }

  it('keeps material retail motherboard variants distinct in fingerprint v7', async () => {
    const wifiDdr5 = await projectCatalogItem(am5Motherboard, { fingerprintVersion: MOTHERBOARD_FINGERPRINT_VERSION })
    const noWifi = await projectCatalogItem({
      ...am5Motherboard,
      id: 2,
      name: 'ASUS ROG Strix B650E-F Gaming',
      model: 'B650E-F Gaming',
      aliases: [],
      specs: { ...am5Motherboard.specs, wifiGeneration: '' },
    }, { fingerprintVersion: MOTHERBOARD_FINGERPRINT_VERSION })
    const ddr4 = await projectCatalogItem({
      ...am5Motherboard,
      id: 3,
      compatibility: {
        host: {
          ...am5Motherboard.compatibility.host,
          memory: { slots: 4, generations: ['DDR4'], maxCapacityGb: 128, maxSpeedMt: 5333 },
        },
      },
    }, { fingerprintVersion: MOTHERBOARD_FINGERPRINT_VERSION })

    expect(wifiDdr5).toMatchObject({
      status: 'eligible',
      fingerprintVersion: 7,
      productFamily: { manufacturer: 'ASUS', model: 'B650E-F Gaming WiFi', physicalClass: 'motherboard' },
      variantEvidence: { source: 'topology', completeness: 'complete' },
    })
    if (wifiDdr5.status === 'eligible' && noWifi.status === 'eligible' && ddr4.status === 'eligible') {
      expect(wifiDdr5.identityHash).not.toBe(noWifi.identityHash)
      expect(wifiDdr5.identityHash).not.toBe(ddr4.identityHash)
    }
  })

  it('keeps aliases and lifecycle metadata out of motherboard v7 identity', async () => {
    const first = await projectCatalogItem(am5Motherboard, { fingerprintVersion: MOTHERBOARD_FINGERPRINT_VERSION })
    const second = await projectCatalogItem({
      ...am5Motherboard,
      id: 2,
      aliases: ['B650E F WIFI', 'Alternate official spelling'],
      specs: { ...am5Motherboard.specs, launchDate: '2022-10-04', discontinued: true },
    }, { fingerprintVersion: MOTHERBOARD_FINGERPRINT_VERSION })

    expect(first.status).toBe('eligible')
    expect(second.status).toBe('eligible')
    if (first.status === 'eligible' && second.status === 'eligible') {
      expect(first.identityHash).toBe(second.identityHash)
      expect(first.contentHash).not.toBe(second.contentHash)
    }
  })

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

  it('uses OEM fingerprint v4 for complete platform topology without changing the default fingerprint', async () => {
    expect(FINGERPRINT_VERSION).toBe(3)
    expect(OEM_FINGERPRINT_VERSION).toBe(4)

    const standard = {
      type: 'desktop',
      name: 'Dell OptiPlex Micro 7090 - Standard',
      manufacturer: 'Dell',
      family: 'OptiPlex Micro',
      model: '7090',
      specs: {
        formFactor: 'Micro',
        variantKey: 'standard',
        topologyCompleteness: 'complete',
      },
      ports: [
        { id: 1, key: 'lan-1', kind: 'network', type: 'rj45', slotNumber: 1, speed: '1G', origin: 'fixed' },
        { id: 2, key: 'optional-dp', kind: 'video', type: 'displayport', slotNumber: 2, origin: 'module' },
      ],
      compatibility: {
        host: {
          cpu: { sockets: ['LGA1200'], generations: ['10th Gen', '11th Gen'], maxTdpWatts: 65 },
          memory: {
            slots: 2,
            generations: ['DDR4'],
            maxCapacityGb: 64,
            maxModuleCapacityGb: 32,
            maxSpeedMt: 3200,
            eccSupport: 'unsupported',
          },
          storageSlots: [{
            id: 1,
            key: 'm2-2280',
            label: 'M.2 2280 NVMe',
            count: 1,
            interfaces: ['NVMe'],
            formFactors: ['2280'],
            pcieGeneration: 4,
          }],
          expansionSlots: [],
          optionalModuleSlots: [{
            id: 1,
            key: 'rear-flex-io',
            label: 'Rear configurable port',
            count: 1,
            acceptedModuleKinds: ['displayport', 'hdmi', 'usb-c'],
          }],
          power: {
            configuration: 'external-adapter',
            connector: 'Dell 4.5mm barrel',
            supportedWattagesWatts: [65, 90],
            adapterRequired: true,
          },
          topologyCompleteness: 'complete',
        },
      },
    }
    const riser = structuredClone(standard)
    riser.name = 'Dell OptiPlex Micro 7090 - PCIe Riser'
    riser.specs.variantKey = 'pcie-riser'
    riser.compatibility.host.expansionSlots = [{
      id: 1,
      key: 'proprietary-pcie-riser',
      label: 'Proprietary PCIe riser',
      count: 1,
      interfaceFamily: 'pcie',
      pcieGeneration: 3,
      mechanicalLanes: 16,
      electricalLanes: 8,
      acceptedHeights: ['low-profile'],
      maxSlotWidth: 1,
      proprietaryRiser: true,
      riserCapability: 'Dell Micro PCIe riser',
    }]

    const standardProjection = await digestCatalogTemplate(standard, {
      fingerprintVersion: OEM_FINGERPRINT_VERSION,
    })
    const riserProjection = await digestCatalogTemplate(riser, {
      fingerprintVersion: OEM_FINGERPRINT_VERSION,
    })

    expect(standardProjection.identityHash).not.toBe(riserProjection.identityHash)
    expect(standardProjection.item.ports).toEqual(standard.ports)
    expect(standardProjection.identityPayload).toHaveProperty('topologySignature')
    expect(riserProjection.variantEvidence).toMatchObject({
      source: 'topology',
      completeness: 'complete',
      variantKey: 'pcie-riser',
    })
  })

  it('uses workstation fingerprint v5 for material workstation topology', async () => {
    expect(WORKSTATION_FINGERPRINT_VERSION).toBe(5)
    const projection = await digestCatalogTemplate({
      type: 'workstation',
      name: 'Dell Precision 7920 Tower - Dual socket tower',
      manufacturer: 'Dell',
      family: 'Precision',
      model: '7920 Tower',
      specs: {
        formFactor: 'Tower',
        variantKey: 'dual-socket',
        topologyCompleteness: 'complete',
        motherboardPartNumber: 'PRECISION-7920-MB',
        motherboardRevision: 'A00',
      },
      compatibility: {
        host: {
          topologyCompleteness: 'complete',
          cpu: { sockets: ['LGA3647'], generations: ['Intel Xeon Scalable'], maxTdpWatts: 205, socketCount: 2 },
          memory: {
            slots: 24,
            generations: ['DDR4'],
            maxCapacityGb: 3072,
            maxModuleCapacityGb: 128,
            maxSpeedMt: 2933,
            eccSupport: 'supported',
            moduleTypes: ['LRDIMM', 'RDIMM'],
          },
          storageSlots: [{
            id: 1,
            key: 'front-flexbay',
            count: 4,
            interfaces: ['NVMe'],
            formFactors: ['2.5-inch'],
            location: 'internal',
            hotSwap: true,
            backplane: 'Dell FlexBay NVMe backplane',
          }],
          expansionSlots: [{
            id: 1,
            key: 'pcie-x16',
            count: 1,
            interfaceFamily: 'pcie',
            pcieGeneration: 3,
            mechanicalLanes: 16,
            electricalLanes: 16,
            acceptedHeights: ['full-height'],
          }],
          optionalModuleSlots: [],
          power: {
            configuration: 'internal-psu',
            connector: 'IEC C14',
            supportedWattagesWatts: [950, 1400],
            adapterRequired: false,
            redundancy: 'optional',
            maxGraphicsPowerWatts: 600,
          },
          constraintGroups: [{
            id: 1,
            key: 'shared-resource',
            kind: 'mutually-exclusive',
            members: [
              { resourceType: 'storage-slot', resourceId: 1 },
              { resourceType: 'expansion-slot', resourceId: 1 },
            ],
          }],
        },
      },
    }, { fingerprintVersion: WORKSTATION_FINGERPRINT_VERSION })

    expect(projection).toMatchObject({
      fingerprintVersion: 5,
      productFamily: { manufacturer: 'Dell', model: '7920 Tower', physicalClass: 'workstation' },
      variantEvidence: {
        source: 'motherboard',
        completeness: 'complete',
        motherboardPartNumber: 'PRECISION7920MB',
        motherboardRevision: 'A00',
        variantKey: 'dual-socket',
      },
    })
    expect(projection.identityPayload).toHaveProperty('topologySignature')
    expect(catalogItemMeetsEligibility(projection.item)).toBe(true)
  })

  it('uses server fingerprint v6 for complete material server topology', async () => {
    expect(SERVER_FINGERPRINT_VERSION).toBe(6)
    expect(MOTHERBOARD_FINGERPRINT_VERSION).toBe(7)
    expect(SUPPORTED_FINGERPRINT_VERSIONS).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])

    const base = {
      type: 'server',
      name: 'Dell PowerEdge R740 - 8 bay SFF',
      manufacturer: 'Dell',
      family: 'PowerEdge',
      model: 'R740',
      specs: {
        formFactor: 'Rack Server',
        rackUnits: 2,
        variantKey: '8-bay-sff',
        topologyCompleteness: 'complete',
      },
      ports: [{
        id: 1,
        key: 'idrac',
        kind: 'management',
        type: 'rj45',
        slotNumber: 1,
        speed: '1G',
        origin: 'fixed',
      }],
      compatibility: {
        host: {
          topologyCompleteness: 'complete',
          cpu: {
            sockets: ['LGA3647'],
            generations: ['Intel Xeon Scalable'],
            maxTdpWatts: 205,
            socketCount: 2,
          },
          memory: {
            slots: 24,
            generations: ['DDR4'],
            maxCapacityGb: 3072,
            maxModuleCapacityGb: 128,
            maxSpeedMt: 2933,
            eccSupport: 'required',
            moduleTypes: ['LRDIMM', 'RDIMM'],
          },
          storageSlots: [{
            id: 1,
            key: 'front-sff-sas-sata',
            count: 8,
            interfaces: ['SAS', 'SATA'],
            formFactors: ['2.5-inch'],
            location: 'front',
            hotSwap: true,
            backplane: '8-bay SFF SAS/SATA',
          }],
          expansionSlots: [{
            id: 1,
            key: 'riser-1-slot-1',
            count: 1,
            interfaceFamily: 'pcie',
            pcieGeneration: 3,
            mechanicalLanes: 16,
            electricalLanes: 16,
            acceptedHeights: ['full-height'],
          }],
          optionalModuleSlots: [],
          power: {
            configuration: 'internal-psu',
            connector: 'IEC C14',
            supportedWattagesWatts: [750, 1100],
            adapterRequired: false,
            redundancy: 'supported',
          },
          constraintGroups: [],
        },
      },
    }
    const alternateBackplane = structuredClone(base)
    alternateBackplane.name = 'Dell PowerEdge R740 - 16 bay SFF'
    alternateBackplane.specs.variantKey = '16-bay-sff'
    alternateBackplane.compatibility.host.storageSlots[0]!.count = 16
    alternateBackplane.compatibility.host.storageSlots[0]!.backplane = '16-bay SFF SAS/SATA'

    const first = await digestCatalogTemplate(base, { fingerprintVersion: SERVER_FINGERPRINT_VERSION })
    const second = await digestCatalogTemplate(alternateBackplane, { fingerprintVersion: SERVER_FINGERPRINT_VERSION })

    expect(first.fingerprintVersion).toBe(6)
    expect(first.identityHash).not.toBe(second.identityHash)
    expect(first).toMatchObject({
      productFamily: { manufacturer: 'Dell', model: 'R740', physicalClass: 'server' },
      variantEvidence: { source: 'topology', completeness: 'complete', variantKey: '8-bay-sff' },
    })
  })

  it('excludes installed and local server fields from fingerprint v6 identity', async () => {
    const base = {
      type: 'server',
      name: 'HPE ProLiant DL380 Gen10 - 8 bay SFF',
      manufacturer: 'HPE',
      model: 'ProLiant DL380 Gen10',
      specs: { formFactor: 'Rack Server', rackUnits: 2, topologyCompleteness: 'complete' },
      compatibility: {
        host: {
          topologyCompleteness: 'complete',
          cpu: { sockets: ['LGA3647'], generations: ['Intel Xeon Scalable'], socketCount: 2 },
          memory: { slots: 24, generations: ['DDR4'], maxCapacityGb: 3072 },
          storageSlots: [{
            id: 1,
            key: 'front-sff',
            count: 8,
            interfaces: ['SAS', 'SATA'],
            formFactors: ['2.5-inch'],
            hotSwap: true,
          }],
          expansionSlots: [],
          optionalModuleSlots: [],
          power: { configuration: 'internal-psu', redundancy: 'supported' },
          constraintGroups: [],
        },
      },
    }
    const local = {
      ...structuredClone(base),
      properties: { lanIp: '192.168.1.20' },
      assignments: [{ itemType: 'cpu', itemId: 1 }],
      services: [{ name: 'Proxmox' }],
      agent: { token: 'secret' },
    }

    const first = await digestCatalogTemplate(base, { fingerprintVersion: SERVER_FINGERPRINT_VERSION })
    const second = await digestCatalogTemplate(local, { fingerprintVersion: SERVER_FINGERPRINT_VERSION })

    expect(second.identityHash).toBe(first.identityHash)
    expect(second.contentHash).toBe(first.contentHash)
  })

  it('withholds unidentified generic storage', async () => {
    expect(await projectCatalogItem({ id: 1, type: 'storage', name: '256GB NVMe', specs: { capacityGb: 256, interface: 'NVMe' } }))
      .toMatchObject({ status: 'ineligible', reason: 'insufficient-identity' })
  })

  it('rejects legacy paired-RAM records', async () => {
    expect(await projectCatalogItem({ id: 1, type: 'ram', name: '32GB DDR4', manufacturer: 'Crucial', model: 'Kit', specs: { capacityGb: 32, moduleCount: 2, speedMt: 3200 } }))
      .toMatchObject({ status: 'ineligible', reason: 'legacy-ram-kit' })
  })

  it('uses exact manufacturer part number for RAM fingerprint v8 identity', async () => {
    const base = {
      type: 'ram',
      name: 'Samsung M471A2K43DB1-CWE',
      manufacturer: 'Samsung',
      number: 'M471A2K43DB1-CWE',
      specs: {
        capacityGb: 16,
        generation: 'DDR4',
        speedMt: 3200,
        formFactor: 'SO-DIMM',
        moduleType: 'UDIMM',
        ecc: false,
      },
      compatibility: {
        requirements: {
          memory: {
            capacityGb: 16,
            generation: 'DDR4',
            speedMt: 3200,
            formFactor: 'SO-DIMM',
            moduleType: 'UDIMM',
            ecc: false,
          },
        },
      },
    }
    const corrected = structuredClone(base)
    corrected.specs.rank = '2Rx8'
    const otherPart = structuredClone(base)
    otherPart.number = 'M471A1K43DB1-CWE'

    const first = await digestCatalogTemplate(base, { fingerprintVersion: RAM_FINGERPRINT_VERSION })
    const second = await digestCatalogTemplate(corrected, { fingerprintVersion: RAM_FINGERPRINT_VERSION })
    const third = await digestCatalogTemplate(otherPart, { fingerprintVersion: RAM_FINGERPRINT_VERSION })

    expect(first.fingerprintVersion).toBe(8)
    expect(second.identityHash).toBe(first.identityHash)
    expect(second.contentHash).not.toBe(first.contentHash)
    expect(third.identityHash).not.toBe(first.identityHash)
    expect(first.identityPayload).toEqual({
      type: 'ram',
      manufacturer: 'Samsung',
      partNumber: 'M471A2K43DB1CWE',
    })
    expect(first.item.name).toBe('Samsung M471A2K43DB1-CWE')
  })

  it('requires manufacturer and exact part number for RAM fingerprint v8', async () => {
    const generic = {
      id: 1,
      type: 'ram',
      name: '16GB DDR4',
      manufacturer: 'Samsung',
      specs: {
        capacityGb: 16,
        generation: 'DDR4',
        speedMt: 3200,
        formFactor: 'SO-DIMM',
        moduleType: 'UDIMM',
        ecc: false,
      },
    }
    expect(await projectCatalogItem(generic, { fingerprintVersion: RAM_FINGERPRINT_VERSION }))
      .toMatchObject({ status: 'ineligible', reason: 'insufficient-identity' })
    expect(await projectCatalogItem({ ...generic, manufacturer: undefined, number: 'M471A2K43DB1-CWE' }, {
      fingerprintVersion: RAM_FINGERPRINT_VERSION,
    })).toMatchObject({ status: 'ineligible', reason: 'insufficient-identity' })
  })
})
