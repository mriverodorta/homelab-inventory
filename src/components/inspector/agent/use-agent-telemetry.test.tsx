import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadAgentTelemetry } from '@/lib/agent-api'
import { AGENT_TELEMETRY_REFRESH_INTERVAL_MS, useAgentTelemetry } from './use-agent-telemetry'

vi.mock('@/lib/agent-api', () => ({
  loadAgentTelemetry: vi.fn(async () => ({
    host: { hostType: 'server', hostId: 1 },
    serverTime: '2026-08-07T12:00:00.000Z',
    status: { hostType: 'server', hostId: 1, state: 'offline', connected: true, ageMs: 600_000 },
    timing: { heartbeatIntervalMs: 60_000, onlineMaxAgeMs: 90_000, staleMaxAgeMs: 300_000 },
    from: '2026-08-07T11:30:00.000Z',
    to: '2026-08-07T12:00:00.000Z',
    samples: [],
  })),
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('useAgentTelemetry', () => {
  it('refreshes an offline host every minute and stops after unmount', async () => {
    vi.useFakeTimers()
    const rendered = renderHook(() => useAgentTelemetry({
      hostType: 'server',
      hostId: 1,
      enabled: true,
    }), { wrapper: createWrapper() })

    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(loadAgentTelemetry).toHaveBeenCalledTimes(1)

    await act(async () => vi.advanceTimersByTimeAsync(AGENT_TELEMETRY_REFRESH_INTERVAL_MS))
    expect(loadAgentTelemetry).toHaveBeenCalledTimes(2)

    rendered.unmount()
    await act(async () => vi.advanceTimersByTimeAsync(AGENT_TELEMETRY_REFRESH_INTERVAL_MS * 2))
    expect(loadAgentTelemetry).toHaveBeenCalledTimes(2)
  })

  it('does not request telemetry for an unregistered host without saved state', async () => {
    vi.useFakeTimers()
    renderHook(() => useAgentTelemetry({ hostType: 'server', hostId: 1, enabled: false }), { wrapper: createWrapper() })
    await act(async () => vi.advanceTimersByTimeAsync(AGENT_TELEMETRY_REFRESH_INTERVAL_MS))
    expect(loadAgentTelemetry).not.toHaveBeenCalled()
  })
})
