import { describe, expect, it } from 'vitest'
import { applicationHealth } from './app-health.mjs'

describe('application health', () => {
  it('reports a healthy persistent store', () => {
    expect(applicationHealth({
      mode: 'production',
      schemaVersion: 16,
      persistence: { ok: true, dirtyStores: [], failure: null },
    })).toEqual({
      status: 200,
      payload: {
        ok: true,
        mode: 'production',
        schemaVersion: 16,
        applicationOemContractVersion: 6,
        persistence: { ok: true, dirtyStores: [], failure: null },
      },
    })
  })

  it('returns 503 when persistence is unhealthy', () => {
    expect(applicationHealth({
      mode: 'production',
      schemaVersion: 16,
      persistence: { ok: false, dirtyStores: ['project'], failure: { message: 'write failed' } },
    })).toMatchObject({
      status: 503,
      payload: { ok: false },
    })
  })

  it('keeps demo health independent from disposable persistence', () => {
    expect(applicationHealth({ mode: 'demo' })).toEqual({
      status: 200,
      payload: {
        ok: true,
        mode: 'demo',
        schemaVersion: null,
        applicationOemContractVersion: 6,
        persistence: null,
      },
    })
  })
})
