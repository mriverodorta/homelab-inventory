import { describe, expect, it } from 'vitest'
import { browserPreferenceScope } from '@/lib/browser-preference-scope'

describe('browserPreferenceScope', () => {
  it('uses stable relational identifiers without personal account fields', () => {
    expect(browserPreferenceScope(7, 2, 11)).toBe('account:7:project:2:workspace:11')
    expect(browserPreferenceScope(null, 2, 11)).toBe('device:anonymous:project:2:workspace:11')
  })

  it('supports project-level preferences and safe fallbacks', () => {
    expect(browserPreferenceScope(7, 2)).toBe('account:7:project:2')
    expect(browserPreferenceScope(-1, 0, -3)).toBe('device:anonymous:project:1')
  })
})
