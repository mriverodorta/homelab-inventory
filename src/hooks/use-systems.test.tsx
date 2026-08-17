import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SYSTEMS_LIVE_REFRESH_INTERVAL_MS, useSystems } from '@/hooks/use-systems'
import { loadSystems, loadSystemsLive } from '@/lib/systems-api'

vi.mock('@/lib/systems-api', () => ({
  loadSystems: vi.fn(),
  loadSystemsLive: vi.fn(),
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
  it('polls compact live data every 30 seconds after the initial table loads', async () => {
    vi.useFakeTimers()
    vi.mocked(loadSystems).mockResolvedValue({
      projectId: 1,
      generatedAt: '2026-08-17T00:00:00.000Z',
      currentAgentVersion: '0.1.0',
      systems: [{ agentRegistered: true } as never],
    })
    vi.mocked(loadSystemsLive).mockResolvedValue({ projectId: 1, generatedAt: 'now', systems: [] })
    const rendered = renderHook(() => useSystems(1, true), { wrapper: wrapper() })

    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(loadSystems).toHaveBeenCalledOnce()
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(loadSystemsLive).toHaveBeenCalledOnce()
    await act(async () => vi.advanceTimersByTimeAsync(SYSTEMS_LIVE_REFRESH_INTERVAL_MS))
    expect(loadSystemsLive).toHaveBeenCalledTimes(2)
    rendered.unmount()
  })

  it('polls agent-free projects so new enrollment appears without a reload', async () => {
    vi.mocked(loadSystems).mockResolvedValue({ projectId: 1, generatedAt: 'now', currentAgentVersion: null, systems: [] })
    vi.mocked(loadSystemsLive).mockResolvedValue({ projectId: 1, generatedAt: 'now', systems: [] })
    renderHook(() => useSystems(1, true), { wrapper: wrapper() })
    await waitFor(() => expect(loadSystemsLive).toHaveBeenCalledOnce())
  })
})
