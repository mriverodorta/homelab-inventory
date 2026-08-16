import { describe, expect, it } from 'vitest'
import {
  NETWORK_FINGERPRINT_VERSION,
  canonicalizeCatalogItemV11,
  digestCatalogTemplate,
} from '../src'

import fixture from './fixtures/network/server-specs-inventory-network-v11.json'

const x710da2 = {
  type: 'network',
  name: 'Intel Ethernet Converged Network Adapter X710-DA2',
  manufacturer: 'Intel',
  family: 'Ethernet 700 Series',
  model: 'X710-DA2',
  specs: {
    networkTechnology: 'ethernet',
    controller: 'Intel X710',
    formFactor: 'low-profile',
    hostInterface: {
      family: 'pcie', pcieGeneration: 3, connectorLanes: 8, minimumElectricalLanes: 8,
    },
    maxSpeedBps: 10_000_000_000,
    operatingModes: ['ethernet'],
    capabilities: {
      sriov: true, ptp: true, pxe: true, uefiBoot: true, wakeOnLan: false,
      rdmaModes: [], offloads: ['rss', 'checksum', 'rss'],
    },
    discontinued: false,
  },
  ports: [{
    id: 1, key: 'port-1', kind: 'network', type: 'sfp-plus', slotNumber: 1,
    speedBps: 10_000_000_000,
    supportedSpeedsBps: [10_000_000_000, 1_000_000_000, 10_000_000_000],
    networkTechnology: 'ethernet', operatingModes: ['ethernet'],
    media: ['optical-transceiver', 'dac', 'dac'], origin: 'module',
  }, {
    id: 2, key: 'port-2', kind: 'network', type: 'sfp-plus', slotNumber: 2,
    speedBps: 10_000_000_000,
    supportedSpeedsBps: [1_000_000_000, 10_000_000_000],
    networkTechnology: 'ethernet', operatingModes: ['ethernet'],
    media: ['dac', 'optical-transceiver'], origin: 'module',
  }],
  compatibility: { requirements: { expansion: {
    interfaceFamily: 'pcie', pcieGeneration: 3, connectorLanes: 8,
    minimumElectricalLanes: 8, height: 'low-profile', slotWidth: 1, powerMw: 7_000,
  } } },
} as const

const ax210 = {
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
    wifiGenerations: ['Wi-Fi 6E', 'Wi-Fi 6'],
    frequencyBandsGhz: [6, 2.4, 5],
    spatialStreams: 2,
    maxPhyRateBps: 2_400_000_000,
    bluetoothVersion: '5.3',
    antennaTopology: '2x2',
    discontinued: false,
  },
  compatibility: { requirements: { expansion: {
    interfaceFamily: 'm2-ae', key: 'A+E', moduleSize: '2230',
  } } },
} as const

describe('network catalog protocol v11', () => {
  it('consumes the frozen registry fixture without changing its contract hashes', async () => {
    expect(fixture).toMatchObject({
      requiredApplicationCatalogContractVersion: 11,
      fingerprintVersion: NETWORK_FINGERPRINT_VERSION,
    })
    for (const template of fixture.templates) {
      const digest = await digestCatalogTemplate(template.item, {
        fingerprintVersion: NETWORK_FINGERPRINT_VERSION,
      })
      expect(digest).toMatchObject({
        status: 'eligible',
        identityHash: template.identityHash,
        contentHash: template.contentHash,
        item: template.item,
      })
    }
  })

  it('canonicalizes multiport Ethernet topology and set-like values', () => {
    const item = canonicalizeCatalogItemV11(x710da2)
    expect(item.specs).toMatchObject({
      networkTechnology: 'ethernet', maxSpeedBps: 10_000_000_000,
      capabilities: { offloads: ['checksum', 'rss'] },
    })
    expect(item.ports?.[0]).toMatchObject({
      kind: 'network', slotNumber: 1, speedBps: 10_000_000_000,
      supportedSpeedsBps: [1_000_000_000, 10_000_000_000],
      media: ['dac', 'optical-transceiver'], origin: 'module',
    })
  })

  it('canonicalizes radio-only adapters without cable endpoints', () => {
    const item = canonicalizeCatalogItemV11(ax210)
    expect(item.ports).toBeUndefined()
    expect(item.specs).toMatchObject({
      networkTechnology: 'wifi', maxPhyRateBps: 2_400_000_000,
      frequencyBandsGhz: [2.4, 5, 6], wifiGenerations: ['Wi-Fi 6', 'Wi-Fi 6E'],
    })
  })

  it('rejects invalid endpoints, speed sets, connectors, and host-interface fields', () => {
    const invalidSlot = structuredClone(x710da2) as any
    invalidSlot.ports[0].slotNumber = 0
    expect(() => canonicalizeCatalogItemV11(invalidSlot)).toThrow(/slotNumber.*positive/i)

    const invalidSpeed = structuredClone(x710da2) as any
    invalidSpeed.ports[0].supportedSpeedsBps = [25_000_000_000]
    expect(() => canonicalizeCatalogItemV11(invalidSpeed)).toThrow(/supportedSpeedsBps/i)

    const invalidConnector = structuredClone(x710da2) as any
    invalidConnector.ports[0].type = 'fibre-channel-port'
    expect(() => canonicalizeCatalogItemV11(invalidConnector)).toThrow(/connector/i)

    const invalidInterface = structuredClone(x710da2) as any
    invalidInterface.specs.hostInterface.usbGeneration = 'USB 3.2 Gen 2'
    expect(() => canonicalizeCatalogItemV11(invalidInterface)).toThrow(/hostInterface/i)

    const radioEndpoint = { ...ax210, ports: [x710da2.ports[0]] }
    expect(() => canonicalizeCatalogItemV11(radioEndpoint)).toThrow(/radio-only/i)
  })

  it('uses material topology for identity and speeds or capabilities for content', async () => {
    const base = await digestCatalogTemplate(x710da2, { fingerprintVersion: NETWORK_FINGERPRINT_VERSION })
    const speedCorrection = structuredClone(x710da2) as any
    speedCorrection.ports[0].supportedSpeedsBps = [10_000_000_000]
    const speed = await digestCatalogTemplate(speedCorrection, { fingerprintVersion: NETWORK_FINGERPRINT_VERSION })
    const connectorChange = structuredClone(x710da2) as any
    connectorChange.ports[0].type = 'sfp28'
    const connector = await digestCatalogTemplate(connectorChange, { fingerprintVersion: NETWORK_FINGERPRINT_VERSION })
    const alias = await digestCatalogTemplate({ ...x710da2, aliases: ['X710 DA2'] }, {
      fingerprintVersion: NETWORK_FINGERPRINT_VERSION,
    })

    expect(base.fingerprintVersion).toBe(11)
    expect(speed.identityHash).toBe(base.identityHash)
    expect(speed.contentHash).not.toBe(base.contentHash)
    expect(connector.identityHash).not.toBe(base.identityHash)
    expect(alias.identityHash).toBe(base.identityHash)
    expect(alias.contentHash).toBe(base.contentHash)
  })

  it('is deterministic and idempotent', async () => {
    const once = canonicalizeCatalogItemV11(x710da2)
    expect(canonicalizeCatalogItemV11(once)).toEqual(once)
    const first = await digestCatalogTemplate(x710da2, { fingerprintVersion: NETWORK_FINGERPRINT_VERSION })
    const second = await digestCatalogTemplate(once, { fingerprintVersion: NETWORK_FINGERPRINT_VERSION })
    expect(second.identityHash).toBe(first.identityHash)
    expect(second.contentHash).toBe(first.contentHash)
  })
})
