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
  it('refreshes compact live data after a Systems event', async () => {
    vi.mocked(loadSystems).mockResolvedValue({
      projectId: 1,
      generatedAt: '2026-08-17T00:00:00.000Z',
      currentAgentVersion: '0.1.0',
      systems: [{ agentRegistered: true } as never],
    })
    vi.mocked(loadSystemsLive).mockResolvedValue({ projectId: 1, generatedAt: 'now', systems: [] })
    const rendered = renderHook(() => useSystems(1, true), { wrapper: wrapper() })

    await waitFor(() => expect(loadSystemsLive).toHaveBeenCalledOnce())
    await act(async () => live.onEvent({ kind: 'agent.heartbeat' }))
    expect(loadSystemsLive).toHaveBeenCalledTimes(2)
    expect(loadSystems).toHaveBeenCalledOnce()
    rendered.unmount()
  })

  it('subscribes agent-free projects so new enrollment appears without polling', async () => {
    vi.mocked(loadSystems).mockResolvedValue({ projectId: 1, generatedAt: 'now', currentAgentVersion: null, systems: [] })
    vi.mocked(loadSystemsLive).mockResolvedValue({ projectId: 1, generatedAt: 'now', systems: [] })
    renderHook(() => useSystems(1, true), { wrapper: wrapper() })
    await waitFor(() => expect(loadSystemsLive).toHaveBeenCalledOnce())
    expect(live.enabled).toBe(true)
  })

  it('refreshes static agent fields when runtime state is cleared', async () => {
    vi.mocked(loadSystems).mockResolvedValue({ projectId: 1, generatedAt: 'now', currentAgentVersion: null, systems: [] })
    vi.mocked(loadSystemsLive).mockResolvedValue({ projectId: 1, generatedAt: 'now', systems: [] })
    renderHook(() => useSystems(1, true), { wrapper: wrapper() })
    await waitFor(() => expect(loadSystemsLive).toHaveBeenCalledOnce())
    await act(async () => live.onEvent({ kind: 'agent.status' }))
    expect(loadSystems).toHaveBeenCalledTimes(2)
  })
})
