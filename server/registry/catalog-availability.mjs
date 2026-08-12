export class CatalogAvailabilityError extends Error {
  constructor(message, { code, status = 503 } = {}) {
    super(message)
    this.name = 'CatalogAvailabilityError'
    this.code = code
    this.status = status
  }
}

export class CatalogAvailability {
  constructor() {
    this.state = 'unavailable'
    this.error = null
  }

  transition(state, error = null) {
    if (!['unavailable', 'verifying', 'ready', 'recovering'].includes(state)) {
      throw new Error(`Unsupported catalog availability state: ${state}`)
    }
    this.state = state
    this.error = error instanceof Error ? error : null
  }

  assertReadable() {
    if (this.state === 'verifying' || this.state === 'recovering') {
      throw new CatalogAvailabilityError('Catalog is being verified. Try again shortly.', {
        code: 'catalog-initializing',
      })
    }
    if (this.state === 'unavailable' && this.error) {
      throw new CatalogAvailabilityError('Catalog is temporarily unavailable.', {
        code: 'catalog-unavailable',
      })
    }
  }

  snapshot() {
    return {
      state: this.state,
      available: this.state === 'ready',
      recovering: this.state === 'recovering',
      error: this.error ? 'Catalog verification failed.' : null,
    }
  }
}
