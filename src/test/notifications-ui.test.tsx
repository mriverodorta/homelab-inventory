import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HostNotificationSettings } from '@/components/inspector/agent/host-notification-settings'
import { NotificationCenter } from '@/components/notifications/notification-center'
import { NotificationSettings } from '@/components/settings/notifications/notification-settings'
import { renderWithOpenAuth as render } from '@/test/open-auth-test-render'
import type { AgentHostStatus } from '@/types/agent'
import type { NotificationSnapshot } from '@/types/notifications'

const mocks = vi.hoisted(() => ({
  snapshot: null as NotificationSnapshot | null,
  incidents: null as unknown,
  settings: vi.fn(),
  updateHost: vi.fn(),
  acknowledge: vi.fn(),
  retry: vi.fn(),
  fetchNextPage: vi.fn(),
  hasNextPage: false,
}))

function mutation(mutate = vi.fn()) {
  return { mutate, mutateAsync: vi.fn(), isPending: false, isError: false, error: null }
}

vi.mock('@/hooks/use-notifications', () => ({
  useNotificationSnapshot: () => ({ data: mocks.snapshot, isLoading: false, isError: false, error: null }),
  useNotificationIncidents: () => ({
    data: { pages: [mocks.incidents], pageParams: [0] },
    isLoading: false,
    isError: false,
    error: null,
    hasNextPage: mocks.hasNextPage,
    isFetchingNextPage: false,
    fetchNextPage: mocks.fetchNextPage,
  }),
  useNotificationMutations: () => ({
    settings: mutation(mocks.settings),
    createContact: mutation(),
    updateContact: mutation(),
    deleteContact: mutation(),
    testContact: mutation(),
    updateRule: mutation(),
    createQuietHours: mutation(),
    updateQuietHours: mutation(),
    deleteQuietHours: mutation(),
    updateHost: mutation(mocks.updateHost),
    acknowledge: mutation(mocks.acknowledge),
    retry: mutation(mocks.retry),
  }),
}))

function snapshot(overrides: Partial<NotificationSnapshot['config']> = {}): NotificationSnapshot {
  return {
    available: true,
    config: {
      revision: 4,
      enabled: false,
      contactPoints: [],
      rules: [],
      quietHours: [],
      hostOverrides: [],
      monitoredResources: [],
      retention: { incidentDays: 90, deliveryAttemptDays: 30 },
      ...overrides,
    },
    summary: { active: 0, unacknowledged: 0, exhaustedDeliveries: 0 },
  }
}

beforeEach(() => {
  mocks.snapshot = snapshot()
  mocks.incidents = { incidents: [], deliveries: [], total: 0 }
  mocks.settings.mockReset()
  mocks.updateHost.mockReset()
  mocks.acknowledge.mockReset()
  mocks.retry.mockReset()
  mocks.fetchNextPage.mockReset()
  mocks.hasNextPage = false
})

describe('notification UI', () => {
  it('keeps notification delivery opt-in and sends the current revision', () => {
    render(<NotificationSettings />)

    fireEvent.click(screen.getByRole('switch', { name: 'Enable notifications' }))

    expect(mocks.settings).toHaveBeenCalledWith({ expectedRevision: 4, enabled: true })
    expect(screen.getByRole('tab', { name: 'Contact Points' })).toBeInTheDocument()
    expect(screen.getByText('No destinations configured')).toBeInTheDocument()
  })

  it('acknowledges active incidents and retries exhausted deliveries', () => {
    mocks.incidents = {
      total: 1,
      incidents: [{
        id: 9,
        hostType: 'server',
        hostId: 7,
        resourceId: null,
        eventType: 'host.offline',
        severity: 'critical',
        title: 'Skywatch is offline',
        summary: 'Last heartbeat was five minutes ago.',
        state: 'open',
        openedAt: new Date().toISOString(),
        resolvedAt: null,
        acknowledgedAt: null,
        acknowledgedBy: null,
        notificationDeliveredAt: new Date().toISOString(),
      }],
      deliveries: [{
        id: 12,
        incidentId: 9,
        contactPointId: 1,
        kind: 'opening',
        state: 'exhausted',
        attempts: 6,
        availableAt: new Date().toISOString(),
        deliveredAt: null,
        lastError: 'Timed out.',
      }],
    }
    render(<NotificationCenter open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(mocks.acknowledge).toHaveBeenCalledWith(9)
    expect(mocks.retry).toHaveBeenCalledWith(12)
  })

  it('loads additional incident pages on demand', () => {
    mocks.hasNextPage = true
    render(<NotificationCenter open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Load more' })[0])

    expect(mocks.fetchNextPage).toHaveBeenCalledTimes(1)
  })

  it('preserves selected resources that are absent from the latest heartbeat', () => {
    mocks.snapshot = snapshot({
      enabled: true,
      hostOverrides: [{ id: 3, hostType: 'server', hostId: 7, mode: 'custom', mutedUntil: '2099-01-01T00:00:00.000Z', monitoredResourceIds: [8], rules: [] }],
      monitoredResources: [{ id: 8, hostType: 'server', hostId: 7, family: 'service', key: 'docker.service', name: 'Docker', enabled: true }],
    })
    const status = { services: [], containers: [], storageHealth: [] } as unknown as AgentHostStatus
    render(<HostNotificationSettings hostType="server" hostId={7} status={status} />)

    expect(screen.getByText('Docker')).toBeInTheDocument()
    expect(screen.getByText('Currently muted')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save host policy' }))

    expect(mocks.updateHost).toHaveBeenCalledWith(expect.objectContaining({
      hostType: 'server',
      hostId: 7,
      input: expect.objectContaining({
        expectedRevision: 4,
        mode: 'custom',
        resources: [{ family: 'service', key: 'docker.service', name: 'Docker' }],
      }),
    }))
  })

  it('shows whether the agent has applied the current monitoring policy revision', () => {
    mocks.snapshot = snapshot({ enabled: true })
    const pending = {
      capabilities: { 'notifications.monitoring-policy': { state: 'available' } },
      monitoringRevision: 3,
      services: [], containers: [], storageHealth: [],
    } as unknown as AgentHostStatus
    const { rerender } = render(<HostNotificationSettings hostType="server" hostId={7} status={pending} />)
    expect(screen.getByText(/revision 4 is pending agent acknowledgement/i)).toBeInTheDocument()

    rerender(<HostNotificationSettings hostType="server" hostId={7} status={{ ...pending, monitoringRevision: 4 }} />)
    expect(screen.getByText(/revision 4 is active/i)).toBeInTheDocument()
  })
})
