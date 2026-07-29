export const DEFAULT_CATALOG_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000

const JITTER_RATIO = 0.1

export function readCatalogRefreshInterval(value = process.env.REGISTRY_REFRESH_INTERVAL_MS) {
  if (value === undefined) return DEFAULT_CATALOG_REFRESH_INTERVAL_MS
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error('REGISTRY_REFRESH_INTERVAL_MS must be zero or a positive safe integer.')
  }
  const interval = Number(value)
  if (!Number.isSafeInteger(interval) || interval < 0) {
    throw new Error('REGISTRY_REFRESH_INTERVAL_MS must be zero or a positive safe integer.')
  }
  return interval
}

export class CatalogRefreshCoordinator {
  constructor({
    store,
    snapshotService,
    intervalMs = DEFAULT_CATALOG_REFRESH_INTERVAL_MS,
    randomFn = Math.random,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    logger = console,
  }) {
    if (!store || !snapshotService) throw new Error('Catalog refresh coordinator requires a store and snapshot service.')
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 0) {
      throw new Error('Catalog refresh interval must be zero or a positive safe integer.')
    }
    this.store = store
    this.snapshotService = snapshotService
    this.intervalMs = intervalMs
    this.randomFn = randomFn
    this.setTimeoutFn = setTimeoutFn
    this.clearTimeoutFn = clearTimeoutFn
    this.logger = logger
    this.automaticActive = false
    this.inFlight = null
    this.timer = null
    this.started = false
    this.stopped = false
  }

  start() {
    if (this.started || this.stopped) return
    this.started = true
    this.reconcileSchedule()
  }

  reconcileSchedule() {
    if (!this.started || this.stopped) return
    const connected = this.store.getRegistryState().settings.mode === 'connected'
    const shouldRunAutomatically = connected && this.intervalMs > 0

    if (!shouldRunAutomatically) {
      this.automaticActive = false
      this.clearTimer()
      return
    }

    if (!this.automaticActive) {
      this.automaticActive = true
      this.clearTimer()
      this.runAutomatic('startup')
      return
    }

    if (!this.inFlight && !this.timer) this.scheduleNext()
  }

  refresh(_reason = 'manual') {
    if (this.stopped) return Promise.resolve(null)
    if (this.inFlight) return this.inFlight

    this.clearTimer()
    let operation
    try {
      operation = Promise.resolve(this.snapshotService.refreshConnected())
    } catch (error) {
      operation = Promise.reject(error)
    }
    this.inFlight = operation
    operation.then(
      () => this.finishRefresh(operation),
      () => this.finishRefresh(operation),
    )
    return operation
  }

  async stop() {
    if (this.stopped) return
    this.stopped = true
    this.automaticActive = false
    this.clearTimer()
    const active = this.inFlight
    if (active) await active.catch(() => null)
  }

  finishRefresh(operation) {
    if (this.inFlight === operation) this.inFlight = null
    if (!this.stopped && this.automaticActive && this.store.getRegistryState().settings.mode === 'connected') {
      this.scheduleNext()
    }
  }

  runAutomatic(reason) {
    void this.refresh(reason).catch((error) => {
      const message = error instanceof Error ? error.message : 'Unknown catalog refresh error.'
      this.logger.warn(`Automatic catalog refresh failed: ${message}`)
    })
  }

  scheduleNext() {
    if (this.timer || this.stopped || !this.automaticActive || this.intervalMs === 0) return
    const random = Math.min(1, Math.max(0, Number(this.randomFn()) || 0))
    const delay = Math.round(this.intervalMs * (1 - JITTER_RATIO + (2 * JITTER_RATIO * random)))
    this.timer = this.setTimeoutFn(() => {
      this.timer = null
      this.runAutomatic('scheduled')
    }, delay)
    this.timer?.unref?.()
  }

  clearTimer() {
    if (!this.timer) return
    this.clearTimeoutFn(this.timer)
    this.timer = null
  }
}
