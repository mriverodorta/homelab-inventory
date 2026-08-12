import { describe, expect, it, vi } from 'vitest'
import { CatalogStatusService, DEFAULT_CATALOG_STATUS_INTERVAL_MS } from './catalog-status-service.mjs'

function fixture({ mode = 'connected', state = 'active', revision = 12 } = {}) {
  let registry = {
    settings: { mode, automaticContributions: true, updatedAt: null },
    installationIdentity: state ? { state, lastError: null } : null,
    snapshot: revision ? { revision } : null,
  }
  const store = {
    getRegistryState: () => structuredClone(registry),
    registryTransaction(mutator) {
      const draft = structuredClone(registry)
      mutator(draft)
      registry = draft
    },
  }
  return { store, registry: () => registry }
}

describe('CatalogStatusService', () => {
  it('sends only the privacy-safe catalog adoption contract', async () => {
    const { store } = fixture()
    const identityService = {
      signedPost: vi.fn(async () => new Response(JSON.stringify({
        state: 'current', currentCatalogRevision: 12, recorded: true,
      }), { status: 200 })),
    }
    const now = new Date('2026-08-12T12:00:00.000Z')
    const service = new CatalogStatusService({
      store, identityService, applicationVersion: '0.11.1', now: () => now,
    })

    await service.trigger()

    expect(identityService.signedPost).toHaveBeenCalledWith(
      store,
      '/v1/installations/catalog-status',
      {
        applicationVersion: '0.11.1',
        activeCatalogRevision: 12,
        reportedAt: now.toISOString(),
      },
      now,
    )
    expect(Object.keys(identityService.signedPost.mock.calls[0][2])).toEqual([
      'applicationVersion', 'activeCatalogRevision', 'reportedAt',
    ])
  })

  it.each([
    { mode: 'disabled', state: 'active', revision: 12 },
    { mode: 'offline', state: 'active', revision: 12 },
    { mode: 'connected', state: null, revision: 12 },
    { mode: 'connected', state: 'recovery-pending', revision: 12 },
    { mode: 'connected', state: 'active', revision: null },
  ])('does no identity or network work when ineligible', async (options) => {
    const { store } = fixture(options)
    const identityService = { signedPost: vi.fn() }
    const service = new CatalogStatusService({ store, identityService, applicationVersion: '0.11.1' })
    await expect(service.trigger()).resolves.toBeNull()
    expect(identityService.signedPost).not.toHaveBeenCalled()
  })

  it('uses fresh timestamps across bounded transient retries', async () => {
    const { store } = fixture()
    const times = [
      new Date('2026-08-12T12:00:00.000Z'),
      new Date('2026-08-12T12:00:02.000Z'),
      new Date('2026-08-12T12:00:12.000Z'),
    ]
    const identityService = {
      signedPost: vi.fn()
        .mockResolvedValueOnce(new Response('{}', { status: 503 }))
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          state: 'behind', currentCatalogRevision: 13, recorded: false,
        }), { status: 200 })),
    }
    const waitFn = vi.fn(async () => {})
    const service = new CatalogStatusService({
      store,
      identityService,
      applicationVersion: '0.11.1',
      now: () => times.shift(),
      waitFn,
    })

    await service.trigger()

    expect(waitFn).toHaveBeenNthCalledWith(1, 2_000)
    expect(waitFn).toHaveBeenNthCalledWith(2, 10_000)
    expect(identityService.signedPost.mock.calls.map((call) => call[2].reportedAt)).toEqual([
      '2026-08-12T12:00:00.000Z',
      '2026-08-12T12:00:02.000Z',
      '2026-08-12T12:00:12.000Z',
    ])
  })

  it('defers a rate-limited report without retrying', async () => {
    const { store } = fixture()
    const identityService = { signedPost: vi.fn(async () => new Response('{}', { status: 429 })) }
    const waitFn = vi.fn()
    const service = new CatalogStatusService({
      store, identityService, applicationVersion: '0.11.1', waitFn,
    })

    await expect(service.trigger()).resolves.toEqual({ deferred: true })
    expect(identityService.signedPost).toHaveBeenCalledOnce()
    expect(waitFn).not.toHaveBeenCalled()
  })

  it('moves invalid credentials into owner recovery and stops contributions', async () => {
    const { store, registry } = fixture()
    const logger = { warn: vi.fn() }
    const identityService = { signedPost: vi.fn(async () => new Response('{}', { status: 401 })) }
    const service = new CatalogStatusService({
      store, identityService, applicationVersion: '0.11.1', logger,
      now: () => new Date('2026-08-12T12:00:00.000Z'),
    })

    await expect(service.trigger()).resolves.toBeNull()

    expect(registry().installationIdentity).toMatchObject({
      state: 'recovery-pending',
      lastError: 'Registry installation credentials require owner recovery.',
    })
    expect(registry().settings.automaticContributions).toBe(false)
    expect(logger.warn).toHaveBeenCalledOnce()
  })

  it('checks in on startup, schedules every six hours, and stops cleanly', async () => {
    const { store } = fixture()
    const timer = { unref: vi.fn() }
    const setTimeoutFn = vi.fn(() => timer)
    const clearTimeoutFn = vi.fn()
    const identityService = { signedPost: vi.fn(async () => new Response(JSON.stringify({
      state: 'current', currentCatalogRevision: 12, recorded: false,
    }), { status: 200 })) }
    const service = new CatalogStatusService({
      store, identityService, applicationVersion: '0.11.1', setTimeoutFn, clearTimeoutFn,
    })

    service.start()
    await vi.waitFor(() => expect(identityService.signedPost).toHaveBeenCalledOnce())
    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), DEFAULT_CATALOG_STATUS_INTERVAL_MS)
    expect(timer.unref).toHaveBeenCalledOnce()

    await service.stop()
    expect(clearTimeoutFn).toHaveBeenCalledWith(timer)
  })
})
