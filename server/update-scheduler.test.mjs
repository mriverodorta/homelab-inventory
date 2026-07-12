import { describe, expect, it, vi } from 'vitest'
import { UPDATE_CACHE_MS } from './update-checker.mjs'
import { startUpdateCheckSchedule } from './update-scheduler.mjs'

const successfulResult = {
  state: 'current',
  errorCode: null,
}

describe('update check scheduler', () => {
  it('checks at startup, persists success, and schedules six-hour refreshes', async () => {
    let scheduledCallback = null
    const timer = { unref: vi.fn() }
    const checker = { enabled: true, check: vi.fn(async () => successfulResult) }
    const store = {
      getUpdateMetadata: vi.fn(() => ({ lastUpdateCheck: null })),
      saveUpdateCheck: vi.fn(async () => {}),
    }
    const setIntervalFn = vi.fn((callback) => {
      scheduledCallback = callback
      return timer
    })
    const clearIntervalFn = vi.fn()

    const schedule = startUpdateCheckSchedule({ checker, store, setIntervalFn, clearIntervalFn })
    await schedule.initialCheck

    expect(checker.check).toHaveBeenCalledWith({ force: false, persistedResult: null })
    expect(store.saveUpdateCheck).toHaveBeenCalledWith(successfulResult)
    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), UPDATE_CACHE_MS)
    expect(timer.unref).toHaveBeenCalledTimes(1)

    scheduledCallback()
    await vi.waitFor(() => expect(checker.check).toHaveBeenLastCalledWith({ force: true, persistedResult: null }))
    schedule.stop()
    expect(clearIntervalFn).toHaveBeenCalledWith(timer)
  })

  it('does not persist unknown checks', async () => {
    const checker = {
      enabled: true,
      check: vi.fn(async () => ({ state: 'unknown', errorCode: 'registry-timeout' })),
    }
    const store = {
      getUpdateMetadata: vi.fn(() => ({ lastUpdateCheck: null })),
      saveUpdateCheck: vi.fn(),
    }
    const schedule = startUpdateCheckSchedule({
      checker,
      store,
      setIntervalFn: () => ({ unref() {} }),
      clearIntervalFn: () => {},
    })

    await schedule.initialCheck
    expect(store.saveUpdateCheck).not.toHaveBeenCalled()
    schedule.stop()
  })

  it('passes a persisted result to the startup check and avoids rewriting the same object', async () => {
    const persistedResult = { ...successfulResult, checkedAt: '2026-07-12T12:00:00.000Z' }
    const checker = { enabled: true, check: vi.fn(async () => persistedResult) }
    const store = {
      getUpdateMetadata: vi.fn(() => ({ lastUpdateCheck: persistedResult })),
      saveUpdateCheck: vi.fn(),
    }
    const schedule = startUpdateCheckSchedule({
      checker,
      store,
      setIntervalFn: () => ({ unref() {} }),
      clearIntervalFn: () => {},
    })

    await schedule.initialCheck
    expect(checker.check).toHaveBeenCalledWith({ force: false, persistedResult })
    expect(store.saveUpdateCheck).not.toHaveBeenCalled()
    schedule.stop()
  })

  it('does nothing when update checks are disabled', async () => {
    const checker = { enabled: false, check: vi.fn() }
    const setIntervalFn = vi.fn()
    const schedule = startUpdateCheckSchedule({ checker, setIntervalFn })

    await expect(schedule.initialCheck).resolves.toBeNull()
    expect(checker.check).not.toHaveBeenCalled()
    expect(setIntervalFn).not.toHaveBeenCalled()
  })
})
