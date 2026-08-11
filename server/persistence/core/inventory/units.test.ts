import { describe, expect, test } from 'bun:test'
import {
  toBasisPoints,
  toBitsPerSecond,
  toBytes,
  toMhz,
  toMib,
  toMilliamps,
  toMillimeters,
  toMillivolts,
  toMilliwatts,
} from './units.ts'

describe('canonical inventory units', () => {
  test('converts exact source values to canonical integers', () => {
    expect(toMhz({ value: 2.3, unit: 'GHz' })).toBe(2300)
    expect(toMib({ value: 16, unit: 'GiB' })).toBe(16384)
    expect(toBytes({ value: 1_000_204_886_016, unit: 'bytes' })).toBe(1_000_204_886_016)
    expect(toMilliwatts({ value: 130, unit: 'W' })).toBe(130_000)
    expect(toBitsPerSecond({ value: 10, unit: 'Gbps' })).toBe(10_000_000_000)
    expect(toMillivolts({ value: 1.2, unit: 'V' })).toBe(1200)
    expect(toMilliamps({ value: 2.5, unit: 'A' })).toBe(2500)
    expect(toMillimeters({ value: 250, unit: 'mm' })).toBe(250)
    expect(toBasisPoints({ value: 98.5, unit: 'percent' })).toBe(9850)
  })

  test('rejects negative physical values and unsafe integer results', () => {
    expect(() => toMib({ value: -1, unit: 'GiB' })).toThrow(/non-negative/iu)
    expect(() => toBytes({ value: Number.MAX_SAFE_INTEGER, unit: 'GiB' })).toThrow(/safe integer/iu)
  })

  test('rejects conversions that would imply false precision', () => {
    expect(() => toMhz({ value: 2.3001, unit: 'GHz' })).toThrow(/precision/iu)
    expect(() => toMillimeters({ value: 27, unit: 'in' })).toThrow(/precision/iu)
  })

  test('rejects non-finite and unsupported inputs', () => {
    expect(() => toMilliwatts({ value: Number.NaN, unit: 'W' })).toThrow(/finite/iu)
    expect(() => toBytes({ value: 1, unit: 'widgets' as 'bytes' })).toThrow(/unsupported/iu)
  })
})
