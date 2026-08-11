import { describe, expect, it } from 'vitest'
import { applicationHealth } from './app-health.mjs'

describe('application health', () => {
  it('reports a healthy persistent store', () => {
    expect(applicationHealth({
      mode: 'production',
      schemaVersion: 10,
      persistence: {
        ok: true,
        engine: 'sqlite',
        schemas: { core: 10, telemetry: 2, catalog: 2 },
        database: { integrity: 'ok' },
      },
    })).toEqual({
      status: 200,
      payload: {
        ok: true,
        mode: 'production',
        schemaVersion: 10,
        applicationOemContractVersion: 6,
        applicationCatalogContractVersion: 8,
        persistence: {
          ok: true,
          engine: 'sqlite',
          schemas: { core: 10, telemetry: 2, catalog: 2 },
          database: { integrity: 'ok' },
        },
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
        applicationCatalogContractVersion: 8,
        persistence: null,
      },
    })
  })
})
