import { describe, expect, test } from 'bun:test'
import { memoryPressurePercent } from './memory-pressure.mjs'

describe('memory pressure', () => {
  test('uses Linux MemAvailable without adding reclaimable composition counters', () => {
    expect(memoryPressurePercent({
      totalBytes: 1_000,
      availableBytes: 720,
      freeBytes: 230,
      buffersBytes: 40,
      cachedBytes: 450,
      reclaimableBytes: 20,
      sharedBytes: 5,
    })).toBeCloseTo(28, 8)
  })

  test('uses OPNsense page classes and subtracts ZFS ARC exactly once', () => {
    expect(memoryPressurePercent({
      totalBytes: 17_016_328_192,
      pageSizeBytes: 4_096,
      pageCount: 4_043_814,
      activePages: 346_136,
      inactivePages: 1_684_534,
      cachePages: 0,
      laundryPages: 12_409,
      wiredPages: 1_830_979,
      freePages: 165_396,
      zfsArcBytes: 4_413_015_560,
      usedPercent: 99,
    })).toBeCloseTo(28.01, 2)
  })

  test('supports FreeBSD without ZFS and optional cache pages', () => {
    expect(memoryPressurePercent({
      totalBytes: 4_096_000,
      pageCount: 1_000,
      inactivePages: 300,
      laundryPages: 50,
      freePages: 100,
    })).toBeCloseTo(55, 8)
  })

  test('falls back through legacy percentage and byte counters', () => {
    expect(memoryPressurePercent({ usedPercent: 43 })).toBe(43)
    expect(memoryPressurePercent({ totalBytes: 1_000, usedBytes: 370 })).toBe(37)
  })

  test('rejects inconsistent or unbounded counters', () => {
    expect(memoryPressurePercent({ totalBytes: 1_000, availableBytes: 1_001 })).toBeNull()
    expect(memoryPressurePercent({ totalBytes: 1_000, pageCount: 100, inactivePages: 80, laundryPages: 30, freePages: 10 })).toBeNull()
    expect(memoryPressurePercent({ usedPercent: Number.NaN })).toBeNull()
  })
})
