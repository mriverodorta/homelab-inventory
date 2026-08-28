import { randomUUID } from 'node:crypto'

const DISPOSITIONS = new Set(['keep', 'unpublish', 'delete'])
const STABLE_ERRORS = new Set([
  'account-binding-changed',
  'account-unlink-idempotency-conflict',
  'account-unlink-disposition-invalid',
  'installation-account-not-linked',
])

function failure(message, code, status) {
  return Object.assign(new Error(message), { code, status })
}

function validateCommand(command) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(command?.clientAttemptId ?? '')) {
    throw failure('The account unlink attempt ID is invalid.', 'sharing-account-unlink-invalid', 400)
  }
  if (!DISPOSITIONS.has(command?.shareDisposition)) {
    throw failure('The share disposition is invalid.', 'sharing-account-unlink-invalid', 400)
  }
  if (command.shareDisposition === 'delete' && command.confirmation !== 'DELETE') {
    throw failure('Type DELETE to permanently delete all remote shares.', 'sharing-delete-confirmation-required', 400)
  }
}

function normalizeRemoteError(error) {
  const code = typeof error?.code === 'string' ? error.code : 'labgd-account-unlink-failed'
  if (code === 'account-binding-changed' || code === 'account-unlink-idempotency-conflict') error.status = 409
  else if (code === 'installation-account-not-linked') error.status = 400
  else if (code === 'account-unlink-disposition-invalid') error.status = 400
  else error.status = 503
  return { error, code }
}

export class AccountUnlinkService {
  constructor({ repository, identityService, randomUuid = randomUUID, onStateChanged = () => {} }) {
    this.repository = repository
    this.identityService = identityService
    this.randomUuid = randomUuid
    this.onStateChanged = onStateChanged
  }

  async execute(command) {
    validateCommand(command)
    if (this.identityService.getCapabilities?.().accountUnlink !== true) {
      throw failure('lab.gd account unlink is unavailable.', 'sharing-account-unlink-unavailable', 503)
    }
    const projection = this.repository.getInstallationProjection()
    if (!projection?.accountClaimed) {
      throw failure('This installation is not linked to a lab.gd account.', 'installation-account-not-linked', 400)
    }
    const operation = this.repository.prepareAccountUnlink({
      clientAttemptId: command.clientAttemptId,
      remoteIdempotencyKey: this.randomUuid(),
      expectedAccountBindingRevision: projection.accountBindingRevision,
      shareDisposition: command.shareDisposition,
      actorUserId: command.actorUserId ?? null,
    })
    this.onStateChanged(this.repository.getSettings?.() ?? { enrollmentState: 'connected' }, 'sharing.status-changed')
    if (operation.state === 'succeeded' && operation.result) return operation.result
    if (operation.state === 'failed') {
      throw failure('The account unlink request cannot be retried.', operation.lastErrorCode ?? 'sharing-account-unlink-failed', 409)
    }
    let completed
    try {
      const remote = await this.identityService.unlinkAccount({
        idempotencyKey: operation.remoteIdempotencyKey,
        expectedAccountBindingRevision: operation.expectedAccountBindingRevision,
        shareDisposition: operation.shareDisposition,
      })
      completed = this.repository.completeAccountUnlink({
        operationId: operation.id,
        actorUserId: command.actorUserId ?? null,
        result: remote,
      })
    } catch (caught) {
      const { error, code } = normalizeRemoteError(caught)
      if (STABLE_ERRORS.has(code)) this.repository.failAccountUnlink(operation.id, code)
      else this.repository.markAccountUnlinkRetryable(operation.id, code)
      throw error
    }
    this.onStateChanged(completed, 'sharing.status-changed')
    return completed
  }
}
