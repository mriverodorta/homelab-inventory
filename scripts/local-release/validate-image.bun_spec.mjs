import { describe, expect, test } from 'bun:test'
import { scanImage, validateLoadedCandidate } from './validate-image.mjs'

function monotonicClock(step = 5) {
  let value = 0
  return () => { value += step; return value }
}

describe('release image validation timings', () => {
  test('runs Scout and Trivy concurrently after the database gate', async () => {
    const started = []
    let releaseScanners
    const scannersMayFinish = new Promise((resolve) => { releaseScanners = resolve })
    const scan = scanImage('candidate:test', {
      ensureDatabase: async () => { started.push('database') },
      execute: async (command) => {
        const id = command.includes('scout') ? 'scout' : 'trivy'
        started.push(id)
        await scannersMayFinish
      },
      monotonicNow: monotonicClock(),
    })

    await Bun.sleep(10)
    expect(started).toEqual(['database', 'scout', 'trivy'])
    releaseScanners()
    const timings = await scan
    expect(Object.values(timings).every((value) => Number.isInteger(value) && value >= 0)).toBe(true)
  })

  test('persists only bounded timing and result fields', async () => {
    const result = await validateLoadedCandidate({
      image: 'candidate:test',
      platform: 'linux/arm64',
      validationTimings: { runtimeIdentityMs: 12 },
    }, {
      smoke: async () => {},
      scanner: async () => ({ trivyDatabaseMs: 3, scoutMs: 4, trivyMs: 5 }),
      monotonicNow: monotonicClock(),
    })

    expect(result.validationTimings).toEqual({
      runtimeIdentityMs: 12,
      smokeMs: 5,
      trivyDatabaseMs: 3,
      scoutMs: 4,
      trivyMs: 5,
    })
    expect(JSON.stringify(result)).not.toMatch(/stdout|stderr|command|error/i)
  })
})
