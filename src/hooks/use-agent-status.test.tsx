import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadAgentStatus } from '@/lib/agent-api'
import { useAgentStatus } from '@/hooks/use-agent-status'

const live = vi.hoisted(() => ({ onEvent: (_event?: unknown) => {}, onResync: () => {}, enabled: false }))

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
  it('merges repeated host deltas without requesting the fleet or losing sparse fields', async () => {
    const upgradeCommands = { linux: 'linux-update', alpine: 'alpine-update', freebsd: 'freebsd-update' }
    const other = { state: 'offline' as const, connected: true, ageMs: 999 }
    vi.mocked(loadAgentStatus).mockResolvedValueOnce({
      hosts: { 'server:1': { state: 'online', connected: true, ageMs: 0, agentVersion: '0.3.4', upgradeCommands }, 'nas:2': other },
      servers: { '1': { state: 'online', connected: true, ageMs: 0, agentVersion: '0.3.4', upgradeCommands } },
      registeredHosts: [{ hostType: 'server', hostId: 1 }], registeredServerIds: [1],
      release: { version: '0.3.4', sourceRevision: 'test' },
    })
    const view = renderHook(() => ({ ...useAgentStatus(true) }), { wrapper: createWrapper() })
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true))
    for (const ageMs of [100, 200, 300]) await act(async () => live.onEvent({
      kind: 'agent.heartbeat', payload: { host: { hostType: 'server', hostId: 1 }, status: {
        hostType: 'server', hostId: 1, state: 'online', connected: true, ageMs, agentVersion: '0.3.4',
      } },
    }))
    await waitFor(() => expect(view.result.current.data?.hosts?.['server:1'].ageMs).toBe(300))
    expect(view.result.current.data?.servers?.['1'].ageMs).toBe(300)
    expect(view.result.current.data?.hosts?.['server:1'].upgradeCommands).toEqual(upgradeCommands)
    expect(view.result.current.data?.hosts?.['nas:2']).toEqual(other)
    expect(view.result.current.data?.registeredServerIds).toEqual([1])
    expect(view.result.current.data?.release?.version).toBe('0.3.4')
    expect(loadAgentStatus).toHaveBeenCalledOnce()
  })

  it.each(['agent.activation', 'agent.registration', 'agent.hardware', 'agent.status'])('refreshes authoritative membership/details for %s', async (kind) => {
    const view = renderHook(() => useAgentStatus(true), { wrapper: createWrapper() })
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true))
    await act(async () => live.onEvent({ kind, payload: { host: { hostType: 'server', hostId: 1 }, status: null } }))
    expect(loadAgentStatus).toHaveBeenCalledTimes(2)
  })

  it('refreshes on cursor resync', async () => {
    const view = renderHook(() => useAgentStatus(true), { wrapper: createWrapper() })
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true))
    await act(async () => live.onResync())
    expect(loadAgentStatus).toHaveBeenCalledTimes(2)
  })

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
    await act(async () => { live.onEvent(); live.onResync() })
    expect(loadAgentStatus).not.toHaveBeenCalled()
  })
})
