import { describe, expect, it } from 'vitest'

import { canonicalShareJson, shareContentHash } from '../src'

describe('canonical share JSON', () => {
  it('sorts object keys recursively while preserving array order', () => {
    expect(canonicalShareJson({ b: 2, a: { d: 4, c: [2, 1] } }))
      .toBe('{"a":{"c":[2,1],"d":4},"b":2}')
  })

  it('omits undefined object properties', () => {
    expect(canonicalShareJson({ value: undefined })).toBe('{}')
  })

  it('rejects non-finite and unsupported values', () => {
    expect(() => canonicalShareJson({ value: Number.NaN })).toThrow(/finite/)
    expect(() => canonicalShareJson([undefined])).toThrow(/undefined/)
    expect(() => canonicalShareJson(new Date())).toThrow(/plain object/)
  })

  it('produces stable SHA-256 hashes', async () => {
    expect(await shareContentHash({ b: 2, a: 1 }))
      .toBe(await shareContentHash({ a: 1, b: 2 }))
    expect(await shareContentHash({ a: 1 })).toMatch(/^[a-f0-9]{64}$/)
  })
})
