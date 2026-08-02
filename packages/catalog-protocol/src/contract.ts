import { digestCatalogTemplate } from './projector'
import { FINGERPRINT_VERSION, LEGACY_FINGERPRINT_VERSION, OEM_FINGERPRINT_VERSION } from './types'

const FINGERPRINT_V2_CPU_VECTOR = {
  item: {
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
  },
  identityHash: 'f253f149aac5c3df2ec7bff68f985e49138ebe6f7c19795536738f23b0969416',
  contentHash: 'e404ed4bb011bda97f3d2edfe9d07e4ccc0caa816ff35c3a6c51029501590af2',
} as const

const FINGERPRINT_V3_CPU_IMPORT_VECTOR = {
  item: {
    type: 'cpu',
    name: 'AMD Ryzen 9 7950X',
    manufacturer: 'AMD',
    family: 'Ryzen 9',
    model: '7950X',
    number: '7950X',
    specs: {
      socket: 'AM5',
      cores: 16,
      threads: 32,
      baseClockGhz: 4.5,
      boostClockGhz: 5.7,
      tdpWatts: 170,
      channels: 2,
      generation: 'Zen 4',
      cacheMb: 80,
      memoryTypes: 'DDR5',
      memorySpeedsMt: '5200, 3600',
      eccSupport: true,
      integratedGraphics: 'AMD Radeon Graphics',
      pcieGeneration: 5,
      pcieLanes: 24,
      maxTemperatureC: 95,
      launchDate: '2022-09-27',
      discontinued: false,
    },
  },
  identityHash: '6596dbfe2cdc69d21e871629d10227a20d4d1bd1f51d8c7c1456bfd109d12f23',
  contentHash: '6ca5f91e7b8eb8fcfccc7e5de53b1f170a0916b82d33023c3df96a2245b4f228',
} as const

const FINGERPRINT_V4_OEM_PLATFORM_VECTOR = {
  item: {
    type: 'desktop',
    name: 'Dell OptiPlex Micro 7090 - PCIe Riser',
    manufacturer: 'Dell',
    family: 'OptiPlex Micro',
    model: '7090',
    specs: {
      formFactor: 'Micro',
      variantKey: 'pcie-riser',
      topologyCompleteness: 'complete',
    },
    ports: [{
      id: 1,
      key: 'lan-1',
      kind: 'network',
      type: 'rj45',
      slotNumber: 1,
      speed: '1G',
      origin: 'fixed',
    }],
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
        expansionSlots: [{
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
        }],
        optionalModuleSlots: [],
        power: {
          configuration: 'external-adapter',
          connector: 'Dell 4.5mm barrel',
          supportedWattagesWatts: [65, 90],
          adapterRequired: true,
        },
        topologyCompleteness: 'complete',
      },
    },
  },
  identityHash: '6f88a701b9130d7cfdbff8d9ed3f3c77c13eb2032a4abd59501b641814c25bfd',
  contentHash: 'a78dfd47b765e04e3e53330a4970b6a7709374fb51f1862326d6054d6df5ff22',
} as const

export async function assertCatalogProtocolContract(): Promise<void> {
  if (FINGERPRINT_VERSION !== 3 || LEGACY_FINGERPRINT_VERSION !== 2 || OEM_FINGERPRINT_VERSION !== 4) {
    throw new Error(`Catalog fingerprint version ${FINGERPRINT_VERSION} has no publication contract.`)
  }

  const projection = await digestCatalogTemplate(FINGERPRINT_V2_CPU_VECTOR.item, {
    fingerprintVersion: LEGACY_FINGERPRINT_VERSION,
  })
  if (
    projection.identityHash !== FINGERPRINT_V2_CPU_VECTOR.identityHash
    || projection.contentHash !== FINGERPRINT_V2_CPU_VECTOR.contentHash
  ) {
    throw new Error('Catalog fingerprint-v2 implementation does not match its immutable publication contract.')
  }

  const currentProjection = await digestCatalogTemplate(FINGERPRINT_V3_CPU_IMPORT_VECTOR.item)
  if (
    currentProjection.status !== 'eligible'
    || currentProjection.identityHash !== FINGERPRINT_V3_CPU_IMPORT_VECTOR.identityHash
    || currentProjection.contentHash !== FINGERPRINT_V3_CPU_IMPORT_VECTOR.contentHash
  ) {
    throw new Error('Catalog fingerprint-v3 CPU import contract changed unexpectedly.')
  }


  const oemProjection = await digestCatalogTemplate(FINGERPRINT_V4_OEM_PLATFORM_VECTOR.item, {
    fingerprintVersion: OEM_FINGERPRINT_VERSION,
  })
  if (
    oemProjection.identityHash !== FINGERPRINT_V4_OEM_PLATFORM_VECTOR.identityHash
    || oemProjection.contentHash !== FINGERPRINT_V4_OEM_PLATFORM_VECTOR.contentHash
  ) {
    throw new Error('Catalog fingerprint-v4 OEM platform contract changed unexpectedly.')
  }
}
