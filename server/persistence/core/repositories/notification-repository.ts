import { and, asc, eq } from 'drizzle-orm'
import { incidents, notificationDeliveries, notificationSettings } from '../schema/index.ts'
import { assertPositiveId, type RepositoryContext } from './repository-context.ts'

export function createNotificationRepository({ db, now }: RepositoryContext) {
  function getSettings() {
    return db.select().from(notificationSettings).where(eq(notificationSettings.id, 1)).get() ?? null
  }

  function listOpenIncidents(hostItemId?: number) {
    const condition = hostItemId == null
      ? eq(incidents.state, 'open')
      : and(eq(incidents.state, 'open'), eq(incidents.hostItemId, assertPositiveId(hostItemId, 'Host item ID')))
    return db.select().from(incidents).where(condition).orderBy(asc(incidents.openedAtMs)).all()
  }

  function resolveIncident(incidentId: number) {
    const at = now()
    const result = db.update(incidents).set({ state: 'resolved', resolvedAtMs: at, updatedAtMs: at })
      .where(and(eq(incidents.id, assertPositiveId(incidentId, 'Incident ID')), eq(incidents.state, 'open'))).run()
    if (result.changes !== 1) throw new Error(`Open incident ${incidentId} was not found.`)
  }

  function claimDeliveries(limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Delivery claim limit must be between 1 and 100.')
    const due = db.select().from(notificationDeliveries)
      .where(eq(notificationDeliveries.state, 'queued'))
      .orderBy(asc(notificationDeliveries.availableAtMs)).limit(limit).all()
    for (const delivery of due) {
      db.update(notificationDeliveries).set({ state: 'leased', updatedAtMs: now() })
        .where(and(eq(notificationDeliveries.id, delivery.id), eq(notificationDeliveries.state, 'queued'))).run()
    }
    return due
  }

  return { getSettings, listOpenIncidents, resolveIncident, claimDeliveries }
}

export type NotificationRepository = ReturnType<typeof createNotificationRepository>
