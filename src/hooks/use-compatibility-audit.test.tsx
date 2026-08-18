import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCompatibilityFindings, useCompatibilitySummary } from './use-compatibility-audit'
import { loadCompatibilityFindings, loadCompatibilitySummary } from '@/lib/compatibility-audit-api'

const live = vi.hoisted(() => ({ onEvent: () => {}, onResync: () => {}, enabled: false, topic: '' }))

vi.mock('@/lib/compatibility-audit-api', () => ({
  loadCompatibilityFindings: vi.fn(async () => ({ projectId: 1, engineVersion: 'v1', findings: [] })),
  loadCompatibilitySummary: vi.fn(async () => ({ projectId: 1, engineVersion: 'v1', hosts: [] })),
  resetCompatibilityAuditCache: vi.fn(),
  setCompatibilityFindingIgnored: vi.fn(),
}))
vi.mock('@/live-events/use-live-event-topic', () => ({
  useLiveEventTopic: vi.fn((input) => Object.assign(live, input)),
}))

afterEach(() => vi.clearAllMocks())

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('compatibility audit queries', () => {
  it('loads once and refreshes through the project compatibility SSE topic', async () => {
    renderHook(() => useCompatibilitySummary(1, true), { wrapper: wrapper() })
    await waitFor(() => expect(loadCompatibilitySummary).toHaveBeenCalledOnce())
    expect(live.topic).toBe('compatibility:1')
    await act(async () => live.onEvent())
    await waitFor(() => expect(loadCompatibilitySummary).toHaveBeenCalledTimes(2))
  })

  it('passes host filters and performs no request while disabled', async () => {
    const rendered = renderHook(({ enabled }) => useCompatibilityFindings(1, {
      classification: 'informational', hostType: 'nas', hostId: 4,
    }, enabled), { wrapper: wrapper(), initialProps: { enabled: false } })
    expect(loadCompatibilityFindings).not.toHaveBeenCalled()
    rendered.rerender({ enabled: true })
    await waitFor(() => expect(loadCompatibilityFindings).toHaveBeenCalledWith(1, {
      classification: 'informational', hostType: 'nas', hostId: 4,
    }))
  })
})
