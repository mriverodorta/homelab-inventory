import { describe, expect, it, vi } from 'vitest'
import { runCatalogUpdatesAfterStartup } from './catalog-update-startup.mjs'

describe('runCatalogUpdatesAfterStartup', () => {
  it('waits for catalog recovery before evaluating updates', async () => {
    const calls = []
    const runtime = {
      resumeRecovery: vi.fn(async () => { calls.push('recovered') }),
      state: vi.fn(() => ({ available: true })),
    }
    const coordinator = { run: vi.fn(async () => { calls.push('evaluated'); return { applied: 1 } }) }

    await expect(runCatalogUpdatesAfterStartup({ runtime, store: {}, coordinator })).resolves.toEqual({ applied: 1 })
    expect(calls).toEqual(['recovered', 'evaluated'])
  })

  it('does not record an update failure when catalog recovery remains unavailable', async () => {
    const runtime = {
      resumeRecovery: vi.fn(async () => null),
      state: vi.fn(() => ({ available: false })),
    }
    const coordinator = { run: vi.fn() }

    await expect(runCatalogUpdatesAfterStartup({ runtime, store: {}, coordinator })).resolves.toEqual({ skipped: true })
    expect(coordinator.run).not.toHaveBeenCalled()
  })

  it('forces semantic reconciliation once and persists completion only after success', async () => {
    const store = {
      getCatalogUpdateReconciliationVersion: vi.fn(() => 0),
      markCatalogUpdateReconciliationComplete: vi.fn(),
    }
    const runtime = {
      resumeRecovery: vi.fn(async () => null),
      state: vi.fn(() => ({ available: true })),
    }
    const coordinator = { run: vi.fn(async () => ({ review: 3 })) }

    await expect(runCatalogUpdatesAfterStartup({ runtime, store, coordinator })).resolves.toEqual({ review: 3 })
    expect(coordinator.run).toHaveBeenCalledWith({ force: true })
    expect(store.markCatalogUpdateReconciliationComplete).toHaveBeenCalledWith(1)

    store.getCatalogUpdateReconciliationVersion.mockReturnValue(1)
    coordinator.run.mockClear()
    await runCatalogUpdatesAfterStartup({ runtime, store, coordinator })
    expect(coordinator.run).toHaveBeenCalledWith()
    expect(store.markCatalogUpdateReconciliationComplete).toHaveBeenCalledOnce()
  })

  it('retries reconciliation after a failed startup evaluation', async () => {
    const store = {
      getCatalogUpdateReconciliationVersion: vi.fn(() => 0),
      markCatalogUpdateReconciliationComplete: vi.fn(),
    }
    const runtime = {
      resumeRecovery: vi.fn(async () => null),
      state: vi.fn(() => ({ available: true })),
    }
    const coordinator = { run: vi.fn(async () => { throw new Error('catalog unavailable') }) }

    await expect(runCatalogUpdatesAfterStartup({ runtime, store, coordinator })).rejects.toThrow('catalog unavailable')
    expect(store.markCatalogUpdateReconciliationComplete).not.toHaveBeenCalled()
  })
})
