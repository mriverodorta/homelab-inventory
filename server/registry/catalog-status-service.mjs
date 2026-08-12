import { readRegistryJson, registryErrorMessage } from './response-json.mjs'

export const DEFAULT_CATALOG_STATUS_INTERVAL_MS = 6 * 60 * 60 * 1000

const RETRY_DELAYS_MS = [2_000, 10_000]

function positiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0
}

function wait(delay) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, delay)
    timer?.unref?.()
  })
}

export class CatalogStatusService {
  constructor({
    store,
    identityService,
    applicationVersion,
    applicationCatalogContractVersion,
    intervalMs = DEFAULT_CATALOG_STATUS_INTERVAL_MS,
    now = () => new Date(),
    waitFn = wait,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    logger = console,
  }) {
    if (!store || !identityService) throw new Error('Catalog status service requires a store and installation identity.')
    if (typeof applicationVersion !== 'string' || applicationVersion.trim().length === 0 || applicationVersion.length > 80) {
      throw new Error('Catalog status service requires a valid application version.')
    }
    if (!positiveSafeInteger(applicationCatalogContractVersion)) {
      throw new Error('Catalog status service requires a valid application catalog contract version.')
    }
    if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
      throw new Error('Catalog status interval must be a positive safe integer.')
    }
    this.store = store
    this.identityService = identityService
    this.applicationVersion = applicationVersion.trim()
    this.applicationCatalogContractVersion = applicationCatalogContractVersion
    this.intervalMs = intervalMs
    this.now = now
    this.waitFn = waitFn
    this.setTimeoutFn = setTimeoutFn
    this.clearTimeoutFn = clearTimeoutFn
    this.logger = logger
    this.inFlight = null
    this.timer = null
    this.started = false
    this.stopped = false
  }

  eligible() {
    const registry = this.store.getRegistryState()
    return registry.settings.mode === 'connected'
      && registry.installationIdentity?.state === 'active'
      && positiveSafeInteger(registry.snapshot?.revision)
  }

  start() {
    if (this.started || this.stopped) return
    this.started = true
    void this.trigger('startup')
    this.scheduleNext()
  }

  trigger(_reason = 'manual') {
    if (this.stopped || !this.eligible()) return Promise.resolve(null)
    if (this.inFlight) return this.inFlight
    const operation = this.checkIn().catch((error) => {
      this.logger.warn(`Registry catalog status check-in failed: ${error instanceof Error ? error.message : 'Unknown error.'}`)
      return null
    })
    const tracked = operation.finally(() => {
      if (this.inFlight === tracked) this.inFlight = null
    })
    this.inFlight = tracked
    return tracked
  }

  async checkIn() {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      const now = this.now()
      const revision = this.store.getRegistryState().snapshot?.revision
      if (!positiveSafeInteger(revision)) return null
      const body = {
        applicationVersion: this.applicationVersion,
        applicationCatalogContractVersion: this.applicationCatalogContractVersion,
        activeCatalogRevision: revision,
        reportedAt: now.toISOString(),
      }
      let response
      try {
        response = await this.identityService.signedPost(
          this.store,
          '/v1/installations/catalog-status',
          body,
          now,
        )
      } catch (error) {
        if (attempt === RETRY_DELAYS_MS.length) throw error
        await this.waitFn(RETRY_DELAYS_MS[attempt])
        continue
      }
      const payload = await readRegistryJson(response)
      if (response.ok) {
        if (
          !['current', 'behind'].includes(payload?.state)
          || !positiveSafeInteger(payload?.currentCatalogRevision)
          || typeof payload?.recorded !== 'boolean'
        ) throw new Error('Registry returned an invalid catalog status response.')
        return payload
      }
      if (response.status === 401) {
        this.store.registryTransaction((draft) => {
          if (draft.installationIdentity) {
            draft.installationIdentity.state = 'recovery-pending'
            draft.installationIdentity.lastError = 'Registry installation credentials require owner recovery.'
          }
          draft.settings.automaticContributions = false
          draft.settings.updatedAt = now.toISOString()
        })
        throw new Error('Registry installation credentials require owner recovery.')
      }
      if (response.status === 429) return { deferred: true }
      if (response.status >= 500 && attempt < RETRY_DELAYS_MS.length) {
        await this.waitFn(RETRY_DELAYS_MS[attempt])
        continue
      }
      throw new Error(registryErrorMessage(payload, 'Registry catalog status check-in failed', response.status))
    }
    return null
  }

  scheduleNext() {
    if (this.timer || this.stopped || !this.started) return
    this.timer = this.setTimeoutFn(() => {
      this.timer = null
      void this.trigger('scheduled')
      this.scheduleNext()
    }, this.intervalMs)
    this.timer?.unref?.()
  }

  async stop() {
    if (this.stopped) return
    this.stopped = true
    if (this.timer) this.clearTimeoutFn(this.timer)
    this.timer = null
    await this.inFlight?.catch(() => null)
  }
}
