import { describe, expect, it } from 'vitest'
import { shouldShowAttentionTab } from '@/components/inspector/attention/attention-tab-visibility'

describe('Inspector Attention tab visibility', () => {
  it('omits a current zero-finding projection', () => {
    expect(shouldShowAttentionTab({ totalCount: 0, state: 'current' })).toBe(false)
  })

  it('shows findings and non-current projection states', () => {
    expect(shouldShowAttentionTab({ totalCount: 1, state: 'current' })).toBe(true)
    expect(shouldShowAttentionTab({ totalCount: 0, state: 'refreshing' })).toBe(true)
    expect(shouldShowAttentionTab({ totalCount: 0, state: 'failed' })).toBe(true)
  })

  it('shows immediately when a table count requests the tab directly', () => {
    expect(shouldShowAttentionTab(undefined, 'attention')).toBe(true)
  })
})
