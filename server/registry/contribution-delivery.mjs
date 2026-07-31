import { contributionStatus, discoverContributionCandidates } from './contribution-service.mjs'
import { readRegistryJson, registryErrorMessage } from './response-json.mjs'

const BATCH_SIZE = 20
const MAX_LEDGER_RECORDS = 10_000
const BASE_RETRY_MS = 60_000
const MAX_RETRY_MS = 6 * 60 * 60 * 1000

function nextId(records) {
  return records.reduce((maximum, record) => Math.max(maximum, Number(record.id) || 0), 0) + 1
}

function retryAt(attempts, now, random) {
  const exponential = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * (2 ** Math.min(attempts, 8)))
  return new Date(now.getTime() + exponential + Math.floor(random() * Math.min(30_000, exponential / 4))).toISOString()
}

export class ContributionDeliveryService {
  constructor({
    identityService,
    digestHashes = async () => new Set(),
    intervalMs = 60_000,
    random = Math.random,
    logger = console,
  } = {}) {
    this.identityService = identityService
    this.intervalMs = intervalMs
    this.random = random
    this.digestHashes = digestHashes
    this.logger = logger
    this.timer = null
    this.running = null
  }

  async deliver(store, now = new Date(), { explicit = false } = {}) {
    const registry = store.getRegistryState()
    if (
      registry.settings.mode !== 'connected'
      || (!explicit && registry.settings.automaticContributions !== true)
    ) {
      return contributionStatus(store)
    }
    await discoverContributionCandidates(
      store,
      now,
      await this.digestHashes(store),
      { explicit },
    )
    const due = store.getRegistryState().contributionOutbox
      .filter((record) => record.state !== 'delivering' && Date.parse(record.nextAttemptAt) <= now.getTime())
      .slice(0, BATCH_SIZE)
    if (due.length === 0) {
      await this.refreshStatuses(store, now).catch(() => {})
      return contributionStatus(store)
    }
    const dueIds = new Set(due.map((record) => record.id))
    store.registryTransaction((draft) => {
      for (const record of draft.contributionOutbox) {
        if (dueIds.has(record.id)) record.state = 'delivering'
      }
    })
    const body = {
      candidates: due.map(({ identityHash, contentHash, idempotencyKey, payload }) => ({
        identityHash, contentHash, idempotencyKey, payload,
      })),
    }
    try {
      const response = await this.identityService.signedPost(store, '/v1/contributions', body, now)
      const payload = await readRegistryJson(response)
      if (!response.ok || !Array.isArray(payload?.results)) {
        throw new Error(registryErrorMessage(payload, 'Contribution delivery failed', response.status))
      }
      const results = new Map(payload.results.map((result) => [result.contentHash, result.state]))
      store.registryTransaction((draft) => {
        let ledgerId = nextId(draft.contributionLedger)
        const delivered = []
        draft.contributionOutbox = draft.contributionOutbox.filter((record) => {
          if (!dueIds.has(record.id)) return true
          const result = results.get(record.contentHash)
          if (!['quarantined', 'duplicate', 'suppressed'].includes(result)) {
            record.state = 'retrying'
            record.attempts += 1
            record.nextAttemptAt = retryAt(record.attempts, now, this.random)
            record.lastError = 'Registry returned an incomplete contribution result.'
            return true
          }
          delivered.push({
            id: ledgerId++,
            itemType: record.itemType,
            itemId: record.itemId,
            sources: record.sources,
            identityHash: record.identityHash,
            contentHash: record.contentHash,
            idempotencyKey: record.idempotencyKey,
            state: result === 'suppressed' ? 'suppressed' : 'delivered',
            deliveredAt: now.toISOString(),
          })
          return false
        })
        draft.contributionLedger.push(...delivered)
        if (draft.contributionLedger.length > MAX_LEDGER_RECORDS) {
          draft.contributionLedger.splice(0, draft.contributionLedger.length - MAX_LEDGER_RECORDS)
        }
      })
      await this.refreshStatuses(store, now).catch(() => {})
    } catch (error) {
      store.registryTransaction((draft) => {
        for (const record of draft.contributionOutbox) {
          if (!dueIds.has(record.id)) continue
          record.state = 'retrying'
          record.attempts += 1
          record.nextAttemptAt = retryAt(record.attempts, now, this.random)
          record.lastError = error instanceof Error ? error.message : 'Contribution delivery failed.'
        }
      })
    }
    return contributionStatus(store)
  }

  async refreshStatuses(store, now = new Date()) {
    const hashes = store.getRegistryState().contributionLedger
      .filter((record) => record.state === 'delivered')
      .slice(-100)
      .map((record) => record.contentHash)
    if (hashes.length === 0) return
    const response = await this.identityService.signedPost(store, '/v1/contributions/status', { contentHashes: hashes }, now)
    const payload = await readRegistryJson(response).catch(() => null)
    if (!response.ok || !Array.isArray(payload?.statuses)) return
    const statuses = new Map(payload.statuses.map((status) => [status.contentHash, status.state]))
    store.registryTransaction((draft) => {
      for (const record of draft.contributionLedger) {
        const state = statuses.get(record.contentHash)
        if (state === 'accepted' || state === 'published') record.state = 'accepted'
        if (state === 'rejected') record.state = 'rejected'
        if (state === 'suppressed') record.state = 'suppressed'
      }
    })
  }

  trigger(store, { explicit = false } = {}) {
    const registry = store.getRegistryState()
    if (
      registry.settings.mode !== 'connected'
      || (!explicit && registry.settings.automaticContributions !== true)
    ) {
      return Promise.resolve(contributionStatus(store))
    }
    if (!this.running) {
      this.running = this.deliver(store, new Date(), { explicit }).finally(() => { this.running = null })
    }
    return this.running
  }

  async waitForIdle() {
    if (this.running) await this.running.catch(() => {})
  }

  triggerInBackground(store) {
    void this.trigger(store).catch((error) => {
      this.logger.error(
        '[registry] Automatic contribution delivery failed.',
        error instanceof Error ? error.message : error,
      )
    })
  }

  start(store) {
    if (this.timer) return
    this.timer = setInterval(() => this.triggerInBackground(store), this.intervalMs)
    this.timer.unref?.()
    this.triggerInBackground(store)
  }

  async stop(store) {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    await this.waitForIdle()
    await store.flush(['registry'])
  }
}
