import { describe, expect, it } from 'vitest'
import vectors from './vectors/canonical-items.json'
import {
  CPU_SPEC_KEYS,
  MOTHERBOARD_FINGERPRINT_VERSION,
  RAM_FINGERPRINT_VERSION,
  SERVER_FINGERPRINT_VERSION,
  SUPPORTED_FINGERPRINT_VERSIONS,
  canonicalJson,
  computeCatalogDigests,
  digestCatalogTemplate,
  normalizeManufacturer,
  sanitizeCatalogItem,
} from '../src'

describe('catalog protocol normalization', () => {
  it('supports immutable protocol versions through canonical units v9', () => {
    expect(SERVER_FINGERPRINT_VERSION).toBe(6)
    expect(MOTHERBOARD_FINGERPRINT_VERSION).toBe(7)
    expect(RAM_FINGERPRINT_VERSION).toBe(8)
    expect(SUPPORTED_FINGERPRINT_VERSIONS).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('normalizes controlled manufacturer aliases', () => {
    expect(normalizeManufacturer(' Hewlett-Packard ')).toBe('hp')
    expect(normalizeManufacturer('INTEL Corporation')).toBe('intel')
  })

  it.each(vectors)('produces equivalent digests for $name', async ({ left, right }) => {
    expect(await computeCatalogDigests(left)).toEqual(await computeCatalogDigests(right))
  })

  it('sorts objects and semantic arrays deterministically', () => {
    expect(canonicalJson({ z: ['B', 'a'], a: { y: 2, x: 1 } }))
      .toBe(canonicalJson({ a: { x: 1, y: 2 }, z: ['a', 'b'] }))
  })
})

describe('catalog protocol sanitizer', () => {
  it('preserves the canonical official CPU catalog fields', async () => {
    expect(CPU_SPEC_KEYS).toEqual([
      'socket', 'cores', 'threads', 'baseClockGhz', 'boostClockGhz',
      'tdpWatts', 'channels', 'generation', 'cacheMb', 'memoryTypes',
      'memorySpeedsMt', 'eccSupport', 'integratedGraphics', 'pcieGeneration',
      'pcieLanes', 'maxTemperatureC', 'launchDate', 'discontinued',
      'performanceCores', 'efficiencyCores', 'configurableTdpMinWatts',
      'configurableTdpMaxWatts', 'baseClockMhz', 'boostClockMhz', 'tdpMw',
      'cacheMib', 'maxTemperatureMilliCelsius', 'configurableTdpMinMw',
      'configurableTdpMaxMw',
    ])

    const item = {
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
    }

    const first = await digestCatalogTemplate(item)
    const second = await digestCatalogTemplate(structuredClone(item))
    expect(first).toEqual(second)
    expect(first.item).toEqual(item)
  })

  it('removes instance-owned and secret-adjacent fields', () => {
    const item = sanitizeCatalogItem({
      id: 44,
      key: 'server:44',
      type: 'server',
      name: 'Dell OptiPlex 7090',
      manufacturer: 'Dell',
      properties: { lanIp: '192.168.1.12', tailscaleIp: '100.64.0.1' },
      notes: 'rack location',
      specs: {
        formFactor: 'Micro',
        serialNumber: 'ABC-SECRET-123',
        operatingSystem: 'Internal service host',
        managementIp: '10.0.0.4',
      },
      compatibility: {
        host: { cpu: { sockets: ['LGA1200'] } },
        agent: { token: 'secret-token' },
        topology: { host: 'private-host' },
      },
      smart: { enabled: true, managementIp: '10.0.0.1', macAddress: 'aa:bb' },
      assignments: [{ itemId: 'cpu:1' }],
      connections: [{ id: 1 }],
      ports: [{
        id: 1,
        kind: 'server-port',
        type: 'rj45',
        slotNumber: 1,
        speed: '1G',
        label: 'LAN to office',
        notes: 'private',
        ipAddress: '192.168.1.12',
      }],
    })

    expect(item).toEqual({
      type: 'server',
      name: 'Dell OptiPlex 7090',
      manufacturer: 'Dell',
      specs: { formFactor: 'Micro' },
      ports: [{ id: 1, kind: 'server-port', type: 'rj45', slotNumber: 1, speed: '1G' }],
      compatibility: { host: { cpu: { sockets: ['LGA1200'] } } },
    })
    expect(JSON.stringify(item)).not.toMatch(/192\.168|10\.0\.0|tailscale|macAddress|rack location|ABC-SECRET|Internal service|secret-token|private-host/i)
  })

  it('preserves only canonical OEM port and compatibility fields', () => {
    const item = sanitizeCatalogItem({
      type: 'desktop',
      name: 'OEM platform',
      manufacturer: 'Example',
      model: 'Mini 1',
      ports: [
        { id: 1, kind: 'network', type: 'rj45', slotNumber: 1, origin: 'fixed' },
        { id: 2, kind: 'video', type: 'displayport', slotNumber: 2, origin: 'module' },
        { id: 3, kind: 'video', type: 'hdmi', slotNumber: 3, origin: 'installed' },
      ],
      compatibility: {
        host: {
          memory: { slots: 2, eccSupport: 'unsupported' },
          optionalModuleSlots: [{
            id: 1,
            key: 'rear-flex-io',
            count: 1,
            acceptedModuleKinds: ['displayport', 'hdmi'],
          }],
          power: {
            configuration: 'external-adapter',
            connector: 'barrel',
            supportedWattagesWatts: [65, 90],
            adapterRequired: true,
            adapterType: 'OEM external adapter',
          },
        },
      },
    })

    expect(item.ports).toEqual([
      { id: 1, kind: 'network', type: 'rj45', slotNumber: 1, origin: 'fixed' },
      { id: 2, kind: 'video', type: 'displayport', slotNumber: 2, origin: 'module' },
      { id: 3, kind: 'video', type: 'hdmi', slotNumber: 3 },
    ])
    expect(item.compatibility).toEqual({
      host: {
        memory: { slots: 2, eccSupport: 'unsupported' },
        optionalModuleSlots: [{
          id: 1,
          key: 'rear-flex-io',
          count: 1,
          acceptedModuleKinds: ['displayport', 'hdmi'],
        }],
        power: {
          configuration: 'external-adapter',
          connector: 'barrel',
          supportedWattagesWatts: [65, 90],
          adapterRequired: true,
          adapterType: 'OEM external adapter',
        },
      },
    })
  })

  it('preserves public motherboard aliases and power compatibility fields', () => {
    const item = sanitizeCatalogItem({
      type: 'motherboard',
      name: 'ASUS ROG Strix B650E-F Gaming WiFi',
      manufacturer: 'ASUS',
      model: 'ROG Strix B650E-F Gaming WiFi',
      aliases: ['ROG STRIX B650E-F GAMING WIFI', '  B650E-F Gaming WiFi  ', '', '10.0.0.4'],
      compatibility: {
        host: {
          powerConnectors: [
            { id: 1, kind: 'atx-main', connector: '24-pin ATX', count: 1, required: true },
            { id: 2, kind: 'cpu-eps', connector: '8-pin EPS', count: 2, required: true },
          ],
        },
      },
    })

    expect(item.aliases).toEqual(['ROG STRIX B650E-F GAMING WIFI', 'B650E-F Gaming WiFi'])
    expect(item.compatibility).toEqual({
      host: {
        powerConnectors: [
          { id: 1, kind: 'atx-main', connector: '24-pin ATX', count: 1, required: true },
          { id: 2, kind: 'cpu-eps', connector: '8-pin EPS', count: 2, required: true },
        ],
      },
    })
  })

  it('preserves canonical RAM v8 specifications and structured requirements', () => {
    const item = sanitizeCatalogItem({
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
        privateLabel: 'rack module',
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
            serialNumber: 'private',
          },
        },
      },
    })

    expect(item.specs).toEqual({
      capacityGb: 16,
      generation: 'DDR4',
      speedMt: 3200,
      formFactor: 'SO-DIMM',
      moduleType: 'UDIMM',
      ecc: false,
      rank: '2Rx8',
      voltageVolts: 1.2,
    })
    expect(item.compatibility).toEqual({
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
    })
  })

  it('preserves canonical conventional-server topology while stripping private fields', () => {
    const item = sanitizeCatalogItem({
      type: 'server',
      name: 'Example Rack Server',
      manufacturer: 'Example',
      model: 'R200',
      specs: {
        formFactor: 'Rack Server',
        rackUnits: 2,
        oemGeneration: '2nd Gen',
        serialNumber: 'PRIVATE-SERIAL',
      },
      compatibility: {
        host: {
          cpu: {
            sockets: ['LGA 4677'],
            generations: ['Xeon Scalable 4th Gen'],
            maxTdpWatts: 350,
            socketCount: 2,
            populationModes: [1, 2],
          },
          memory: {
            slots: 32,
            slotsPerCpu: 16,
            generations: ['DDR5'],
            moduleTypes: ['RDIMM'],
          },
          storageSlots: [{
            id: 1,
            key: 'front-sff',
            label: 'Front bays',
            count: 8,
            interfaces: ['SAS'],
            formFactors: ['2.5 inch'],
            controllerSlotIds: [1],
            directConnect: false,
          }],
          expansionSlots: [{
            id: 1,
            key: 'riser-slot',
            label: 'Riser slot',
            count: 1,
            interfaceFamily: 'PCI Express',
            requiredCpuSockets: 2,
            riserGroup: 'riser-1',
          }],
          optionalModuleSlots: [],
          controllerSlots: [{
            id: 1,
            key: 'raid-slot',
            label: 'RAID controller slot',
            count: 1,
            acceptedControllerKinds: ['raid-controller'],
            dedicated: true,
          }],
          bootDeviceSlots: [],
          power: {
            configuration: 'internal-psu',
            connector: 'IEC C14',
            supportedWattagesWatts: [800],
            adapterRequired: false,
            redundancy: 'optional',
            psuBayCount: 2,
            psuType: 'hot-plug',
            mixedPsuAllowed: false,
            redundancyModes: ['1+1'],
          },
          coolingProfiles: [{
            id: 1,
            key: 'standard-fans',
            label: 'Standard fans',
            fanCount: 6,
            redundant: true,
            conditions: ['standard configuration'],
          }],
          management: {
            controllerFamily: 'BMC',
            controllerGeneration: '2',
            dedicatedPort: true,
            sharedNic: true,
            portType: 'RJ45',
            speed: '1 Gbps',
            managementIp: '192.168.1.2',
          },
        },
      },
    })

    expect(item.specs).toEqual({ formFactor: 'Rack Server', rackUnits: 2, oemGeneration: '2nd Gen' })
    expect(item.compatibility?.host).toEqual({
      cpu: {
        sockets: ['LGA 4677'],
        generations: ['Xeon Scalable 4th Gen'],
        maxTdpWatts: 350,
        socketCount: 2,
        populationModes: [1, 2],
      },
      memory: {
        slots: 32,
        slotsPerCpu: 16,
        generations: ['DDR5'],
        moduleTypes: ['RDIMM'],
      },
      storageSlots: [{
        id: 1,
        key: 'front-sff',
        label: 'Front bays',
        count: 8,
        interfaces: ['SAS'],
        formFactors: ['2.5 inch'],
        controllerSlotIds: [1],
        directConnect: false,
      }],
      expansionSlots: [{
        id: 1,
        key: 'riser-slot',
        label: 'Riser slot',
        count: 1,
        interfaceFamily: 'PCI Express',
        requiredCpuSockets: 2,
        riserGroup: 'riser-1',
      }],
      optionalModuleSlots: [],
      controllerSlots: [{
        id: 1,
        key: 'raid-slot',
        label: 'RAID controller slot',
        count: 1,
        acceptedControllerKinds: ['raid-controller'],
        dedicated: true,
      }],
      bootDeviceSlots: [],
      power: {
        configuration: 'internal-psu',
        connector: 'IEC C14',
        supportedWattagesWatts: [800],
        adapterRequired: false,
        redundancy: 'optional',
        psuBayCount: 2,
        psuType: 'hot-plug',
        mixedPsuAllowed: false,
        redundancyModes: ['1+1'],
      },
      coolingProfiles: [{
        id: 1,
        key: 'standard-fans',
        label: 'Standard fans',
        fanCount: 6,
        redundant: true,
        conditions: ['standard configuration'],
      }],
      management: {
        controllerFamily: 'BMC',
        controllerGeneration: '2',
        dedicatedPort: true,
        sharedNic: true,
        portType: 'RJ45',
        speed: '1 Gbps',
      },
    })
    expect(JSON.stringify(item)).not.toMatch(/PRIVATE-SERIAL|192\.168\.1\.2|managementIp/)
  })

  it('uses identity and content hashes for different purposes', async () => {
    const left = await computeCatalogDigests({
      type: 'ram', name: '32GB DDR4', manufacturer: 'Crucial', model: 'CT2K16G4', specs: { capacityGB: 32 },
    })
    const right = await computeCatalogDigests({
      type: 'ram', name: '32GB DDR4', manufacturer: 'Crucial', model: 'CT2K16G4', specs: { capacityGB: 64 },
    })
    expect(left.identityHash).toBe(right.identityHash)
    expect(left.contentHash).not.toBe(right.contentHash)
  })
})
