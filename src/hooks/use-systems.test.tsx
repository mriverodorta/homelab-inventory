import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSystems } from '@/hooks/use-systems'
import { loadSystems, loadSystemsLive } from '@/lib/systems-api'

vi.mock('@/lib/systems-api', () => ({
  loadSystems: vi.fn(),
  loadSystemsLive: vi.fn(),
}))
const live = vi.hoisted(() => ({ onEvent: (_event?: unknown) => {}, onResync: () => {}, enabled: false }))
vi.mock('@/live-events/use-live-event-topic', () => ({
  useLiveEventTopic: vi.fn((input) => Object.assign(live, input)),
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('useSystems', () => {
  it('patches compact live data from a Systems event without another request', async () => {
    vi.mocked(loadSystems).mockResolvedValue({
      projectId: 1,
      generatedAt: '2026-08-17T00:00:00.000Z',
      currentAgentVersion: '0.1.0',
      systems: [{ itemId: 1, agentRegistered: true } as never],
    })
    vi.mocked(loadSystemsLive).mockResolvedValue({ projectId: 1, generatedAt: 'now', systems: [] })
    const rendered = renderHook(() => useSystems(1, true), { wrapper: wrapper() })

    await waitFor(() => expect(live.enabled).toBe(true))
    await act(async () => live.onEvent({
      kind: 'agent.heartbeat',
      occurredAt: '2026-08-18T14:00:00.000Z',
      payload: { system: { itemId: 1, agentRegistered: true, agentState: 'online', cpuPercent: 42 } },
    }))
    expect(loadSystemsLive).not.toHaveBeenCalled()
    await waitFor(() => expect(rendered.result.current.live.data?.systems[0]).toMatchObject({ itemId: 1, cpuPercent: 42 }))
    expect(loadSystems).toHaveBeenCalledOnce()
    rendered.unmount()
  })

  it('subscribes agent-free projects so new enrollment appears without polling', async () => {
    vi.mocked(loadSystems).mockResolvedValue({ projectId: 1, generatedAt: 'now', currentAgentVersion: null, systems: [] })
    vi.mocked(loadSystemsLive).mockResolvedValue({ projectId: 1, generatedAt: 'now', systems: [] })
    renderHook(() => useSystems(1, true), { wrapper: wrapper() })
    await waitFor(() => expect(live.enabled).toBe(true))
    expect(loadSystemsLive).not.toHaveBeenCalled()
  })

  it('resynchronizes snapshots only when the SSE cursor reports a gap', async () => {
    vi.mocked(loadSystems).mockResolvedValue({ projectId: 1, generatedAt: 'now', currentAgentVersion: null, systems: [] })
    vi.mocked(loadSystemsLive).mockResolvedValue({ projectId: 1, generatedAt: 'now', systems: [] })
    renderHook(() => useSystems(1, true), { wrapper: wrapper() })
    await waitFor(() => expect(loadSystems).toHaveBeenCalledOnce())
    await act(async () => live.onResync())
    expect(loadSystems).toHaveBeenCalledTimes(2)
    expect(loadSystemsLive).toHaveBeenCalledOnce()
  })
})
