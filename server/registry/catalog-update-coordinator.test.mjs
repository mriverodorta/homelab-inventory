import { describe, expect, it, vi } from 'vitest'
import { CatalogUpdateCoordinator } from './catalog-update-coordinator.mjs'

describe('CatalogUpdateCoordinator', () => {
  it('evaluates each linked update and commits one grouped run', async () => {
    const template = { templateKey: 'cpu-intel-core-i7-10700t', revision: 3, contentHash: 'a'.repeat(64) }
    const store = {
      getRegistryState: vi.fn(() => ({
        settings: { automaticSafeUpdates: true },
        snapshot: { sourceId: 1, revision: 17 },
        sources: [{ id: 1, kind: 'official-connected' }],
      })),
      getCatalogUpdates: vi.fn(() => [
        { linkId: 1, templateKey: template.templateKey, availableRevision: 3 },
        { linkId: 2, templateKey: template.templateKey, availableRevision: 3 },
      ]),
      evaluateCatalogUpdates: vi.fn((updates) => ({
        projectRevision: 12,
        projectRevisions: { 1: 12 },
        evaluations: updates.map(({ linkId }) => ({ linkId, classification: 'safe', targetContentHash: template.contentHash })),
      })),
      commitCatalogUpdateRun: vi.fn((input) => ({ applied: input.evaluations.length })),
      getRegistryUpdateGroups: vi.fn(() => []),
    }
    const snapshotService = { templates: vi.fn(async () => [template]) }
    const coordinator = new CatalogUpdateCoordinator({ store, snapshotService })

    await expect(coordinator.run()).resolves.toEqual({ applied: 2 })
    expect(snapshotService.templates).toHaveBeenCalledOnce()
    expect(store.commitCatalogUpdateRun).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: 1,
      catalogRevision: 17,
      automatic: true,
      expectedProjectRevision: 12,
      expectedProjectRevisions: { 1: 12 },
      evaluations: [
        expect.objectContaining({ linkId: 1, targetContentHash: template.contentHash }),
        expect.objectContaining({ linkId: 2, targetContentHash: template.contentHash }),
      ],
    }))
  })

  it('never evaluates untrusted private or offline sources automatically', async () => {
    const store = {
      getRegistryState: () => ({ settings: {}, snapshot: { sourceId: 1, revision: 2 }, sources: [{ id: 1, kind: 'private' }] }),
      getCatalogUpdates: vi.fn(),
    }
    const coordinator = new CatalogUpdateCoordinator({ store, snapshotService: {} })
    await expect(coordinator.run()).resolves.toMatchObject({ applied: 0, review: 0 })
    expect(store.getCatalogUpdates).not.toHaveBeenCalled()
  })

  it('coalesces concurrent runs and reports catalog evaluation failures once', async () => {
    const logger = { error: vi.fn() }
    const store = {
      getRegistryState: () => ({
        settings: { automaticSafeUpdates: true },
        snapshot: { sourceId: 1, revision: 17 },
        sources: [{ id: 1, kind: 'official-connected' }],
      }),
      getCatalogUpdates: () => [{ linkId: 1, templateKey: 'cpu-example', availableRevision: 2 }],
      evaluateCatalogUpdates: vi.fn(),
    }
    let rejectTemplate
    const templatePromise = new Promise((_resolve, reject) => { rejectTemplate = reject })
    const coordinator = new CatalogUpdateCoordinator({
      store,
      snapshotService: { template: vi.fn(() => templatePromise) },
      logger,
    })

    const first = coordinator.run()
    const second = coordinator.run()
    expect(second).toBe(first)
    rejectTemplate(new Error('catalog unavailable'))
    await expect(first).rejects.toThrow('catalog unavailable')
    expect(logger.error).toHaveBeenCalledOnce()
  })

  it('evaluates a large linked inventory with one batched catalog lookup', async () => {
    const template = { templateKey: 'cpu-example', revision: 2, contentHash: 'a'.repeat(64) }
    const updates = Array.from({ length: 1_000 }, (_, index) => ({
      linkId: index + 1,
      templateKey: template.templateKey,
      availableRevision: 2,
    }))
    const store = {
      getRegistryState: () => ({
        settings: { automaticSafeUpdates: true },
        snapshot: { sourceId: 1, revision: 18 },
        sources: [{ id: 1, kind: 'official-connected' }],
      }),
      getCatalogUpdates: () => updates,
      evaluateCatalogUpdates: vi.fn((eligible) => ({ projectRevisions: { 1: 7 }, evaluations: eligible })),
      commitCatalogUpdateRun: vi.fn((input) => ({ applied: input.evaluations.length })),
      getRegistryUpdateGroups: vi.fn(() => []),
    }
    const snapshotService = { templates: vi.fn(async () => [template]) }

    await expect(new CatalogUpdateCoordinator({ store, snapshotService }).run()).resolves.toEqual({ applied: 1_000 })
    expect(snapshotService.templates).toHaveBeenCalledOnce()
    expect(store.evaluateCatalogUpdates).toHaveBeenCalledOnce()
    expect(store.evaluateCatalogUpdates.mock.calls[0][0]).toHaveLength(1_000)
    expect(store.commitCatalogUpdateRun).toHaveBeenCalledOnce()
  })

  it('respects failed-run backoff and allows an explicit retry', async () => {
    const template = { templateKey: 'cpu-example', revision: 2, contentHash: 'a'.repeat(64) }
    const store = {
      getRegistryState: () => ({
        settings: { automaticSafeUpdates: true },
        snapshot: { sourceId: 1, revision: 18 },
        sources: [{ id: 1, kind: 'official-connected' }],
      }),
      getRegistryUpdateStatus: vi.fn(() => ({
        state: 'failed', catalogRevision: 18, attemptCount: 1, retryAfter: '2026-08-14T13:01:00.000Z',
      })),
      getRegistryUpdateGroups: vi.fn(() => [{ id: 'review:cpu-example:2' }]),
      getCatalogUpdates: vi.fn(() => [{ linkId: 1, templateKey: template.templateKey, availableRevision: 2 }]),
      evaluateCatalogUpdates: vi.fn(() => ({ projectRevisions: { 1: 7 }, evaluations: [{ linkId: 1 }] })),
      commitCatalogUpdateRun: vi.fn(() => ({ applied: 1 })),
    }
    const snapshotService = { templates: vi.fn(async () => [template]) }
    const coordinator = new CatalogUpdateCoordinator({
      store,
      snapshotService,
      now: () => Date.parse('2026-08-14T13:00:00.000Z'),
    })

    await expect(coordinator.run()).resolves.toMatchObject({ applied: 0, run: { state: 'failed' } })
    expect(snapshotService.templates).not.toHaveBeenCalled()
    await expect(coordinator.run({ force: true })).resolves.toEqual({ applied: 1 })
    expect(snapshotService.templates).toHaveBeenCalledOnce()
  })
})
