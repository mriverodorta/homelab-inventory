import { SnapshotService } from './snapshot-service.mjs'

export class CatalogRuntime {
  constructor({ serviceFactory, ...serviceOptions } = {}) {
    this.services = new WeakMap()
    this.serviceFactory = serviceFactory
      ?? ((store) => new SnapshotService(store, serviceOptions))
  }

  forStore(store) {
    const existing = this.services.get(store)
    if (existing) return existing

    const service = this.serviceFactory(store)
    this.services.set(store, service)
    return service
  }

  warm(store) {
    return this.forStore(store).warm()
  }
}
