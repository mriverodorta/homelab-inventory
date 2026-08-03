import { digestCatalogTemplate } from './projector'
import {
  FINGERPRINT_VERSION,
  LEGACY_FINGERPRINT_VERSION,
  OEM_FINGERPRINT_VERSION,
  SERVER_FINGERPRINT_VERSION,
  WORKSTATION_FINGERPRINT_VERSION,
} from './types'

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

const FINGERPRINT_V5_WORKSTATION_VECTOR = {
  item: {
    type: 'workstation',
    name: 'Dell Precision 7920 Tower - Dual socket tower',
    manufacturer: 'Dell',
    family: 'Precision',
    model: '7920 Tower',
    specs: {
      formFactor: 'Tower',
      topologyCompleteness: 'complete',
      variantKey: 'dual-socket',
      launchDate: '2017-10-03',
      motherboardPartNumber: 'PRECISION-7920-MB',
      motherboardRevision: 'A00',
      boardVariant: 'Dual socket',
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
          eccSupport: 'supported',
          moduleTypes: ['LRDIMM', 'RDIMM'],
        },
        storageSlots: [{
          id: 1,
          key: 'front-flexbay-sata',
          label: 'Front FlexBay SATA bays',
          count: 4,
          interfaces: ['SATA'],
          formFactors: ['2.5-inch', '3.5-inch'],
          location: 'internal',
          hotSwap: true,
          backplane: 'Dell FlexBay SATA backplane',
        }, {
          id: 2,
          key: 'front-flexbay-nvme',
          label: 'Front FlexBay NVMe bays',
          count: 4,
          interfaces: ['NVMe'],
          formFactors: ['2.5-inch'],
          pcieGeneration: 3,
          location: 'internal',
          hotSwap: true,
          backplane: 'Dell FlexBay NVMe backplane',
        }],
        expansionSlots: [{
          id: 1,
          key: 'pcie-x16-primary',
          label: 'Primary PCIe x16 slot',
          count: 1,
          interfaceFamily: 'pcie',
          pcieGeneration: 3,
          mechanicalLanes: 16,
          electricalLanes: 16,
          acceptedHeights: ['full-height'],
          maxSlotWidth: 2,
          maxPowerWatts: 300,
        }, {
          id: 2,
          key: 'pcie-x16-secondary',
          label: 'Secondary PCIe x16 slot',
          count: 1,
          interfaceFamily: 'pcie',
          pcieGeneration: 3,
          mechanicalLanes: 16,
          electricalLanes: 16,
          acceptedHeights: ['full-height'],
          maxSlotWidth: 2,
          maxPowerWatts: 300,
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
          key: 'nvme-backplane-or-secondary-pcie',
          label: 'NVMe backplane and secondary PCIe slot are mutually exclusive',
          kind: 'mutually-exclusive',
          members: [{ resourceType: 'expansion-slot', resourceId: 2 }, {
            resourceType: 'storage-slot', resourceId: 2,
          }],
        }],
      },
    },
  },
  identityHash: '4639083e09ccf18be877240fa5e28742b6d248edd9ba2b3678df8a0bfcd9aabe',
  contentHash: '4ab82bb2c82c924bb2e78cc75ce3a116a532ba624fcca4202f572a1c6e17d0b0',
} as const

const FINGERPRINT_V6_SERVER_VECTOR = {
  item: {
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
          socketCount: 2,
        },
        memory: {
          slots: 24,
          generations: ['DDR4'],
          maxCapacityGb: 3072,
        },
        storageSlots: [{
          id: 1,
          key: 'front-sff',
          count: 8,
          interfaces: ['SAS', 'SATA'],
          formFactors: ['2.5-inch'],
          hotSwap: true,
          backplane: '8-bay SFF SAS/SATA',
        }],
        expansionSlots: [],
        optionalModuleSlots: [],
        power: {
          configuration: 'internal-psu',
          redundancy: 'supported',
        },
        constraintGroups: [],
      },
    },
  },
  identityHash: '5be66f2f168dfd0029b9c4c8b599f4b345764ae7391b0f9a45e5d44d7355e2d9',
  contentHash: 'a6cf6707ff6c0fdceee152b206465a390bbeab5d97cbf1bf8bec92962cdd625d',
} as const

export async function assertCatalogProtocolContract(): Promise<void> {
  if (FINGERPRINT_VERSION !== 3 || LEGACY_FINGERPRINT_VERSION !== 2
    || OEM_FINGERPRINT_VERSION !== 4 || WORKSTATION_FINGERPRINT_VERSION !== 5
    || SERVER_FINGERPRINT_VERSION !== 6) {
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

  const workstationProjection = await digestCatalogTemplate(FINGERPRINT_V5_WORKSTATION_VECTOR.item, {
    fingerprintVersion: WORKSTATION_FINGERPRINT_VERSION,
  })
  if (
    workstationProjection.identityHash !== FINGERPRINT_V5_WORKSTATION_VECTOR.identityHash
    || workstationProjection.contentHash !== FINGERPRINT_V5_WORKSTATION_VECTOR.contentHash
  ) {
    throw new Error('Catalog fingerprint-v5 workstation contract changed unexpectedly.')
  }

  const serverProjection = await digestCatalogTemplate(FINGERPRINT_V6_SERVER_VECTOR.item, {
    fingerprintVersion: SERVER_FINGERPRINT_VERSION,
  })
  if (
    serverProjection.identityHash !== FINGERPRINT_V6_SERVER_VECTOR.identityHash
    || serverProjection.contentHash !== FINGERPRINT_V6_SERVER_VECTOR.contentHash
  ) {
    throw new Error('Catalog fingerprint-v6 server contract changed unexpectedly.')
  }
}
