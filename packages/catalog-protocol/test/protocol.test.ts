import { describe, expect, it } from 'vitest'
import vectors from './vectors/canonical-items.json'
import {
  CPU_SPEC_KEYS,
  activationSignaturePayload,
  canonicalJson,
  computeCatalogDigests,
  digestCatalogTemplate,
  normalizeManufacturer,
  sanitizeCatalogItem,
} from '../src'

describe('catalog protocol normalization', () => {
  it('preserves legacy activation signature bytes while binding stable installation UUIDs', () => {
    const challenge = {
      challengeKey: '11111111-1111-4111-8111-111111111111',
      nonce: 'abc',
      publicKeyId: 'def',
      publicKey: 'ghi',
      expiresAt: '2026-01-01T00:00:00.000Z',
    }
    expect(activationSignaturePayload(challenge)).toBe('{"challengekey":"11111111-1111-4111-8111-111111111111","expiresat":"2026-01-01t00:00:00.000z","nonce":"abc","protocol":"hli-contribution-v1","publickey":"ghi","publickeyid":"def","purpose":"installation-activation"}')
    expect(activationSignaturePayload({ ...challenge, clientInstanceId: '22222222-2222-4222-8222-222222222222' }))
      .toContain('"clientinstanceid":"22222222-2222-4222-8222-222222222222"')
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
      'configurableTdpMaxWatts',
    ])

    const item = {
      type: 'cpu',
      name: 'AMD Ryzen 9 7950X',
      manufacturer: 'AMD',
      family: 'Ryzen 9',
      model: '7950X',
      number: '7950X',
      specs: {
        socket: 'AM5', cores: 16, threads: 32, baseClockGhz: 4.5, boostClockGhz: 5.7,
        tdpWatts: 170, channels: 2, generation: 'Zen 4', cacheMb: 80, memoryTypes: 'DDR5',
        memorySpeedsMt: '5200, 3600', eccSupport: true, integratedGraphics: 'AMD Radeon Graphics',
        pcieGeneration: 5, pcieLanes: 24, maxTemperatureC: 95, launchDate: '2022-09-27',
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
