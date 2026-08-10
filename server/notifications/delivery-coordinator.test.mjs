import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotificationDeliveryCoordinator } from './delivery-coordinator.mjs'
import { nextRelationalId } from './model.mjs'
import { NotificationSecretVault } from './secret-vault.mjs'
import { NotificationStore } from './store.mjs'

const directories = []
afterEach(async () => Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))))

async function setup(adapter) {
  let now = 1_000
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'delivery-coordinator-'))
  directories.push(dataDir)
  const store = await new NotificationStore({ dataDir, now: () => now }).init()
  const vault = await new NotificationSecretVault({ dataDir, store, now: () => now }).init()
  const secretId = await vault.seal(JSON.stringify({ token: 'private' }))
  await store.mutateConfig((draft) => {
    draft.enabled = true
    draft.contactPoints.push({ id: 1, type: 'ntfy', name: 'Ntfy', enabled: true, secretId, config: {} })
    draft.counters.contactPoint = 2
    for (const rule of draft.rules) rule.contactPointIds = [1]
  })
  await store.mutateState((draft) => {
    const incidentId = nextRelationalId(draft, 'incident')
    draft.incidents.push({ id: incidentId, eventKey: 'server:1:0:host.offline', hostType: 'server', hostId: 1, resourceId: null, eventType: 'host.offline', severity: 'critical', title: 'Offline', summary: 'No heartbeat', state: 'open', openedAt: new Date(now).toISOString(), resolvedAt: null, acknowledgedAt: null, acknowledgedBy: null, notificationDeliveredAt: null, lastReminderAt: null, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() })
    draft.deliveryJobs.push({ id: 1, incidentId, contactPointId: 1, kind: 'opening', state: 'queued', idempotencyKey: '1:1:opening', attempts: 0, availableAt: new Date(now).toISOString(), leaseOwner: null, leaseExpiresAt: null, deliveredAt: null, lastError: null, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() })
    draft.counters.deliveryJob = 2
  })
  const coordinator = new NotificationDeliveryCoordinator({ store, vault, adapters: { ntfy: adapter }, now: () => now })
  return { store, coordinator, setNow: (value) => { now = value } }
}

describe('NotificationDeliveryCoordinator', () => {
  it('leases and records a successful delivery exactly once', async () => {
    const adapter = { send: vi.fn(async () => ({ status: 200, responseExcerpt: 'ok' })) }
    const { store, coordinator } = await setup(adapter)
    expect(await coordinator.processNext()).toBe(true)
    expect(await coordinator.processNext()).toBe(false)
    expect(adapter.send).toHaveBeenCalledTimes(1)
    expect(adapter.send).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({ idempotencyKey: '1:1:opening' }),
    }))
    expect(store.readState().deliveryJobs[0].state).toBe('delivered')
    expect(store.readState().incidents[0].notificationDeliveredAt).not.toBeNull()
    expect(store.readState().cooldowns).toMatchObject([{
      hostType: 'server', hostId: 1, eventType: 'host.offline', contactPointId: 1,
    }])
  })

  it('persists retry state without exposing adapter secrets', async () => {
    const adapter = { send: vi.fn(async () => { throw new Error('Bearer private failed') }) }
    const { store, coordinator } = await setup(adapter)
    await coordinator.processNext()
    expect(store.readState().deliveryJobs[0]).toMatchObject({ state: 'retrying', attempts: 1 })
    expect(JSON.stringify(store.readState())).not.toContain('private')
    expect(store.readState().deliveryAttempts[0].error).toContain('[redacted]')
  })

  it('uses bounded backoff and exhausts after six failed attempts', async () => {
    const adapter = { send: vi.fn(async () => { throw new Error('unavailable') }) }
    const { store, coordinator, setNow } = await setup(adapter)
    for (const now of [1_000, 31_000, 151_000, 751_000, 2_551_000, 9_751_000]) {
      setNow(now)
      expect(await coordinator.processNext()).toBe(true)
    }
    expect(await coordinator.processNext()).toBe(false)
    expect(adapter.send).toHaveBeenCalledTimes(6)
    expect(store.readState().deliveryJobs[0]).toMatchObject({ state: 'exhausted', attempts: 6 })
    expect(store.readState().deliveryAttempts).toHaveLength(6)
  })

  it('recovers an expired delivery lease after a process restart', async () => {
    const adapter = { send: vi.fn(async () => ({ status: 204, responseExcerpt: '' })) }
    const { store, coordinator, setNow } = await setup(adapter)
    await store.mutateState((draft) => {
      Object.assign(draft.deliveryJobs[0], {
        state: 'leased',
        leaseOwner: 'stopped-process',
        leaseExpiresAt: new Date(31_000).toISOString(),
      })
    })
    setNow(31_001)
    expect(await coordinator.processNext()).toBe(true)
    expect(store.readState().deliveryJobs[0]).toMatchObject({ state: 'delivered', attempts: 1 })
  })

  it('defers delivery without consuming an attempt while a host mute is active', async () => {
    const adapter = { send: vi.fn(async () => ({ status: 204, responseExcerpt: '' })) }
    const { store, coordinator, setNow } = await setup(adapter)
    await store.mutateConfig((draft) => {
      draft.hostOverrides.push({ id: 1, hostType: 'server', hostId: 1, mode: 'inherit', mutedUntil: new Date(61_000).toISOString(), monitoredResourceIds: [], rules: [] })
      draft.counters.hostOverride = 2
    })
    expect(await coordinator.processNext()).toBe(true)
    expect(adapter.send).not.toHaveBeenCalled()
    expect(store.readState().deliveryJobs[0]).toMatchObject({ state: 'retrying', attempts: 0, availableAt: new Date(61_000).toISOString() })
    setNow(61_001)
    expect(await coordinator.processNext()).toBe(true)
    expect(adapter.send).toHaveBeenCalledTimes(1)
  })

  it('keeps cooldowns independent for resources on the same host', async () => {
    const adapter = { send: vi.fn(async () => ({ status: 200, responseExcerpt: 'ok' })) }
    const { store, coordinator } = await setup(adapter)
    await store.mutateState((draft) => {
      draft.incidents[0].eventKey = 'server:1:11:service.unhealthy'
      draft.incidents[0].eventType = 'service.unhealthy'
      draft.incidents[0].resourceId = 11
      const secondIncident = {
        ...structuredClone(draft.incidents[0]), id: nextRelationalId(draft, 'incident'),
        eventKey: 'server:1:12:service.unhealthy', resourceId: 12,
      }
      draft.incidents.push(secondIncident)
      draft.deliveryJobs.push({
        ...structuredClone(draft.deliveryJobs[0]), id: nextRelationalId(draft, 'deliveryJob'),
        incidentId: secondIncident.id, idempotencyKey: `${secondIncident.id}:1:opening`,
      })
    })
    await coordinator.processNext()
    await coordinator.processNext()
    expect(store.readState().cooldowns.map((cooldown) => cooldown.resourceId).sort((a, b) => a - b)).toEqual([11, 12])
  })
})
