import { describe, expect, it, vi } from 'vitest'
import {
  CatalogRefreshCoordinator,
  DEFAULT_CATALOG_REFRESH_INTERVAL_MS,
  readCatalogRefreshInterval,
} from './catalog-refresh-coordinator.mjs'

function coordinatorFixture({
  mode = 'connected',
  intervalMs = DEFAULT_CATALOG_REFRESH_INTERVAL_MS,
  random = 0.5,
  refreshConnected = vi.fn(async () => ({ ok: true })),
} = {}) {
  let registryMode = mode
  const timers = []
  const cleared = []
  const timer = { unref: vi.fn() }
  const setTimeoutFn = vi.fn((callback, delay) => {
    timers.push({ callback, delay, timer })
    return timer
  })
  const clearTimeoutFn = vi.fn((value) => cleared.push(value))
  const logger = { warn: vi.fn() }
  const coordinator = new CatalogRefreshCoordinator({
    store: {
      getRegistryState: () => ({ settings: { mode: registryMode } }),
    },
    snapshotService: { refreshConnected },
    intervalMs,
    randomFn: () => random,
    setTimeoutFn,
    clearTimeoutFn,
    logger,
  })

  return {
    coordinator,
    refreshConnected,
    setMode(value) {
      registryMode = value
    },
    setTimeoutFn,
    clearTimeoutFn,
    timers,
    cleared,
    timer,
    logger,
  }
}

describe('catalog refresh interval configuration', () => {
  it('uses the six-hour default and accepts zero or positive safe integer overrides', () => {
    expect(readCatalogRefreshInterval(undefined)).toBe(21_600_000)
    expect(readCatalogRefreshInterval('0')).toBe(0)
    expect(readCatalogRefreshInterval('120000')).toBe(120_000)
  })

  it.each(['', '-1', '1.5', 'invalid', String(Number.MAX_SAFE_INTEGER + 1)])(
    'rejects invalid interval value %s',
    (value) => expect(() => readCatalogRefreshInterval(value)).toThrow(/REGISTRY_REFRESH_INTERVAL_MS/),
  )
})

describe('CatalogRefreshCoordinator', () => {
  it('queues a nonblocking startup refresh and schedules the next run after it settles', async () => {
    let release
    const refreshConnected = vi.fn(() => new Promise((resolve) => {
      release = resolve
    }))
    const fixture = coordinatorFixture({ refreshConnected })

    fixture.coordinator.start()

    expect(refreshConnected).toHaveBeenCalledOnce()
    expect(fixture.setTimeoutFn).not.toHaveBeenCalled()
    release({ ok: true })
    await vi.waitFor(() => expect(fixture.setTimeoutFn).toHaveBeenCalledOnce())
    expect(fixture.timers[0].delay).toBe(DEFAULT_CATALOG_REFRESH_INTERVAL_MS)
    expect(fixture.timer.unref).toHaveBeenCalledOnce()
  })

  it.each([
    { random: 0, expected: DEFAULT_CATALOG_REFRESH_INTERVAL_MS * 0.9 },
    { random: 1, expected: DEFAULT_CATALOG_REFRESH_INTERVAL_MS * 1.1 },
  ])('keeps jitter within the configured ten-percent bound', async ({ random, expected }) => {
    const fixture = coordinatorFixture({ random })
    fixture.coordinator.start()
    await vi.waitFor(() => expect(fixture.setTimeoutFn).toHaveBeenCalledOnce())
    expect(fixture.timers[0].delay).toBe(Math.round(expected))
  })

  it.each(['disabled', 'offline'])('does no automatic work in %s mode', async (mode) => {
    const fixture = coordinatorFixture({ mode })
    fixture.coordinator.start()
    await Promise.resolve()
    expect(fixture.refreshConnected).not.toHaveBeenCalled()
    expect(fixture.setTimeoutFn).not.toHaveBeenCalled()
  })

  it('allows manual refresh while automatic refresh is disabled by interval zero', async () => {
    const fixture = coordinatorFixture({ intervalMs: 0 })
    fixture.coordinator.start()
    await Promise.resolve()
    expect(fixture.refreshConnected).not.toHaveBeenCalled()

    await fixture.coordinator.refresh('manual')
    expect(fixture.refreshConnected).toHaveBeenCalledOnce()
    expect(fixture.setTimeoutFn).not.toHaveBeenCalled()
  })

  it('shares one in-flight operation between automatic and manual refresh calls', async () => {
    let release
    const refreshConnected = vi.fn(() => new Promise((resolve) => {
      release = resolve
    }))
    const fixture = coordinatorFixture({ refreshConnected })
    fixture.coordinator.start()

    const manual = fixture.coordinator.refresh('manual')
    expect(refreshConnected).toHaveBeenCalledOnce()
    release({ revision: 3 })
    await expect(manual).resolves.toEqual({ revision: 3 })
  })

  it('starts immediately on a transition to connected and cancels on departure', async () => {
    const fixture = coordinatorFixture({ mode: 'offline' })
    fixture.coordinator.start()
    fixture.setMode('connected')
    fixture.coordinator.reconcileSchedule()
    await vi.waitFor(() => expect(fixture.setTimeoutFn).toHaveBeenCalledOnce())
    expect(fixture.refreshConnected).toHaveBeenCalledOnce()

    fixture.setMode('disabled')
    fixture.coordinator.reconcileSchedule()
    expect(fixture.clearTimeoutFn).toHaveBeenCalledWith(fixture.timer)
  })

  it('retains the current schedule for unrelated connected preference changes', async () => {
    const fixture = coordinatorFixture()
    fixture.coordinator.start()
    await vi.waitFor(() => expect(fixture.setTimeoutFn).toHaveBeenCalledOnce())
    fixture.coordinator.reconcileSchedule()
    expect(fixture.refreshConnected).toHaveBeenCalledOnce()
    expect(fixture.setTimeoutFn).toHaveBeenCalledOnce()
  })

  it('logs automatic failures once and schedules the next attempt', async () => {
    const fixture = coordinatorFixture({
      refreshConnected: vi.fn(async () => {
        throw new Error('Catalog unavailable')
      }),
    })
    fixture.coordinator.start()
    await vi.waitFor(() => expect(fixture.setTimeoutFn).toHaveBeenCalledOnce())
    expect(fixture.logger.warn).toHaveBeenCalledOnce()
    expect(fixture.logger.warn).toHaveBeenCalledWith('Automatic catalog refresh failed: Catalog unavailable')
  })

  it('cancels future work and waits for an active refresh during shutdown', async () => {
    let release
    const fixture = coordinatorFixture({
      refreshConnected: vi.fn(() => new Promise((resolve) => {
        release = resolve
      })),
    })
    fixture.coordinator.start()
    let stopped = false
    const stopping = fixture.coordinator.stop().then(() => {
      stopped = true
    })
    await Promise.resolve()
    expect(stopped).toBe(false)
    release({ ok: true })
    await stopping
    expect(fixture.setTimeoutFn).not.toHaveBeenCalled()
    await expect(fixture.coordinator.refresh('manual')).resolves.toBeNull()
  })
})
