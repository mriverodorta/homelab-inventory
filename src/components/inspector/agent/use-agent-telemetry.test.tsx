import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadAgentTelemetry } from '@/lib/agent-api'
import { useAgentTelemetry } from './use-agent-telemetry'

const live = vi.hoisted(() => ({ onEvent: (_event?: unknown) => {}, onResync: () => {}, enabled: false, topic: '' }))

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
  it('merges a heartbeat event without reloading the telemetry snapshot', async () => {
    const rendered = renderHook(() => useAgentTelemetry({
      hostType: 'server',
      hostId: 1,
      enabled: true,
    }), { wrapper: createWrapper() })

    await waitFor(() => expect(loadAgentTelemetry).toHaveBeenCalledTimes(1))
    expect(live.topic).toBe('agent-telemetry:server:1')
    await act(async () => live.onEvent({
      occurredAt: '2026-08-07T12:01:00.000Z',
      payload: {
        mode: 'delta',
        status: { state: 'online', connected: true, ageMs: 0 },
        telemetry: {
          version: 1,
          sequence: 2,
          receivedAt: '2026-08-07T12:01:00.000Z',
          collectedAt: '2026-08-07T12:00:59.000Z',
          agentVersion: '0.3.3',
          metricBucket: { at: '2026-08-07T12:01:00.000Z', received: true, metrics: { cpu: { percent: 14 }, memory: { usedPercent: 30 } } },
          runtime: { uptimeSeconds: 60, loadAverage: [0.1, 0.2, 0.3], memory: { totalBytes: 100 } },
          families: [],
        },
      },
    }))
    expect(loadAgentTelemetry).toHaveBeenCalledOnce()
    await waitFor(() => expect(rendered.result.current.data?.status.state).toBe('online'))
    expect(rendered.result.current.data?.metricBuckets.at(-1)?.metrics?.cpu?.percent).toBe(14)
    rendered.unmount()
  })

  it('reloads once when an SSE event explicitly requires recovery', async () => {
    renderHook(() => useAgentTelemetry({ hostType: 'server', hostId: 1, enabled: true }), { wrapper: createWrapper() })
    await waitFor(() => expect(loadAgentTelemetry).toHaveBeenCalledOnce())
    await act(async () => live.onEvent({ occurredAt: 'now', payload: { mode: 'resync-required' } }))
    expect(loadAgentTelemetry).toHaveBeenCalledTimes(2)
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
