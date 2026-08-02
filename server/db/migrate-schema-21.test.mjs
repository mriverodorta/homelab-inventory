import { describe, expect, it } from 'vitest'
import { createAuthenticationStore } from '../auth/model.mjs'
import { migrateSchema20To21 } from './migrate-schema-21.mjs'

describe('schema 21 authentication migration', () => {
  it('keeps existing installations accessible after upgrade', () => {
    const result = migrateSchema20To21(null)
    expect(result.authentication.configuration.enabled).toBe(false)
    expect(result.authentication.bootstrapState.setupRequired).toBe(false)
    expect(result.summary).toEqual({ initializedAuthentication: true, authenticationEnabled: false })
  })

  it('preserves a previously initialized store', () => {
    const store = createAuthenticationStore({ setupRequired: true })
    const result = migrateSchema20To21(store)
    expect(result.authentication).toBe(store)
    expect(result.summary.initializedAuthentication).toBe(false)
  })
})
