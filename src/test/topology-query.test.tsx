import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { DomainEngineClient } from '@/engine/client'
import { DomainEngineContext } from '@/engine/react-context'
import { createTopologyQueryFingerprint, useTopologyQuery } from '@/hooks/use-topology-query'
import type { ProjectState } from '@/types/inventory'

const project: ProjectState = {
  id: 'default',
  revision: 7,
  metadata: { name: 'Topology', version: 1, updatedAt: '2026-07-22T00:00:00.000Z' },
  items: {},
  placements: [],
  assignments: [],
  connections: [],
}

describe('topology query coordinator', () => {
  it('ignores placement coordinates and project metadata but tracks placement membership', () => {
    const placed = {
      ...project,
      placements: [{ serverId: 'server:1', x: 120, y: 240 }],
    }
    const moved = {
      ...placed,
      revision: 8,
      metadata: { ...placed.metadata, name: 'Renamed', updatedAt: '2026-07-23T00:00:00.000Z' },
      placements: [{ serverId: 'server:1', x: 108, y: 240 }],
    }
    const added = {
      ...moved,
      placements: [...moved.placements, { serverId: 'switch:1', x: 480, y: 120 }],
    }

    expect(createTopologyQueryFingerprint(moved)).toBe(createTopologyQueryFingerprint(placed))
    expect(createTopologyQueryFingerprint(added)).not.toBe(createTopologyQueryFingerprint(placed))
  })

  it('coalesces revision topology reads and does not repeat them for unrelated rerenders', async () => {
    const queryConsistent = vi.fn(async (request: { operation: { kind: string } }) => {
      if (request.operation.kind === 'topology-endpoints') {
        return { result: { kind: 'topology-endpoints', payload: { endpoints: [] } } }
      }
      if (request.operation.kind === 'network-traces') {
        return { result: { kind: 'network-traces', payload: { traces: [] } } }
      }
      if (request.operation.kind === 'power-topology') {
        return {
          result: {
            kind: 'power-topology',
            payload: { topology: { endpoints: [], findings: [] } },
          },
        }
      }
      return {
        result: {
          kind: 'connection-derived-states',
          payload: { states: [] },
        },
      }
    })
    const client = { queryConsistent } as unknown as DomainEngineClient
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          <DomainEngineContext.Provider value={{
            enabled: true,
            client,
            state: { phase: 'ready', revision: 7 },
            syncEvent: null,
            retry: async () => {},
          }}>
            {children}
          </DomainEngineContext.Provider>
        </QueryClientProvider>
      )
    }

    const { result, rerender } = renderHook(() => useTopologyQuery(project), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.data).not.toBeNull())
    expect(queryConsistent).toHaveBeenCalledTimes(4)

    const firstData = result.current.data
    rerender()

    expect(result.current.data).toBe(firstData)
    expect(queryConsistent).toHaveBeenCalledTimes(4)
  })
})
