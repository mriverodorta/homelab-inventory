import { describe, expect, it } from 'vitest'
import { resolveCreatedConnectionSelection } from '@/lib/created-connection-selection'
import type { ConnectionEndpoint } from '@/types/inventory'

const traceEndpoint: ConnectionEndpoint = {
  itemId: 'server:1',
  portId: 1,
}

describe('created connection selection policy', () => {
  it('preserves the current workspace selection when automatic opening is disabled', () => {
    const current = {
      selectedItemId: 'server:1',
      selectedConnectionId: null,
      activeNetworkTraceEndpoint: traceEndpoint,
    }

    expect(resolveCreatedConnectionSelection(current, 12, false)).toBe(current)
  })

  it('selects the new connection and clears item and trace selection when enabled', () => {
    expect(resolveCreatedConnectionSelection({
      selectedItemId: 'server:1',
      selectedConnectionId: 4,
      activeNetworkTraceEndpoint: traceEndpoint,
    }, 12, true)).toEqual({
      selectedItemId: null,
      selectedConnectionId: 12,
      activeNetworkTraceEndpoint: null,
    })
  })
})
