import { describe, expect, it } from 'vitest'
import { assertPasswordPolicy, normalizeUsername } from './passwords.mjs'

describe('local authentication password policy', () => {
  it('rejects short and common passwords', () => {
    expect(() => assertPasswordPolicy('short')).toThrow(/12 characters/)
    expect(() => assertPasswordPolicy('Password1234')).toThrow(/commonly used/)
  })

  it('normalizes usernames and rejects unsafe values', () => {
    expect(normalizeUsername('  Owner.Admin ')).toBe('owner.admin')
    expect(() => normalizeUsername('../owner')).toThrow(/Username/)
  })
})
