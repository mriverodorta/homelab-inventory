import type { AgentHostType } from '@/types/agent'

export type NotificationSeverity = 'info' | 'warning' | 'critical'
export type NotificationEventType =
  | 'host.offline'
  | 'service.unhealthy'
  | 'container.unhealthy'
  | 'container.missing'
  | 'storage.warning'
  | 'storage.failed'

export type NotificationContactPoint = {
  id: number
  type: 'ntfy' | 'webhook'
  name: string
  enabled: boolean
  hasSecret: boolean
  config: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
}

export type NotificationRule = {
  id: number
  eventType: NotificationEventType
  enabled: boolean
  severity: NotificationSeverity
  contactPointIds: number[]
  debounceSeconds: number
  cooldownSeconds: number
  reminderIntervalSeconds: number | null
}

export type NotificationQuietHours = {
  id: number
  enabled: boolean
  timezone: string
  start: string
  end: string
  weekdays: number[]
}

export type NotificationResource = {
  id: number
  hostType: AgentHostType
  hostId: number
  family: 'service' | 'container' | 'storage-health'
  key: string
  name: string
  enabled: boolean
}

export type NotificationHostOverride = {
  id: number
  hostType: AgentHostType
  hostId: number
  mode: 'inherit' | 'custom' | 'disabled'
  mutedUntil: string | null
  monitoredResourceIds: number[]
  rules: Array<Partial<NotificationRule> & Pick<NotificationRule, 'eventType'>>
  updatedAt?: string
}

export type NotificationConfig = {
  version?: number
  revision: number
  enabled: boolean
  contactPoints: NotificationContactPoint[]
  rules: NotificationRule[]
  quietHours: NotificationQuietHours[]
  hostOverrides: NotificationHostOverride[]
  monitoredResources: NotificationResource[]
  retention: { incidentDays: number; deliveryAttemptDays: number }
}

export type NotificationSnapshot = {
  available: boolean
  config: NotificationConfig
  summary: NotificationSummary['summary']
}

export type NotificationSummary = {
  available: boolean
  summary: { active: number; unacknowledged: number; exhaustedDeliveries: number }
}

export type NotificationIncident = {
  id: number
  hostType: AgentHostType
  hostId: number
  resourceId: number | null
  eventType: NotificationEventType
  severity: NotificationSeverity
  title: string
  summary: string
  state: 'pending' | 'open' | 'resolved' | 'cancelled'
  openedAt: string
  resolvedAt: string | null
  acknowledgedAt: string | null
  acknowledgedBy: number | null
  notificationDeliveredAt: string | null
}

export type NotificationDelivery = {
  id: number
  incidentId: number
  contactPointId: number
  kind: 'opening' | 'reminder' | 'recovery'
  state: 'queued' | 'leased' | 'delivered' | 'retrying' | 'exhausted' | 'cancelled'
  attempts: number
  availableAt: string
  deliveredAt: string | null
  lastError: string | null
}

export type NotificationIncidentPage = {
  incidents: NotificationIncident[]
  deliveries: NotificationDelivery[]
  total: number
}

export type NotificationResourceInput = Pick<NotificationResource, 'family' | 'key' | 'name'>
