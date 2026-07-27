import { describe, expect, it, vi } from 'vitest'
import { ContributionDeliveryService } from './contribution-delivery.mjs'
import { createRegistryStore } from './model.mjs'

function fixture({ enabled = true } = {}) {
  let registry = createRegistryStore()
  registry.settings.mode = enabled ? 'connected' : 'disabled'
  registry.settings.automaticContributions = enabled
  const item = { id: 1, key: 'cpu:1', type: 'cpu', name: 'Example CPU', manufacturer: 'Example', model: 'C1' }
  return {
    getRegistryState: () => structuredClone(registry),
    getProject: () => ({ items: { 'cpu:1': item } }),
    registryTransaction(mutator) {
      const draft = structuredClone(registry)
      mutator(draft)
      registry = draft
      return this.getRegistryState()
    },
    flush: vi.fn(),
  }
}

describe('contribution delivery', () => {
  it('performs zero network or identity work while consent is disabled', async () => {
    const store = fixture({ enabled: false })
    const identityService = { signedPost: vi.fn() }
    const service = new ContributionDeliveryService({ identityService })
    await service.deliver(store)
    expect(identityService.signedPost).not.toHaveBeenCalled()
    expect(store.getRegistryState().contributionOutbox).toEqual([])
  })

  it('moves accepted batches to the bounded ledger', async () => {
    const store = fixture()
    const identityService = {
      signedPost: vi.fn(async (_store, _path, body) => new Response(JSON.stringify({
        results: body.candidates.map((candidate) => ({ contentHash: candidate.contentHash, state: 'quarantined' })),
      }), { status: 202 })),
    }
    const service = new ContributionDeliveryService({ identityService })
    await service.deliver(store, new Date('2026-07-26T12:00:00.000Z'))
    expect(store.getRegistryState().contributionOutbox).toEqual([])
    expect(store.getRegistryState().contributionLedger).toHaveLength(1)
    expect(store.getRegistryState().contributionLedger[0]).toMatchObject({ state: 'delivered', itemType: 'cpu', itemId: 1 })
    const requestBody = identityService.signedPost.mock.calls[0][2]
    expect(requestBody.candidates[0]).not.toHaveProperty('sources')
    expect(requestBody.candidates[0]).not.toHaveProperty('itemId')
    expect(requestBody.candidates[0]).not.toHaveProperty('itemType')
    expect(JSON.stringify(requestBody)).not.toContain('cpu:1')
  })

  it('backs off without losing a candidate when delivery fails', async () => {
    const store = fixture()
    const service = new ContributionDeliveryService({
      identityService: { signedPost: vi.fn(async () => { throw new Error('offline') }) },
      random: () => 0,
    })
    await service.deliver(store, new Date('2026-07-26T12:00:00.000Z'))
    expect(store.getRegistryState().contributionOutbox[0]).toMatchObject({
      state: 'retrying', attempts: 1, lastError: 'offline', nextAttemptAt: '2026-07-26T12:02:00.000Z',
    })
  })
})
