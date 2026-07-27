import { describe, expect, it } from 'vitest'
import vectors from './vectors/canonical-items.json'
import {
  canonicalJson,
  computeCatalogDigests,
  normalizeManufacturer,
  sanitizeCatalogItem,
} from '../src'

describe('catalog protocol normalization', () => {
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
