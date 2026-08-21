import { digestCatalogTemplate } from './projector'
import {
  CANONICAL_UNITS_FINGERPRINT_VERSION,
  FINGERPRINT_VERSION,
  LEGACY_FINGERPRINT_VERSION,
  MOTHERBOARD_FINGERPRINT_VERSION,
  M2_PHYSICAL_FINGERPRINT_VERSION,
  NAS_FINGERPRINT_VERSION,
  NETWORK_FINGERPRINT_VERSION,
  OEM_FINGERPRINT_VERSION,
  RAM_FINGERPRINT_VERSION,
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

const FINGERPRINT_V7_MOTHERBOARD_VECTOR = {
  item: {
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
    ports: [{
      id: 1,
      kind: 'network',
      type: 'rj45',
      slotNumber: 1,
      speed: '2.5G',
      origin: 'fixed',
    }],
    compatibility: {
      host: {
        cpu: {
          sockets: ['AM5'],
          generations: ['Ryzen 7000', 'Ryzen 8000G', 'Ryzen 9000'],
          socketCount: 1,
        },
        memory: {
          slots: 4,
          generations: ['DDR5'],
          maxCapacityGb: 192,
          maxSpeedMt: 8000,
        },
        storageSlots: [{
          id: 1,
          key: 'm2-1',
          count: 1,
          interfaces: ['NVMe'],
          formFactors: ['2280'],
          pcieGeneration: 5,
        }],
        expansionSlots: [{
          id: 1,
          key: 'pcie-x16-1',
          count: 1,
          interfaceFamily: 'pcie',
          mechanicalLanes: 16,
          electricalLanes: 16,
          pcieGeneration: 5,
        }],
        powerConnectors: [
          { id: 1, kind: 'atx-main', connector: '24-pin ATX', count: 1, required: true },
          { id: 2, kind: 'cpu-eps', connector: '8-pin EPS', count: 2, required: true },
        ],
      },
    },
  },
  identityHash: '02c273147a8631c708a48b914f890ee3d744f9721eb36d55a9b4a760122648d5',
  contentHash: '7e36b05d2c840884e62478954664ba31687b17605398fe8ef57e2a02c3321066',
} as const

const FINGERPRINT_V8_RAM_VECTOR = {
  item: {
    type: 'ram',
    name: 'Samsung M471A2K43DB1-CWE',
    manufacturer: 'Samsung',
    family: 'Samsung DDR4',
    number: 'M471A2K43DB1-CWE',
    specs: {
      capacityGb: 16,
      generation: 'DDR4',
      speedMt: 3200,
      formFactor: 'SO-DIMM',
      moduleType: 'UDIMM',
      ecc: false,
      rank: '2Rx8',
      voltageVolts: 1.2,
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
  },
  identityHash: '82671223adf59660898f7b72eca2545bf594f0e12a6aca796043791dc0b6e947',
  contentHash: '5ccbe806d1d1ff63106dd1123079cc026a64661e06961ddbf888b3d7f631d7d3',
} as const

const FINGERPRINT_V9_CANONICAL_CPU_VECTOR = {
  item: {
    type: 'cpu',
    name: 'Intel Core i5-10500T',
    manufacturer: 'Intel',
    family: 'Core i5',
    model: 'i5-10500T',
    number: 'i5-10500T',
    specs: {
      cores: 6,
      threads: 12,
      socket: 'LGA1200',
      tdpMw: 35_000,
      generation: '10th Gen',
      baseClockMhz: 2_300,
      boostClockMhz: 3_800,
    },
    compatibility: {
      requirements: {
        cpu: { socket: 'LGA1200', tdpMw: 35_000, generation: '10th Gen' },
      },
    },
  },
  identityHash: '7824f7d31ca90f943af8a81427dadcd89ced2d82593fb201ba965c4f272892db',
  contentHash: '3e7e2b9873d1b9df474d51c14a4d376047fdf8cb8558c7645569d34768796b25',
} as const

const FINGERPRINT_V10_NAS_VECTOR = {
  item: {
    type: 'nas',
    name: 'Synology DS620slim',
    manufacturer: 'Synology',
    family: 'DiskStation',
    model: 'DS620slim',
    specs: {
      formFactor: 'Desktop',
      platformFamily: 'DSM',
      topologyCompleteness: 'complete',
      powerConfiguration: 'external-adapter',
    },
    fixedComponents: [{
      id: 1,
      componentType: 'cpu',
      disposition: 'soldered',
      label: 'Soldered processor',
      item: {
        type: 'cpu', name: 'Intel Celeron J3355', manufacturer: 'Intel', model: 'Celeron J3355', number: 'J3355',
        specs: { cores: 2, threads: 2, tdpMw: 10_000 },
      },
    }],
    ports: [{
      id: 1, key: 'lan-1', kind: 'network', type: 'rj45', slotNumber: 1,
      speedBps: 1_000_000_000, origin: 'fixed',
    }],
    compatibility: { host: {
      memory: {
        slots: 2, generations: ['DDR3L'], formFactors: ['SO-DIMM'], moduleTypes: ['UDIMM'], maxSpeedMt: 1866,
        oemMaxCapacityMib: 6144, verifiedMaxCapacityMib: 16_384,
        oemMaxModuleCapacityMib: 4096, verifiedMaxModuleCapacityMib: 8192,
      },
      storageSlots: [{
        id: 1, key: 'drive-bays', label: 'SATA drive bays', count: 6,
        interfaces: ['SATA'], formFactors: ['2.5-inch'], hotSwap: true,
      }],
      expansionSlots: [],
      optionalModuleSlots: [],
      power: {
        configuration: 'external-adapter', connector: '4-pin DIN',
        adapterDisposition: 'fixed', supportedPowerMw: [65_000], adapterRequired: true,
      },
      topologyCompleteness: 'complete',
    } },
  },
  identityHash: '73547318d3813c7e62ac4c80c5c48a928d75cec83e214e45f25142b2c70e1520',
  contentHash: '9c6b9f8f6c2d075387e413faeecd7ad35f9c29ec08ba3993b6735a6fa96d37c1',
} as const

const FINGERPRINT_V11_NETWORK_VECTORS = [{
  item: {
    type: 'network',
    name: 'Intel Ethernet Converged Network Adapter X710-DA2',
    manufacturer: 'Intel',
    family: 'Ethernet 700 Series',
    model: 'X710-DA2',
    specs: {
      networkTechnology: 'ethernet',
      controller: 'Intel X710',
      formFactor: 'low-profile',
      hostInterface: { family: 'pcie', pcieGeneration: 3, connectorLanes: 8, minimumElectricalLanes: 8 },
      maxSpeedBps: 10_000_000_000,
      operatingModes: ['ethernet'],
      capabilities: {
        sriov: true, ptp: true, pxe: true, uefiBoot: true, wakeOnLan: false,
        rdmaModes: [], offloads: ['checksum', 'rss'],
      },
      discontinued: false,
    },
    ports: [{
      id: 1, key: 'port-1', kind: 'network', type: 'sfp-plus', slotNumber: 1,
      speedBps: 10_000_000_000, supportedSpeedsBps: [1_000_000_000, 10_000_000_000],
      networkTechnology: 'ethernet', operatingModes: ['ethernet'],
      media: ['dac', 'optical-transceiver'], origin: 'module',
    }, {
      id: 2, key: 'port-2', kind: 'network', type: 'sfp-plus', slotNumber: 2,
      speedBps: 10_000_000_000, supportedSpeedsBps: [1_000_000_000, 10_000_000_000],
      networkTechnology: 'ethernet', operatingModes: ['ethernet'],
      media: ['dac', 'optical-transceiver'], origin: 'module',
    }],
    compatibility: { requirements: { expansion: {
      interfaceFamily: 'pcie', pcieGeneration: 3, connectorLanes: 8,
      minimumElectricalLanes: 8, height: 'low-profile', slotWidth: 1, powerMw: 7_000,
    } } },
  },
  identityHash: '4d31d779f7ac3e92193b85a4532c5eaea20c58273a86ed89aa649581c3488df4',
  contentHash: 'beae60950b946298b6125bec0c5d9a73d6b940b3b59979eb82f0a969d6c404c6',
}, {
  item: {
    type: 'network',
    name: 'Intel Wi-Fi 6E AX210',
    manufacturer: 'Intel',
    family: 'Intel Wi-Fi 6E',
    model: 'AX210.NGWG',
    specs: {
      networkTechnology: 'wifi',
      controller: 'Intel AX210',
      formFactor: 'm2-2230',
      hostInterface: { family: 'm2-ae', key: 'A+E', moduleSize: '2230' },
      operatingModes: ['wifi'],
      wifiGenerations: ['Wi-Fi 6', 'Wi-Fi 6E'],
      frequencyBandsGhz: [2.4, 5, 6],
      spatialStreams: 2,
      maxPhyRateBps: 2_400_000_000,
      bluetoothVersion: '5.3',
      antennaTopology: '2x2',
      discontinued: false,
    },
    compatibility: { requirements: { expansion: {
      interfaceFamily: 'm2-ae', key: 'A+E', moduleSize: '2230',
    } } },
  },
  identityHash: '57298d0705e4c642b57bb40085bef193330778396eb54b50934418e93c8762e9',
  contentHash: 'db577935d26e7625763b10dea3b701d0a8e258d82da9c66c2f486f8ca4dcf280',
}] as const

const FINGERPRINT_V12_M2_PHYSICAL_VECTORS = [{
  item: {
    type: 'desktop',
    name: 'Example Micro',
    manufacturer: 'Example',
    model: 'Micro',
    specs: { formFactor: 'Micro', topologyCompleteness: 'complete' },
    compatibility: { host: { optionalModuleSlots: [{
      id: 7,
      key: 'm2-ae-slot',
      keyAliases: ['wlan-m2'],
      count: 1,
      label: 'M.2 Key E slot',
      interfaceFamily: 'm2-ae',
      socketKeys: ['E'],
      moduleSizes: ['2230'],
      availableBuses: [
        { family: 'pcie', lanes: 1, pcieGeneration: 3 },
        { family: 'usb', usbGeneration: 'USB 2.0' },
      ],
      intendedModuleKinds: ['wireless-card'],
    }] } },
  },
  identityHash: '5072c6dbf960f23622cd63f22da2be0febc91652d415086d2b4f5731d7cb8503',
  contentHash: 'dfb2dacd5422e8cb272a758e7bfd9d291a03fa3f4fdda9a819cfb33bc8993ce0',
}, {
  item: {
    type: 'network',
    name: 'Example A+E Ethernet',
    manufacturer: 'Example',
    model: 'AE1000',
    specs: {
      networkTechnology: 'ethernet',
      formFactor: 'm2-2230',
      operatingModes: ['ethernet'],
      hostInterface: {
        family: 'm2-ae',
        key: 'A+E',
        moduleSize: '2230',
        requiredBuses: [{ family: 'pcie', minimumLanes: 1, minimumPcieGeneration: 2 }],
      },
    },
    ports: [{
      id: 1, key: 'port-1', kind: 'network', type: 'rj45', slotNumber: 1,
      speedBps: 1_000_000_000, supportedSpeedsBps: [1_000_000_000],
      networkTechnology: 'ethernet', operatingModes: ['ethernet'], origin: 'module',
    }],
    compatibility: { requirements: { expansion: {
      interfaceFamily: 'm2-ae', key: 'A+E', moduleSize: '2230',
      requiredBuses: [{ family: 'pcie', minimumLanes: 1, minimumPcieGeneration: 2 }],
    } } },
  },
  identityHash: '99a59a537a2044f494aa9423966f95034a272b1070a14f74b5da8c92c562b936',
  contentHash: '5b7ea6761cea4f1124b7aa0eff656168b61252b5ddf86e90d2c84d26e40b0d2f',
}] as const

export async function assertCatalogProtocolContract(): Promise<void> {
  if (FINGERPRINT_VERSION !== 3 || LEGACY_FINGERPRINT_VERSION !== 2
    || OEM_FINGERPRINT_VERSION !== 4 || WORKSTATION_FINGERPRINT_VERSION !== 5
    || SERVER_FINGERPRINT_VERSION !== 6 || MOTHERBOARD_FINGERPRINT_VERSION !== 7
    || RAM_FINGERPRINT_VERSION !== 8 || CANONICAL_UNITS_FINGERPRINT_VERSION !== 9
    || NAS_FINGERPRINT_VERSION !== 10 || NETWORK_FINGERPRINT_VERSION !== 11
    || M2_PHYSICAL_FINGERPRINT_VERSION !== 12) {
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

  const motherboardProjection = await digestCatalogTemplate(FINGERPRINT_V7_MOTHERBOARD_VECTOR.item, {
    fingerprintVersion: MOTHERBOARD_FINGERPRINT_VERSION,
  })
  if (
    motherboardProjection.identityHash !== FINGERPRINT_V7_MOTHERBOARD_VECTOR.identityHash
    || motherboardProjection.contentHash !== FINGERPRINT_V7_MOTHERBOARD_VECTOR.contentHash
  ) {
    throw new Error('Catalog fingerprint-v7 motherboard contract changed unexpectedly.')
  }

  const ramProjection = await digestCatalogTemplate(FINGERPRINT_V8_RAM_VECTOR.item, {
    fingerprintVersion: RAM_FINGERPRINT_VERSION,
  })
  if (
    ramProjection.identityHash !== FINGERPRINT_V8_RAM_VECTOR.identityHash
    || ramProjection.contentHash !== FINGERPRINT_V8_RAM_VECTOR.contentHash
  ) {
    throw new Error('Catalog fingerprint-v8 RAM contract changed unexpectedly.')
  }

  const canonicalUnitsProjection = await digestCatalogTemplate(FINGERPRINT_V9_CANONICAL_CPU_VECTOR.item, {
    fingerprintVersion: CANONICAL_UNITS_FINGERPRINT_VERSION,
  })
  if (
    canonicalUnitsProjection.identityHash !== FINGERPRINT_V9_CANONICAL_CPU_VECTOR.identityHash
    || canonicalUnitsProjection.contentHash !== FINGERPRINT_V9_CANONICAL_CPU_VECTOR.contentHash
  ) {
    throw new Error('Catalog fingerprint-v9 canonical-unit contract changed unexpectedly.')
  }

  const nasProjection = await digestCatalogTemplate(FINGERPRINT_V10_NAS_VECTOR.item, {
    fingerprintVersion: NAS_FINGERPRINT_VERSION,
  })
  if (
    nasProjection.identityHash !== FINGERPRINT_V10_NAS_VECTOR.identityHash
    || nasProjection.contentHash !== FINGERPRINT_V10_NAS_VECTOR.contentHash
  ) {
    throw new Error('Catalog fingerprint-v10 NAS contract changed unexpectedly.')
  }

  for (const vector of FINGERPRINT_V11_NETWORK_VECTORS) {
    const networkProjection = await digestCatalogTemplate(vector.item, {
      fingerprintVersion: NETWORK_FINGERPRINT_VERSION,
    })
    if (
      networkProjection.identityHash !== vector.identityHash
      || networkProjection.contentHash !== vector.contentHash
    ) {
      throw new Error('Catalog fingerprint-v11 network contract changed unexpectedly.')
    }
  }

  for (const vector of FINGERPRINT_V12_M2_PHYSICAL_VECTORS) {
    const projection = await digestCatalogTemplate(vector.item, {
      fingerprintVersion: M2_PHYSICAL_FINGERPRINT_VERSION,
    })
    if (
      projection.identityHash !== vector.identityHash
      || projection.contentHash !== vector.contentHash
    ) {
      throw new Error('Catalog fingerprint-v12 physical M.2 contract changed unexpectedly.')
    }
  }
}
