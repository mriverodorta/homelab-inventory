import { describe, expect, it } from 'vitest'
import { buildHardwareSuggestions } from './hardware-suggestions.mjs'

describe('hardware suggestions', () => {
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
