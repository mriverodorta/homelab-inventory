import { describe, expect, it, vi } from 'vitest'
import { AccountUnlinkService } from './account-unlink-service.mjs'

const result = {
  account: { connected: false, githubUsername: null, bindingRevision: 4 },
  disposition: 'unpublish',
  affected: { shares: 2, keptOnline: 0, unpublished: 2, deleted: 0 },
}

function fixture(overrides = {}) {
  let operation = null
  const repository = {
    getInstallationProjection: () => ({ accountClaimed: true, accountBindingRevision: 3 }),
    prepareAccountUnlink: vi.fn((input) => {
      operation ??= { id: 7, state: 'pending', result: null, lastErrorCode: null, ...input }
      if (operation.clientAttemptId !== input.clientAttemptId || operation.shareDisposition !== input.shareDisposition) throw new Error('attempt conflict')
      return operation
    }),
    markAccountUnlinkRetryable: vi.fn((id, code) => { operation = { ...operation, id, state: 'retrying', lastErrorCode: code }; return operation }),
    failAccountUnlink: vi.fn((id, code) => { operation = { ...operation, id, state: 'failed', lastErrorCode: code }; return operation }),
    completeAccountUnlink: vi.fn((input) => ({ result: input.result, sharesReconciled: true, affectedLocalShares: 2 })),
  }
  const identityService = {
    getCapabilities: () => ({ accountUnlink: true }),
    unlinkAccount: vi.fn(async () => result),
  }
  return {
    repository,
    identityService,
    service: new AccountUnlinkService({ repository, identityService, randomUuid: () => 'c3373662-7995-4179-824c-bfb08e80996d', onStateChanged: vi.fn(), ...overrides }),
  }
}

describe('LabGD account unlink service', () => {
  it('reuses one durable remote idempotency key across retryable failures', async () => {
    const { repository, identityService, service } = fixture()
    identityService.unlinkAccount.mockRejectedValueOnce(Object.assign(new Error('unavailable'), { code: 'labgd-unavailable' })).mockResolvedValueOnce(result)
    const command = { clientAttemptId: '3c58e2df-f909-4131-b62c-7763682fc1d4', shareDisposition: 'unpublish', confirmation: null, actorUserId: 1 }
    await expect(service.execute(command)).rejects.toMatchObject({ code: 'labgd-unavailable', status: 503 })
    await expect(service.execute(command)).resolves.toMatchObject({ result, sharesReconciled: true })
    expect(repository.prepareAccountUnlink).toHaveBeenCalledTimes(2)
    expect(identityService.unlinkAccount.mock.calls.map(([value]) => value.idempotencyKey)).toEqual([
      'c3373662-7995-4179-824c-bfb08e80996d',
      'c3373662-7995-4179-824c-bfb08e80996d',
    ])
  })

  it('requires negotiated support, a linked account, and exact delete confirmation', async () => {
    const unsupported = fixture()
    unsupported.identityService.getCapabilities = () => ({ accountUnlink: false })
    await expect(unsupported.service.execute({ clientAttemptId: '3c58e2df-f909-4131-b62c-7763682fc1d4', shareDisposition: 'keep', confirmation: null, actorUserId: 1 })).rejects.toMatchObject({ code: 'sharing-account-unlink-unavailable' })

    const unclaimed = fixture()
    unclaimed.repository.getInstallationProjection = () => ({ accountClaimed: false, accountBindingRevision: 4 })
    await expect(unclaimed.service.execute({ clientAttemptId: '3c58e2df-f909-4131-b62c-7763682fc1d4', shareDisposition: 'keep', confirmation: null, actorUserId: 1 })).rejects.toMatchObject({ code: 'installation-account-not-linked' })

    const deletion = fixture()
    await expect(deletion.service.execute({ clientAttemptId: '3c58e2df-f909-4131-b62c-7763682fc1d4', shareDisposition: 'delete', confirmation: 'delete', actorUserId: 1 })).rejects.toMatchObject({ code: 'sharing-delete-confirmation-required' })
  })

  it('marks stable binding conflicts failed without changing the requested disposition', async () => {
    const { repository, identityService, service } = fixture()
    identityService.unlinkAccount.mockRejectedValueOnce(Object.assign(new Error('changed'), { code: 'account-binding-changed' }))
    await expect(service.execute({ clientAttemptId: '3c58e2df-f909-4131-b62c-7763682fc1d4', shareDisposition: 'keep', confirmation: null, actorUserId: null })).rejects.toMatchObject({ code: 'account-binding-changed', status: 409 })
    expect(repository.failAccountUnlink).toHaveBeenCalledWith(7, 'account-binding-changed')
    expect(repository.completeAccountUnlink).not.toHaveBeenCalled()
  })
})
