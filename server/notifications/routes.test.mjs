import express from 'express'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IncidentManager } from './incident-manager.mjs'
import { NotificationSecretVault } from './secret-vault.mjs'
import { NotificationStore } from './store.mjs'
import { registerNotificationRoutes } from './routes.mjs'

const directories = []
const servers = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

async function setup({ demo = false } = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'notification-routes-'))
  directories.push(dataDir)
  const store = demo ? null : await new NotificationStore({ dataDir }).init()
  const vault = demo ? null : await new NotificationSecretVault({ dataDir, store }).init()
  const incidentManager = demo ? null : new IncidentManager({ store })
  const deliveryCoordinator = { sendTest: vi.fn(async () => ({ status: 200 })), retry: vi.fn(async () => ({ state: 'queued' })) }
  const app = express()
  app.use(express.json())
  registerNotificationRoutes(app, { store, vault, incidentManager, deliveryCoordinator, demo })
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
  })
  servers.push(server)
  return { store, vault, deliveryCoordinator, url: `http://127.0.0.1:${server.address().port}` }
}

async function json(url, pathname, options = {}) {
  const response = await fetch(`${url}${pathname}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  return { response, body: response.status === 204 ? null : await response.json() }
}

describe('notification routes', () => {
  it('returns count-only notification summaries without configuration data', async () => {
    const { store, url } = await setup()
    await store.mutateState((draft) => {
      const openedAt = new Date(0).toISOString()
      draft.incidents.push({ id: 1, eventKey: 'server:1:0:host.offline', hostType: 'server', hostId: 1, resourceId: null, eventType: 'host.offline', severity: 'critical', title: 'Open', summary: '', state: 'open', openedAt, resolvedAt: null, acknowledgedAt: null, acknowledgedBy: null, notificationDeliveredAt: null, lastReminderAt: null, createdAt: openedAt, updatedAt: openedAt })
      draft.counters.incident = 2
    })

    const result = await json(url, '/api/notifications/summary')
    expect(result.body).toEqual({
      available: true,
      summary: { active: 1, unacknowledged: 1, exhaustedDeliveries: 0 },
    })
    expect(result.body.config).toBeUndefined()
  })

  it('manages redacted contact points with optimistic revisions', async () => {
    const { store, vault, deliveryCoordinator, url } = await setup()
    const created = await json(url, '/api/notifications/contact-points', {
      method: 'POST',
      body: JSON.stringify({
        expectedRevision: 1,
        type: 'ntfy', name: 'Primary', enabled: true,
        config: { serverUrl: 'https://ntfy.example.test', topic: 'alerts' },
        credentials: { token: 'private-token' },
      }),
    })
    expect(created.response.status).toBe(201)
    expect(created.body).toMatchObject({ id: 1, hasSecret: true })
    expect(JSON.stringify(created.body)).not.toContain('private-token')
    expect(await vault.open(1)).toContain('private-token')

    const snapshot = await json(url, '/api/notifications')
    expect(snapshot.body.config.contactPoints[0]).toMatchObject({ id: 1, hasSecret: true })
    expect(snapshot.body.config.contactPoints[0].secretId).toBeUndefined()

    const conflict = await json(url, '/api/notifications/settings', {
      method: 'PATCH', body: JSON.stringify({ expectedRevision: 1, enabled: true }),
    })
    expect(conflict.response.status).toBe(409)
    expect(conflict.body.code).toBe('notification-revision-conflict')

    const test = await json(url, '/api/notifications/contact-points/1/test', { method: 'POST', body: '{}' })
    expect(test.body).toEqual({ ok: true, status: 200 })
    expect(deliveryCoordinator.sendTest).toHaveBeenCalledWith(1)
    expect(store.readSecrets().secrets).toHaveLength(1)
  })

  it('encrypts generic webhook destination URLs instead of returning them through the API', async () => {
    const { store, vault, url } = await setup()
    const privateUrl = 'https://hooks.example.test/private-token?signature=secret'
    const created = await json(url, '/api/notifications/contact-points', {
      method: 'POST',
      body: JSON.stringify({
        expectedRevision: 1,
        type: 'webhook', name: 'Automation', enabled: true,
        config: { url: privateUrl },
      }),
    })
    expect(created.response.status).toBe(201)
    expect(JSON.stringify(created.body)).not.toContain('private-token')
    expect(created.body.config).toEqual({ displayUrl: 'https://hooks.example.test' })
    expect(JSON.parse(await vault.open(1))).toEqual({ url: privateUrl })
    expect(JSON.stringify(store.readConfig())).not.toContain('private-token')

    const revision = store.readConfig().revision
    const renamed = await json(url, '/api/notifications/contact-points/1', {
      method: 'PUT',
      body: JSON.stringify({ expectedRevision: revision, name: 'Renamed', config: {} }),
    })
    expect(renamed.response.status).toBe(200)
    expect(JSON.parse(await vault.open(1))).toEqual({ url: privateUrl })
  })

  it('normalizes host-specific resources and custom rules', async () => {
    const { store, url } = await setup()
    const revision = store.readConfig().revision
    const saved = await json(url, '/api/notifications/hosts/server/7', {
      method: 'PUT',
      body: JSON.stringify({
        expectedRevision: revision,
        mode: 'custom',
        resources: [{ family: 'service', key: 'docker.service', name: 'Docker' }],
        rules: [{ eventType: 'host.offline', severity: 'warning', debounceSeconds: 120 }],
      }),
    })
    expect(saved.response.status).toBe(200)
    expect(store.readConfig().hostOverrides[0]).toMatchObject({
      hostType: 'server', hostId: 7, mode: 'custom', monitoredResourceIds: [1],
      rules: [{ eventType: 'host.offline', severity: 'warning', debounceSeconds: 120 }],
    })
    expect(store.readConfig().monitoredResources[0]).toMatchObject({ family: 'service', key: 'docker.service' })
  })

  it('blocks contact-point deletion while workspace or host rules reference it', async () => {
    const { store, url } = await setup()
    await store.mutateConfig((draft) => {
      draft.contactPoints.push({
        id: 1, type: 'ntfy', name: 'Primary', enabled: true, secretId: null,
        config: { serverUrl: 'https://ntfy.example.test', topic: 'alerts' },
      })
      draft.rules[0].contactPointIds = [1]
      draft.counters.contactPoint = 2
    })
    const blocked = await json(url, '/api/notifications/contact-points/1', {
      method: 'DELETE',
      body: JSON.stringify({ expectedRevision: store.readConfig().revision }),
    })
    expect(blocked.response.status).toBe(409)
    expect(blocked.body.code).toBe('notification-contact-point-in-use')
    expect(store.readConfig().contactPoints).toHaveLength(1)

    await store.mutateConfig((draft) => { draft.rules[0].contactPointIds = [] })
    const removed = await json(url, '/api/notifications/contact-points/1', {
      method: 'DELETE',
      body: JSON.stringify({ expectedRevision: store.readConfig().revision }),
    })
    expect(removed.response.status).toBe(204)
    expect(store.readConfig().contactPoints).toHaveLength(0)
  })

  it('paginates resolved and cancelled incidents as server-side history', async () => {
    const { store, url } = await setup()
    const openedAt = new Date(0).toISOString()
    await store.mutateState((draft) => {
      draft.incidents.push(
        { id: 1, eventKey: 'server:1:0:host.offline', hostType: 'server', hostId: 1, resourceId: null, eventType: 'host.offline', severity: 'critical', title: 'Open', summary: '', state: 'open', openedAt, resolvedAt: null, acknowledgedAt: null, acknowledgedBy: null, notificationDeliveredAt: null, lastReminderAt: null, createdAt: openedAt, updatedAt: openedAt },
        { id: 2, eventKey: 'server:2:0:host.offline', hostType: 'server', hostId: 2, resourceId: null, eventType: 'host.offline', severity: 'critical', title: 'Resolved', summary: '', state: 'resolved', openedAt, resolvedAt: openedAt, acknowledgedAt: null, acknowledgedBy: null, notificationDeliveredAt: null, lastReminderAt: null, createdAt: openedAt, updatedAt: openedAt },
        { id: 3, eventKey: 'server:3:0:host.offline', hostType: 'server', hostId: 3, resourceId: null, eventType: 'host.offline', severity: 'critical', title: 'Cancelled', summary: '', state: 'cancelled', openedAt, resolvedAt: null, acknowledgedAt: null, acknowledgedBy: null, notificationDeliveredAt: null, lastReminderAt: null, createdAt: openedAt, updatedAt: openedAt },
      )
      draft.counters.incident = 4
    })

    const history = await json(url, '/api/notifications/incidents?state=history&limit=1')
    expect(history.body.total).toBe(2)
    expect(history.body.incidents).toHaveLength(1)
    expect(history.body.incidents[0].state).not.toBe('open')
  })

  it('keeps notification mutations unavailable in demo mode', async () => {
    const { url } = await setup({ demo: true })
    const snapshot = await json(url, '/api/notifications')
    expect(snapshot.body).toMatchObject({ available: false, config: { enabled: false } })
    const mutation = await json(url, '/api/notifications/settings', { method: 'PATCH', body: JSON.stringify({ enabled: true }) })
    expect(mutation.response.status).toBe(403)
    expect(mutation.body.code).toBe('notifications-disabled-in-demo')
  })
})
