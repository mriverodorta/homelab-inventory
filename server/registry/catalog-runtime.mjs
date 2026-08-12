import { SnapshotService } from './snapshot-service.mjs'
import { CatalogAvailability } from './catalog-availability.mjs'

export class CatalogRuntime {
  constructor({ serviceFactory, ...serviceOptions } = {}) {
    this.entries = new WeakMap()
    this.serviceFactory = serviceFactory
      ?? ((store) => new SnapshotService(store, serviceOptions))
  }

  forStore(store) {
    const existing = this.entries.get(store)
    if (existing) return existing.service

    const service = this.serviceFactory(store)
    this.entries.set(store, {
      service,
      availability: new CatalogAvailability(),
      startPromise: null,
      recoveryPromise: null,
      requestService: null,
    })
    return service
  }

  entry(store) {
    this.forStore(store)
    return this.entries.get(store)
  }

  warm(store, options) {
    return this.forStore(store).warm(options)
  }

  state(store) {
    return this.entry(store).availability.snapshot()
  }

  async start(store) {
    const entry = this.entry(store)
    if (entry.startPromise) return entry.startPromise
    entry.availability.transition('verifying')
    entry.startPromise = (async () => {
      try {
        const facets = await entry.service.warm({ allowRecovery: false })
        entry.availability.transition(facets.available === false ? 'unavailable' : 'ready')
      } catch {
        entry.availability.transition('recovering')
      }
    })()
    return entry.startPromise
  }

  resumeRecovery(store) {
    const entry = this.entry(store)
    if (entry.availability.state !== 'recovering') return null
    return this.recover(store)
  }

  recover(store) {
    const entry = this.entry(store)
    if (entry.recoveryPromise) return entry.recoveryPromise
    entry.availability.transition('recovering')
    entry.recoveryPromise = Promise.resolve()
      .then(() => entry.service.recover())
      .then((facets) => {
        entry.availability.transition(facets.available === false ? 'unavailable' : 'ready')
        return facets
      })
      .catch((error) => {
        entry.availability.transition('unavailable', error)
        return null
      })
      .finally(() => {
        entry.recoveryPromise = null
      })
    return entry.recoveryPromise
  }

  forRequest(store) {
    const entry = this.entry(store)
    if (entry.requestService) return entry.requestService
    const readable = (method) => (...parameters) => {
      entry.availability.assertReadable()
      return entry.service[method](...parameters)
    }
    const activating = (method) => async (...parameters) => {
      if (entry.availability.state === 'recovering') await this.recover(store)
      const result = await entry.service[method](...parameters)
      const facets = await entry.service.warm({ allowRecovery: false })
      entry.availability.transition(facets.available === false ? 'unavailable' : 'ready')
      return result
    }
    entry.requestService = {
      search: readable('search'),
      facets: readable('facets'),
      template: readable('template'),
      activate: activating('activate'),
      refreshConnected: activating('refreshConnected'),
    }
    return entry.requestService
  }
}
