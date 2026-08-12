import { describe, expect, it } from 'bun:test'
import { CatalogAvailability, CatalogAvailabilityError } from './catalog-availability.mjs'

describe('catalog availability', () => {
  it('blocks reads while verifying or recovering with a stable public error', () => {
    const availability = new CatalogAvailability()
    for (const state of ['verifying', 'recovering']) {
      availability.transition(state)
      expect(() => availability.assertReadable()).toThrow(CatalogAvailabilityError)
      try {
        availability.assertReadable()
      } catch (error) {
        expect(error).toMatchObject({ code: 'catalog-initializing', status: 503 })
      }
    }
  })

  it('allows an empty unavailable catalog but blocks a failed recovery without leaking details', () => {
    const availability = new CatalogAvailability()
    expect(() => availability.assertReadable()).not.toThrow()
    availability.transition('unavailable', new Error('/private/data/catalog.sqlite is corrupt'))
    expect(availability.snapshot()).toEqual({
      state: 'unavailable',
      available: false,
      recovering: false,
      error: 'Catalog verification failed.',
    })
    try {
      availability.assertReadable()
    } catch (error) {
      expect(error).toMatchObject({ message: 'Catalog is temporarily unavailable.', code: 'catalog-unavailable' })
      expect(error.message).not.toContain('/private/data')
    }
  })
})
