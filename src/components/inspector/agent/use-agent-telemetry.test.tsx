import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadAgentTelemetry } from '@/lib/agent-api'
import { useAgentTelemetry } from './use-agent-telemetry'

const live = vi.hoisted(() => ({ onEvent: () => {}, onResync: () => {}, enabled: false, topic: '' }))

vi.mock('@/lib/agent-api', () => ({
  loadAgentTelemetry: vi.fn(async () => ({
    host: { hostType: 'server', hostId: 1 },
    serverTime: '2026-08-07T12:00:00.000Z',
    status: { hostType: 'server', hostId: 1, state: 'offline', connected: true, ageMs: 600_000 },
    timing: { heartbeatIntervalMs: 60_000, onlineMaxAgeMs: 90_000, staleMaxAgeMs: 300_000 },
    from: '2026-08-07T11:30:00.000Z',
    to: '2026-08-07T12:00:00.000Z',
    heartbeatBuckets: [],
    metricBuckets: [],
    latest: null,
  })),
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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('useAgentTelemetry', () => {
  it('refreshes an offline host after its live event and stops after unmount', async () => {
    const rendered = renderHook(() => useAgentTelemetry({
      hostType: 'server',
      hostId: 1,
      enabled: true,
    }), { wrapper: createWrapper() })

    await waitFor(() => expect(loadAgentTelemetry).toHaveBeenCalledTimes(1))
    expect(live.topic).toBe('agent-telemetry:server:1')
    await act(async () => live.onEvent())
    expect(loadAgentTelemetry).toHaveBeenCalledTimes(2)
    rendered.unmount()
  })

  it('does not request telemetry for an unregistered host without saved state', async () => {
    renderHook(() => useAgentTelemetry({ hostType: 'server', hostId: 1, enabled: false }), { wrapper: createWrapper() })
    expect(loadAgentTelemetry).not.toHaveBeenCalled()
    expect(live.enabled).toBe(false)
  })

  it('shares one selected-host request across multiple inspector consumers', async () => {
    renderHook(() => ({
      agent: useAgentTelemetry({ hostType: 'server', hostId: 1, enabled: true }),
      services: useAgentTelemetry({ hostType: 'server', hostId: 1, enabled: true }),
      containers: useAgentTelemetry({ hostType: 'server', hostId: 1, enabled: true }),
    }), { wrapper: createWrapper() })

    await waitFor(() => expect(loadAgentTelemetry).toHaveBeenCalledOnce())
  })

  it('uses a host-scoped topic', () => {
    renderHook(() => useAgentTelemetry({ hostType: 'nas', hostId: 4, enabled: true }), { wrapper: createWrapper() })
    expect(live.topic).toBe('agent-telemetry:nas:4')
  })
})
