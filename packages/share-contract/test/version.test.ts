import { describe, expect, it } from 'vitest'

import { SHARE_CONTRACT_VERSION, SUPPORTED_VIEW_SCHEMAS } from '../src'

describe('share contract version', () => {
  it('advertises only the frozen initial views', () => {
    expect(SHARE_CONTRACT_VERSION).toBe(1)
    expect(SUPPORTED_VIEW_SCHEMAS).toEqual({ systems: 1, canvas: 1 })
  })
})
