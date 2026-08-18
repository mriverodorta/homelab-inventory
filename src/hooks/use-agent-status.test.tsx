import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadAgentStatus } from '@/lib/agent-api'
import { useAgentStatus } from '@/hooks/use-agent-status'

const live = vi.hoisted(() => ({ onEvent: () => {}, onResync: () => {}, enabled: false }))

vi.mock('@/lib/agent-api', () => ({
  loadAgentStatus: vi.fn(async () => ({ hosts: {}, registeredHosts: [] })),
}))
vi.mock('@/live-events/use-live-event-topic', () => ({
  useLiveEventTopic: vi.fn((input) => Object.assign(live, input)),
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
  it('refreshes compact fleet status only after a live event', async () => {
    const rendered = renderHook(() => useAgentStatus(true), { wrapper: createWrapper() })
    await waitFor(() => expect(loadAgentStatus).toHaveBeenCalledTimes(1))
    await act(async () => live.onEvent())
    expect(loadAgentStatus).toHaveBeenCalledTimes(2)
    rendered.unmount()
  })

  it('does not subscribe or request while disabled', async () => {
    renderHook(() => useAgentStatus(false), { wrapper: createWrapper() })
    expect(live.enabled).toBe(false)
    expect(loadAgentStatus).not.toHaveBeenCalled()
  })
})
