import { describe, expect, it } from 'vitest'
import { canonicalDateFilterValue, dateTimeInputValue } from './inventory-metadata-filter-model'

describe('inventory metadata date filters', () => {
  it('stores date-time boundaries as canonical UTC timestamps', () => {
    const local = '2026-08-19T14:30'
    const canonical = canonicalDateFilterValue(local, true)
    expect(canonical).toBe(new Date(local).toISOString())
    expect(dateTimeInputValue(canonical)).toBe(local)
  })

  it('preserves date-only boundaries and empty values', () => {
    expect(canonicalDateFilterValue('2026-08-19', false)).toBe('2026-08-19')
    expect(canonicalDateFilterValue('', true)).toBeNull()
  })
})
