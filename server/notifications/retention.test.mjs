import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NotificationStore } from './store.mjs'
import { pruneNotificationHistory } from './retention.mjs'

const directories = []
afterEach(async () => Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))))

describe('notification retention', () => {
  it('cascades expired resolved incidents while preserving active incidents', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'notification-retention-'))
    directories.push(dataDir)
    const store = await new NotificationStore({ dataDir, now: () => 0 }).init()
    const old = new Date(0).toISOString()
    const recent = new Date(100 * 86_400_000).toISOString()
    await store.mutateState((draft) => {
      draft.incidents.push(
        { id: 1, eventKey: 'server:1:0:host.offline', hostType: 'server', hostId: 1, resourceId: null, eventType: 'host.offline', severity: 'critical', title: 'Old', summary: '', state: 'resolved', openedAt: old, resolvedAt: old, acknowledgedAt: null, acknowledgedBy: null, notificationDeliveredAt: old, lastReminderAt: null, createdAt: old, updatedAt: old },
        { id: 2, eventKey: 'server:2:0:host.offline', hostType: 'server', hostId: 2, resourceId: null, eventType: 'host.offline', severity: 'critical', title: 'Open', summary: '', state: 'open', openedAt: old, resolvedAt: null, acknowledgedAt: null, acknowledgedBy: null, notificationDeliveredAt: null, lastReminderAt: null, createdAt: old, updatedAt: recent },
        { id: 3, eventKey: 'server:3:0:host.offline', hostType: 'server', hostId: 3, resourceId: null, eventType: 'host.offline', severity: 'critical', title: 'Cancelled', summary: '', state: 'cancelled', openedAt: old, resolvedAt: null, acknowledgedAt: null, acknowledgedBy: null, notificationDeliveredAt: null, lastReminderAt: null, createdAt: old, updatedAt: old },
      )
      draft.transitions.push({ id: 1, incidentId: 1, from: 'open', to: 'resolved', reason: 'test', occurredAt: old })
      draft.deliveryJobs.push({ id: 1, incidentId: 1, contactPointId: 1, kind: 'opening', state: 'delivered', idempotencyKey: '1:1:opening', attempts: 1, availableAt: old, leaseOwner: null, leaseExpiresAt: null, deliveredAt: old, lastError: null, createdAt: old, updatedAt: old })
      draft.deliveryAttempts.push({ id: 1, deliveryJobId: 1, attempt: 1, state: 'delivered', status: 200, responseExcerpt: '', error: null, attemptedAt: old })
      draft.counters.incident = 4
      draft.counters.transition = 2
      draft.counters.deliveryJob = 2
      draft.counters.deliveryAttempt = 2
    })

    expect(await pruneNotificationHistory(store, 100 * 86_400_000, { incidents: 1, attempts: 1, cooldowns: 1 })).toEqual({ incidents: 1, attempts: 1, remaining: true })
    expect(store.readState().incidents.map((incident) => incident.id)).toEqual([2, 3])
    expect(await pruneNotificationHistory(store, 100 * 86_400_000, { incidents: 1, attempts: 1, cooldowns: 1 })).toEqual({ incidents: 1, attempts: 0, remaining: false })
    expect(store.readState().incidents.map((incident) => incident.id)).toEqual([2])
    expect(store.readState().deliveryJobs).toEqual([])
    expect(store.readState().deliveryAttempts).toEqual([])
  })
})
