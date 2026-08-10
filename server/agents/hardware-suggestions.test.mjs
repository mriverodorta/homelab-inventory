import { describe, expect, it } from 'vitest'
import { buildHardwareSuggestions } from './hardware-suggestions.mjs'

describe('hardware suggestions', () => {
  it('interprets storage vendor aliases while keeping serial evidence local', () => {
    const result = buildHardwareSuggestions({
      snapshot: {
        id: 10, host: { type: 'server', id: 7 }, collectedAt: '2026-08-09T00:00:00Z', receivedAt: '2026-08-09T00:00:00Z',
        components: [{ kind: 'storage', locator: '/dev/nvme0n1', values: {
          model: 'SPCC M.2 PCIe SSD', serial: 'PRIVATE-SERIAL', size: 1024209543168, tran: 'nvme', pttype: 'gpt',
        } }],
      },
      inventory: { storage: [{ id: 9, name: '1TB NVMe' }] },
      project: { assignments: [{ id: 1, hostType: 'server', hostId: 7, itemType: 'storage', itemId: 9 }] },
      now: Date.parse('2026-08-09T00:01:00Z'),
    })
    expect(result.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldPath: 'manufacturer', detectedValue: 'Silicon Power' }),
      expect.objectContaining({ fieldPath: 'specs.serialNumber', detectedValue: 'PRIVATE-SERIAL' }),
      expect.objectContaining({ fieldPath: 'specs.partitionTable', detectedValue: 'gpt' }),
    ]))
  })
  it('matches assigned components by physical order without crossing hosts', () => {
    const snapshot = {
      id: 4,
      host: { type: 'server', id: 1 },
      collectedAt: '2026-08-05T12:00:00.000Z',
      receivedAt: '2026-08-05T12:00:01.000Z',
      components: [
        { kind: 'memory', locator: 'DIMM_A1', values: { manufacturer: 'Micron', opaqueFingerprint: 'one' } },
        { kind: 'memory', locator: 'DIMM_B1', values: { manufacturer: 'Samsung', opaqueFingerprint: 'two' } },
      ],
    }
    const result = buildHardwareSuggestions({
      snapshot,
      inventory: { ram: [{ id: 1, name: 'Stick 1' }, { id: 2, name: 'Stick 2' }, { id: 3, name: 'Other host' }] },
      project: { assignments: [
        { id: 1, hostType: 'server', hostId: 1, itemType: 'ram', itemId: 1, allocation: { positions: [0] } },
        { id: 2, hostType: 'server', hostId: 1, itemType: 'ram', itemId: 2, allocation: { positions: [1] } },
        { id: 3, hostType: 'server', hostId: 2, itemType: 'ram', itemId: 3, allocation: { positions: [0] } },
      ] },
      now: Date.parse('2026-08-05T12:05:00.000Z'),
    })
    expect(result.suggestions.map((suggestion) => [suggestion.target.itemId, suggestion.detectedValue])).toEqual([[1, 'Micron'], [2, 'Samsung']])
    expect(result.matches.every((match) => match.method === 'one-to-one-position')).toBe(true)
    expect(result.stale).toBe(false)
  })

  it('naturally maps reversed DIMM evidence to numeric RAM positions and resolves JEDEC manufacturers', () => {
    const result = buildHardwareSuggestions({
      snapshot: {
        id: 8,
        host: { type: 'server', id: 7 },
        collectedAt: '2026-08-08T12:00:00.000Z',
        receivedAt: '2026-08-08T12:00:01.000Z',
        components: [
          {
            kind: 'memory',
            locator: 'DIMM2',
            values: {
              manufacturer: '85F700000000', moduleManufacturerId: 'Bank 6, Hex 0xF7',
              partNumber: 'J641GU49J2320NE', opaqueFingerprint: 'dimm-two',
            },
          },
          {
            kind: 'memory',
            locator: 'DIMM1',
            values: {
              manufacturer: '85F700000000', moduleManufacturerId: 'Bank 6, Hex 0xF7',
              partNumber: 'J641GU49J2320NE', opaqueFingerprint: 'dimm-one',
            },
          },
        ],
      },
      inventory: { ram: [{ id: 2, name: 'RAM slot 0' }, { id: 23, name: 'RAM slot 1' }] },
      project: { assignments: [
        { id: 4, hostType: 'server', hostId: 7, itemType: 'ram', itemId: 2, allocation: { positions: [0] } },
        { id: 100, hostType: 'server', hostId: 7, itemType: 'ram', itemId: 23, allocation: { positions: [1] } },
      ] },
      now: Date.parse('2026-08-08T12:05:00.000Z'),
    })

    expect(result.matches).toEqual([
      expect.objectContaining({ component: { kind: 'memory', locator: 'DIMM1' }, target: { itemType: 'ram', itemId: 2 } }),
      expect.objectContaining({ component: { kind: 'memory', locator: 'DIMM2' }, target: { itemType: 'ram', itemId: 23 } }),
    ])
    expect(result.suggestions.filter(({ fieldPath }) => fieldPath === 'manufacturer')).toEqual([
      expect.objectContaining({ target: { itemType: 'ram', itemId: 2 }, detectedValue: 'Avant Technology', source: expect.objectContaining({ locator: 'DIMM1' }) }),
      expect.objectContaining({ target: { itemType: 'ram', itemId: 23 }, detectedValue: 'Avant Technology', source: expect.objectContaining({ locator: 'DIMM2' }) }),
    ])
    expect(result.suggestions.filter(({ fieldPath }) => fieldPath === 'number')).toEqual([
      expect.objectContaining({ target: { itemType: 'ram', itemId: 2 }, detectedValue: 'J641GU49J2320NE' }),
      expect.objectContaining({ target: { itemType: 'ram', itemId: 23 }, detectedValue: 'J641GU49J2320NE' }),
    ])
  })

  it('does not suggest an opaque manufacturer when its JEDEC ID is unknown', () => {
    const result = buildHardwareSuggestions({
      snapshot: {
        id: 9, host: { type: 'server', id: 1 }, collectedAt: '2026-08-08T00:00:00Z', receivedAt: '2026-08-08T00:00:00Z',
        components: [{
          kind: 'memory', locator: 'DIMM1',
          values: { manufacturer: '001122334455', moduleManufacturerId: 'Bank 99, Hex 0xF7', partNumber: 'KNOWN-PART' },
        }],
      },
      inventory: { ram: [{ id: 1, name: 'RAM' }] },
      project: { assignments: [{ id: 1, hostType: 'server', hostId: 1, itemType: 'ram', itemId: 1, allocation: { positions: [0] } }] },
      now: Date.parse('2026-08-08T00:01:00Z'),
    })

    expect(result.suggestions.some(({ fieldPath }) => fieldPath === 'manufacturer')).toBe(false)
    expect(result.suggestions).toContainEqual(expect.objectContaining({ fieldPath: 'number', detectedValue: 'KNOWN-PART' }))
  })

  it('normalizes SMBIOS memory evidence into RAM v8 suggestions', () => {
    const result = buildHardwareSuggestions({
      snapshot: {
        id: 11, host: { type: 'server', id: 1 }, collectedAt: '2026-08-10T00:00:00Z', receivedAt: '2026-08-10T00:00:00Z',
        components: [{ kind: 'memory', locator: 'DIMM1', values: {
          manufacturer: 'Micron', partNumber: 'MTA18ASF2G72AZ-3G2R', size: '16 GB', type: 'DDR4',
          speed: '3200 MT/s', configuredMemorySpeed: '2933 MT/s', formFactor: 'DIMM',
          typeDetail: 'Synchronous Registered (Buffered)', totalWidth: '72 bits', dataWidth: '64 bits',
          rank: '2Rx8', configuredVoltage: '1.2 V',
        } }],
      },
      inventory: { ram: [{ id: 1, name: 'RAM' }] },
      project: { assignments: [{ id: 1, hostType: 'server', hostId: 1, itemType: 'ram', itemId: 1, allocation: { positions: [0] } }] },
      now: Date.parse('2026-08-10T00:01:00Z'),
    })

    expect(result.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldPath: 'number', detectedValue: 'MTA18ASF2G72AZ-3G2R' }),
      expect.objectContaining({ fieldPath: 'specs.capacityGb', detectedValue: 16 }),
      expect.objectContaining({ fieldPath: 'specs.generation', detectedValue: 'DDR4' }),
      expect.objectContaining({ fieldPath: 'specs.speedMt', detectedValue: 3200 }),
      expect.objectContaining({ fieldPath: 'specs.formFactor', detectedValue: 'DIMM' }),
      expect.objectContaining({ fieldPath: 'specs.moduleType', detectedValue: 'RDIMM' }),
      expect.objectContaining({ fieldPath: 'specs.ecc', detectedValue: true }),
      expect.objectContaining({ fieldPath: 'specs.rank', detectedValue: '2Rx8' }),
      expect.objectContaining({ fieldPath: 'specs.voltageVolts', detectedValue: 1.2 }),
    ]))
  })

  it('does not infer a rank organization from a numeric SMBIOS rank', () => {
    const result = buildHardwareSuggestions({
      snapshot: {
        id: 12, host: { type: 'server', id: 1 }, collectedAt: '2026-08-10T00:00:00Z', receivedAt: '2026-08-10T00:00:00Z',
        components: [{ kind: 'memory', locator: 'DIMM1', values: { manufacturer: 'Micron', partNumber: 'PART-1', rank: '2' } }],
      },
      inventory: { ram: [{ id: 1, name: 'RAM' }] },
      project: { assignments: [{ id: 1, hostType: 'server', hostId: 1, itemType: 'ram', itemId: 1, allocation: { positions: [0] } }] },
      now: Date.parse('2026-08-10T00:01:00Z'),
    })

    expect(result.suggestions.some(({ fieldPath }) => fieldPath === 'specs.rank')).toBe(false)
  })

  it('does not guess when detected and assigned component counts are ambiguous', () => {
    const result = buildHardwareSuggestions({
      snapshot: {
        id: 1, host: { type: 'server', id: 1 }, collectedAt: '2026-08-05T00:00:00Z', receivedAt: '2026-08-05T00:00:00Z',
        components: [{ kind: 'cpu', locator: 'CPU1', values: { version: 'Detected CPU' } }],
      },
      inventory: { cpus: [{ id: 1, name: 'One' }, { id: 2, name: 'Two' }] },
      project: { assignments: [
        { id: 1, hostType: 'server', hostId: 1, itemType: 'cpu', itemId: 1, allocation: { positions: [0] } },
        { id: 2, hostType: 'server', hostId: 1, itemType: 'cpu', itemId: 2, allocation: { positions: [1] } },
      ] },
      now: Date.parse('2026-09-10T00:00:00Z'),
    })
    expect(result.suggestions).toEqual([])
    expect(result.matches[0]).toMatchObject({ target: null, method: 'ambiguous', confidence: 'none' })
    expect(result.stale).toBe(true)
  })
})
