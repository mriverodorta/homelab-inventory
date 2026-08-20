import { describe, expect, it } from 'vitest'

import { classifyShareField } from '../src'

describe('share privacy classification', () => {
  it('classifies forbidden, opt-in, and safe fields', () => {
    expect(classifyShareField('serialNumber')).toBe('forbidden')
    expect(classifyShareField('ipAddress')).toBe('forbidden')
    expect(classifyShareField('tags')).toBe('explicit-opt-in')
    expect(classifyShareField('customFields')).toBe('explicit-opt-in')
    expect(classifyShareField('name')).toBe('safe-default')
  })
})
