import { describe, expect, it } from 'vitest'
import { normalizeManufacturer, normalizeUnitText, normalizeVariantKey } from '../src/normalization'

describe('linear catalog normalization', () => {
  it.each([
    ['Intel Corporation.,.,', 'intel'],
    ['HP Inc.', 'hp'],
    ['Hewlett-Packard', 'hp'],
    ['Example., Maker..', 'example., maker'],
    [',.,.', ''],
    ['\uFF28\uFF30 Inc.', 'hp'],
  ])('preserves manufacturer canonicalization for %s', (input, expected) => {
    expect(normalizeManufacturer(input)).toBe(expected)
  })

  it.each([
    ['10\t\n Gbps / 3200\u00a0MHz', '10gbps / 3200mhz'],
    ['35 Watts, 12 W', '35watts, 12w'],
    ['Watts / Watt', 'w /w'],
    ['2.5 GHz 1 TB 8 GB 512 MB 1 KB 1 kHz 10 Mbps', '2.5ghz 1tb 8gb 512mb 1kb 1khz 10mbps'],
    ['GBpsExtra 10 GB/s', 'gbpsextra 10gb/s'],
    ['wattage', 'wattage'],
    ['', ''],
  ])('preserves unit canonicalization for %s', (input, expected) => {
    expect(normalizeUnitText(input)).toBe(expected)
  })

  it.each([
    ['--Discrete / Graphics---', 'discrete-graphics'],
    ['a--b', 'a-b'],
    ['---', ''],
    ['', ''],
    ['\uFF21\uFF22\uFF23', 'abc'],
  ])('preserves variant keys for %s', (input, expected) => {
    expect(normalizeVariantKey(input)).toBe(expected)
  })

  it('handles long punctuation and whitespace runs without suffix-search backtracking', () => {
    const punctuation = '.,'.repeat(100_000)
    expect(normalizeManufacturer(`Example${punctuation}`)).toBe('example')
    expect(normalizeManufacturer(`${punctuation}x`)).toBe(`${punctuation}x`)
    expect(normalizeUnitText(`1${'\t '.repeat(100_000)}GB`)).toBe('1gb')
    expect(normalizeVariantKey(`${'-'.repeat(100_000)}standard${'-'.repeat(100_000)}`)).toBe('standard')
  })
})
