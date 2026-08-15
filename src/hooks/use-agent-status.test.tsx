import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadAgentStatus } from '@/lib/agent-api'
import { AGENT_STATUS_REFRESH_INTERVAL_MS, useAgentStatus } from '@/hooks/use-agent-status'

vi.mock('@/lib/agent-api', () => ({
  loadAgentStatus: vi.fn(async () => ({ hosts: {}, registeredHosts: [] })),
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('useAgentStatus', () => {
  it('polls the compact fleet status at the one-minute heartbeat cadence', async () => {
    vi.useFakeTimers()
    const rendered = renderHook(() => useAgentStatus(true), { wrapper: createWrapper() })

    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(loadAgentStatus).toHaveBeenCalledTimes(1)
    await act(async () => vi.advanceTimersByTimeAsync(AGENT_STATUS_REFRESH_INTERVAL_MS))
    expect(loadAgentStatus).toHaveBeenCalledTimes(2)

    rendered.unmount()
  })

  it('pauses interval polling while the document is hidden', async () => {
    vi.useFakeTimers()
    let visibility: DocumentVisibilityState = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    const rendered = renderHook(() => useAgentStatus(true), { wrapper: createWrapper() })

    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(loadAgentStatus).toHaveBeenCalledTimes(1)
    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    await act(async () => vi.advanceTimersByTimeAsync(AGENT_STATUS_REFRESH_INTERVAL_MS * 2))
    expect(loadAgentStatus).toHaveBeenCalledTimes(1)

    rendered.unmount()
  })
})
