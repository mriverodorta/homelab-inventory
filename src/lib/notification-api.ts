import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import { consumeInitialBootstrap } from '@/lib/bootstrap-api'
import type { AgentHostType } from '@/types/agent'
import type {
  NotificationContactPoint,
  NotificationHostOverride,
  NotificationIncident,
  NotificationIncidentPage,
  NotificationQuietHours,
  NotificationResourceInput,
  NotificationRule,
  NotificationSnapshot,
} from '@/types/notifications'

async function notificationRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithTimeout(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null
    throw new Error(payload?.message ?? `Notification request failed with status ${response.status}.`)
  }
  return response.status === 204 ? undefined as T : await response.json() as T
}

export function loadNotificationSnapshot(): Promise<NotificationSnapshot> {
  return consumeInitialBootstrap('notifications', () => notificationRequest('/api/notifications'))
}

export function updateNotificationSettings(input: {
  expectedRevision: number
  enabled?: boolean
  retention?: { incidentDays?: number; deliveryAttemptDays?: number }
}): Promise<NotificationSnapshot> {
  return notificationRequest('/api/notifications/settings', { method: 'PATCH', body: JSON.stringify(input) })
}

export type ContactPointInput = {
  expectedRevision: number
  type: 'ntfy' | 'webhook'
  name: string
  enabled: boolean
  config: Record<string, unknown>
  credentials?: Record<string, unknown> | null
}

export function createNotificationContactPoint(input: ContactPointInput): Promise<NotificationContactPoint> {
  return notificationRequest('/api/notifications/contact-points', { method: 'POST', body: JSON.stringify(input) })
}

export function updateNotificationContactPoint(id: number, input: ContactPointInput): Promise<NotificationSnapshot> {
  return notificationRequest(`/api/notifications/contact-points/${id}`, { method: 'PUT', body: JSON.stringify(input) })
}

export function deleteNotificationContactPoint(id: number, expectedRevision: number): Promise<void> {
  return notificationRequest(`/api/notifications/contact-points/${id}`, { method: 'DELETE', body: JSON.stringify({ expectedRevision }) })
}

export function testNotificationContactPoint(id: number): Promise<{ ok: true; status: number }> {
  return notificationRequest(`/api/notifications/contact-points/${id}/test`, { method: 'POST', body: '{}' })
}

export function updateNotificationRule(id: number, expectedRevision: number, input: Partial<NotificationRule>): Promise<NotificationSnapshot> {
  return notificationRequest(`/api/notifications/rules/${id}`, { method: 'PUT', body: JSON.stringify({ ...input, expectedRevision }) })
}

export function createNotificationQuietHours(expectedRevision: number, input: Omit<NotificationQuietHours, 'id'>): Promise<NotificationQuietHours> {
  return notificationRequest('/api/notifications/quiet-hours', { method: 'POST', body: JSON.stringify({ ...input, expectedRevision }) })
}

export function updateNotificationQuietHours(id: number, expectedRevision: number, input: Omit<NotificationQuietHours, 'id'>): Promise<NotificationSnapshot> {
  return notificationRequest(`/api/notifications/quiet-hours/${id}`, { method: 'PUT', body: JSON.stringify({ ...input, expectedRevision }) })
}

export function deleteNotificationQuietHours(id: number, expectedRevision: number): Promise<void> {
  return notificationRequest(`/api/notifications/quiet-hours/${id}`, { method: 'DELETE', body: JSON.stringify({ expectedRevision }) })
}

export function updateHostNotificationPolicy(hostType: AgentHostType, hostId: number, input: {
  expectedRevision: number
  mode: NotificationHostOverride['mode']
  mutedUntil: string | null
  resources: NotificationResourceInput[]
  rules?: NotificationHostOverride['rules']
}): Promise<NotificationSnapshot> {
  return notificationRequest(`/api/notifications/hosts/${hostType}/${hostId}`, { method: 'PUT', body: JSON.stringify(input) })
}

export function loadNotificationIncidents(state = 'all', limit = 100, offset = 0): Promise<NotificationIncidentPage> {
  const query = new URLSearchParams({ state, limit: String(limit), offset: String(offset) })
  return notificationRequest(`/api/notifications/incidents?${query}`)
}

export function acknowledgeNotificationIncident(id: number): Promise<NotificationIncident> {
  return notificationRequest(`/api/notifications/incidents/${id}/acknowledge`, { method: 'POST', body: '{}' })
}

export function retryNotificationDelivery(id: number): Promise<void> {
  return notificationRequest(`/api/notifications/deliveries/${id}/retry`, { method: 'POST', body: '{}' })
}
