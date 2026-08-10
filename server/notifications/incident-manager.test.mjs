import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { IncidentManager } from './incident-manager.mjs'
import { nextRelationalId } from './model.mjs'
import { NotificationStore } from './store.mjs'

const directories = []
afterEach(async () => Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))))

async function setup() {
  let now = 0
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'incident-manager-'))
  directories.push(dataDir)
  const store = await new NotificationStore({ dataDir, now: () => now }).init()
  await store.mutateConfig((draft) => {
    draft.enabled = true
    const contactPointId = nextRelationalId(draft, 'contactPoint')
    draft.contactPoints.push({ id: contactPointId, type: 'ntfy', name: 'Ntfy', enabled: true, secretId: null, config: {} })
    for (const rule of draft.rules) rule.contactPointIds = [contactPointId]
  })
  return { store, manager: new IncidentManager({ store, now: () => now }), setNow: (value) => { now = value } }
}

describe('IncidentManager', () => {
  it('opens a host incident after the persisted debounce', async () => {
    const { store, manager, setNow } = await setup()
    expect((await manager.observe({ hostType: 'server', hostId: 1, eventType: 'host.offline', state: 'problem', observedAt: 0 })).action).toBe('pending')
    setNow(60_000)
    await manager.evaluatePending()
    expect(store.readState().incidents).toMatchObject([{ state: 'open', eventType: 'host.offline' }])
    expect(store.readState().deliveryJobs).toMatchObject([{ kind: 'opening', state: 'queued' }])
  })

  it('does not rewrite state for an unchanged healthy host poll', async () => {
    const { store, manager, setNow } = await setup()
    await manager.observe({ hostType: 'server', hostId: 1, eventType: 'host.offline', state: 'healthy', observedAt: 0 })
    const updatedAt = store.readState().updatedAt
    setNow(15_000)
    expect(await manager.observe({ hostType: 'server', hostId: 1, eventType: 'host.offline', state: 'healthy', observedAt: 15_000 })).toEqual({ action: 'unchanged' })
    expect(store.readState().updatedAt).toBe(updatedAt)
  })

  it('does not rewrite idle time-driven notification state', async () => {
    const { store, manager, setNow } = await setup()
    await manager.observe({ hostType: 'server', hostId: 1, eventType: 'host.offline', state: 'problem', observedAt: 0 })
    const updatedAt = store.readState().updatedAt

    setNow(15_000)
    expect(await manager.evaluatePending()).toEqual([])
    expect(await manager.evaluateReminders()).toEqual([])
    expect(await manager.evaluateSuppressedOpenings()).toEqual([])
    expect(await manager.evaluateRecoveries()).toEqual([])
    expect(store.readState().updatedAt).toBe(updatedAt)
  })

  it('requires two spaced observations for selected service failures', async () => {
    const { store, manager } = await setup()
    await manager.observe({ hostType: 'server', hostId: 1, resourceId: 1, eventType: 'service.unhealthy', state: 'problem', observedAt: 0 })
    await manager.observe({ hostType: 'server', hostId: 1, resourceId: 1, eventType: 'service.unhealthy', state: 'problem', observedAt: 30_000 })
    expect(store.readState().incidents).toHaveLength(0)
    await manager.observe({ hostType: 'server', hostId: 1, resourceId: 1, eventType: 'service.unhealthy', state: 'problem', observedAt: 60_000 })
    expect(store.readState().incidents).toHaveLength(1)
  })

  it('cancels a flapping problem before debounce without opening an incident', async () => {
    const { store, manager, setNow } = await setup()
    await manager.observe({ hostType: 'server', hostId: 1, eventType: 'host.offline', state: 'problem', observedAt: 0 })
    setNow(30_000)
    expect((await manager.observe({ hostType: 'server', hostId: 1, eventType: 'host.offline', state: 'healthy', observedAt: 30_000 })).action).toBe('cancelled')
    setNow(90_000)
    expect(await manager.evaluatePending()).toEqual([])
    expect(store.readState().incidents).toHaveLength(0)
    expect(store.readState().deliveryJobs).toHaveLength(0)
  })

  it('opens a persisted pending incident after a process restart', async () => {
    const { store, manager, setNow } = await setup()
    await manager.observe({ hostType: 'server', hostId: 1, eventType: 'host.offline', state: 'problem', observedAt: 0 })
    const restartedStore = await new NotificationStore({ dataDir: store.dataDir, now: () => 60_000 }).init()
    const restarted = new IncidentManager({ store: restartedStore, now: () => 60_000 })
    setNow(60_000)
    expect(await restarted.evaluatePending()).toEqual([1])
    expect(restartedStore.readState().deliveryJobs).toMatchObject([{ idempotencyKey: '1:1:opening' }])
  })

  it('queues recovery only after opening delivery was actually delivered', async () => {
    const { store, manager, setNow } = await setup()
    await manager.observe({ hostType: 'server', hostId: 1, eventType: 'host.offline', state: 'problem', observedAt: 0 })
    setNow(60_000)
    await manager.evaluatePending()
    await manager.observe({ hostType: 'server', hostId: 1, eventType: 'host.offline', state: 'healthy', observedAt: 61_000 })
    expect(store.readState().deliveryJobs.filter((job) => job.kind === 'recovery')).toHaveLength(0)
  })

  it('queues a suppressed opening once a temporary mute expires', async () => {
    const { store, manager, setNow } = await setup()
    await store.mutateConfig((draft) => {
      draft.hostOverrides.push({
        id: nextRelationalId(draft, 'hostOverride'), hostType: 'server', hostId: 1,
        mode: 'inherit', mutedUntil: new Date(120_000).toISOString(), monitoredResourceIds: [], rules: [],
      })
    })
    await manager.observe({ hostType: 'server', hostId: 1, eventType: 'host.offline', state: 'problem', observedAt: 0 })
    setNow(60_000)
    await manager.evaluatePending()
    expect(store.readState().deliveryJobs).toHaveLength(0)
    setNow(120_001)
    expect(await manager.evaluateSuppressedOpenings()).toEqual([1])
    expect(store.readState().deliveryJobs).toMatchObject([{ kind: 'opening', state: 'queued' }])
  })

  it('queues recovery only for contact points that received the opening', async () => {
    const { store, manager, setNow } = await setup()
    await store.mutateConfig((draft) => {
      const secondId = nextRelationalId(draft, 'contactPoint')
      draft.contactPoints.push({ id: secondId, type: 'ntfy', name: 'Backup', enabled: true, secretId: null, config: {} })
      for (const rule of draft.rules) rule.contactPointIds = [1, secondId]
    })
    await manager.observe({ hostType: 'server', hostId: 1, eventType: 'host.offline', state: 'problem', observedAt: 0 })
    setNow(60_000)
    await manager.evaluatePending()
    await store.mutateState((draft) => {
      draft.deliveryJobs.find((job) => job.contactPointId === 1).state = 'delivered'
      draft.deliveryJobs.find((job) => job.contactPointId === 1).deliveredAt = new Date(60_000).toISOString()
      draft.incidents[0].notificationDeliveredAt = new Date(60_000).toISOString()
    })
    await manager.observe({ hostType: 'server', hostId: 1, eventType: 'host.offline', state: 'healthy', observedAt: 61_000 })
    expect(store.readState().deliveryJobs.filter((job) => job.kind === 'recovery')).toMatchObject([{ contactPointId: 1 }])
  })

  it('queues a still-open incident per destination after that destination cooldown expires', async () => {
    const { store, manager, setNow } = await setup()
    await store.mutateConfig((draft) => {
      const secondId = nextRelationalId(draft, 'contactPoint')
      draft.contactPoints.push({ id: secondId, type: 'ntfy', name: 'Backup', enabled: true, secretId: null, config: {} })
      for (const rule of draft.rules) rule.contactPointIds = [1, secondId]
    })
    await store.mutateState((draft) => {
      draft.cooldowns.push({
        id: nextRelationalId(draft, 'cooldown'), hostType: 'server', hostId: 1, resourceId: null,
        eventType: 'host.offline', contactPointId: 1, expiresAt: new Date(120_000).toISOString(),
        createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
      })
    })
    await manager.observe({ hostType: 'server', hostId: 1, eventType: 'host.offline', state: 'problem', observedAt: 0 })
    setNow(60_000)
    await manager.evaluatePending()
    expect(store.readState().deliveryJobs).toMatchObject([{ contactPointId: 2 }])
    await store.mutateState((draft) => {
      draft.deliveryJobs[0].state = 'delivered'
      draft.deliveryJobs[0].deliveredAt = new Date(60_000).toISOString()
      draft.incidents[0].notificationDeliveredAt = new Date(60_000).toISOString()
    })
    setNow(120_001)
    expect(await manager.evaluateSuppressedOpenings()).toEqual([1])
    expect(store.readState().deliveryJobs.map((job) => job.contactPointId).sort()).toEqual([1, 2])
  })

  it('reconciles a recovery when an in-flight opening succeeds after resolution', async () => {
    const { store, manager, setNow } = await setup()
    await manager.observe({ hostType: 'server', hostId: 1, eventType: 'host.offline', state: 'problem', observedAt: 0 })
    setNow(60_000)
    await manager.evaluatePending()
    await manager.observe({ hostType: 'server', hostId: 1, eventType: 'host.offline', state: 'healthy', observedAt: 61_000 })
    await store.mutateState((draft) => {
      draft.deliveryJobs[0].state = 'delivered'
      draft.deliveryJobs[0].deliveredAt = new Date(62_000).toISOString()
      draft.incidents[0].notificationDeliveredAt = new Date(62_000).toISOString()
    })
    setNow(63_000)
    expect(await manager.evaluateRecoveries()).toEqual([1])
    expect(store.readState().deliveryJobs.filter((job) => job.kind === 'recovery')).toHaveLength(1)
  })

  it('acknowledges without resolving the incident', async () => {
    const { store, manager, setNow } = await setup()
    await manager.observe({ hostType: 'server', hostId: 1, eventType: 'host.offline', state: 'problem', observedAt: 0 })
    setNow(60_000)
    await manager.evaluatePending()
    const incident = store.readState().incidents[0]
    await manager.acknowledge(incident.id, 7)
    expect(store.readState().incidents[0]).toMatchObject({ state: 'open', acknowledgedBy: 7 })
  })

  it('queues optional reminders only for delivered, unacknowledged incidents', async () => {
    const { store, manager, setNow } = await setup()
    await store.mutateConfig((draft) => {
      draft.rules.find((rule) => rule.eventType === 'host.offline').reminderIntervalSeconds = 60
    })
    await manager.observe({ hostType: 'server', hostId: 1, eventType: 'host.offline', state: 'problem', observedAt: 0 })
    setNow(60_000)
    await manager.evaluatePending()
    await store.mutateState((draft) => { draft.incidents[0].notificationDeliveredAt = new Date(60_000).toISOString() })
    setNow(120_000)
    expect(await manager.evaluateReminders()).toEqual([1])
    expect(store.readState().deliveryJobs.filter((job) => job.kind === 'reminder')).toHaveLength(1)
    await manager.acknowledge(1, 7)
    setNow(180_000)
    expect(await manager.evaluateReminders()).toEqual([])
  })

  it('cancels pending child alerts and inhibits child reminders while the host is offline', async () => {
    const { store, manager, setNow } = await setup()
    await store.mutateConfig((draft) => {
      draft.rules.find((rule) => rule.eventType === 'service.unhealthy').reminderIntervalSeconds = 60
    })
    await manager.observe({ hostType: 'server', hostId: 1, resourceId: 7, eventType: 'service.unhealthy', state: 'problem', observedAt: 0 })
    await manager.observe({ hostType: 'server', hostId: 1, eventType: 'host.offline', state: 'problem', observedAt: 0 })
    setNow(60_000)
    await manager.evaluatePending()
    expect(store.readState().pendingTransitions).toHaveLength(0)

    await store.mutateState((draft) => {
      const incident = {
        ...draft.incidents[0],
        id: nextRelationalId(draft, 'incident'),
        eventKey: 'server:1:7:service.unhealthy',
        resourceId: 7,
        eventType: 'service.unhealthy',
        notificationDeliveredAt: new Date(60_000).toISOString(),
      }
      draft.incidents.push(incident)
    })
    setNow(120_000)
    expect(await manager.evaluateReminders()).toEqual([])
    expect(store.readState().deliveryJobs.filter((job) => job.kind === 'reminder')).toHaveLength(0)
  })

  it('cancels an already queued child delivery as soon as a host outage becomes pending', async () => {
    const { store, manager } = await setup()
    await manager.observe({ hostType: 'server', hostId: 1, resourceId: 7, eventType: 'service.unhealthy', state: 'problem', sequence: 1, observedAt: 0 })
    await manager.observe({ hostType: 'server', hostId: 1, resourceId: 7, eventType: 'service.unhealthy', state: 'problem', sequence: 2, observedAt: 60_000 })
    expect(store.readState().deliveryJobs).toMatchObject([{ state: 'queued' }])
    await manager.observe({ hostType: 'server', hostId: 1, eventType: 'host.offline', state: 'problem', sequence: 3, observedAt: 61_000 })
    expect(store.readState().deliveryJobs[0]).toMatchObject({ state: 'cancelled', lastError: expect.stringContaining('pending host outage') })
  })

  it('preserves an in-flight child delivery so its outcome remains truthful', async () => {
    const { store, manager } = await setup()
    await manager.observe({ hostType: 'server', hostId: 1, resourceId: 7, eventType: 'service.unhealthy', state: 'problem', sequence: 1, observedAt: 0 })
    await manager.observe({ hostType: 'server', hostId: 1, resourceId: 7, eventType: 'service.unhealthy', state: 'problem', sequence: 2, observedAt: 60_000 })
    await store.mutateState((draft) => {
      draft.deliveryJobs[0].state = 'leased'
      draft.deliveryJobs[0].leaseOwner = 'worker'
      draft.deliveryJobs[0].leaseExpiresAt = new Date(90_000).toISOString()
    })

    await manager.observe({ hostType: 'server', hostId: 1, eventType: 'host.offline', state: 'problem', sequence: 3, observedAt: 61_000 })

    expect(store.readState().deliveryJobs[0]).toMatchObject({ state: 'leased', leaseOwner: 'worker' })
  })

  it('restores an inhibited child opening after the host recovers', async () => {
    const { store, manager, setNow } = await setup()
    await manager.observe({ hostType: 'server', hostId: 1, resourceId: 7, eventType: 'service.unhealthy', state: 'problem', sequence: 1, observedAt: 0 })
    await manager.observe({ hostType: 'server', hostId: 1, resourceId: 7, eventType: 'service.unhealthy', state: 'problem', sequence: 2, observedAt: 60_000 })
    await manager.observe({ hostType: 'server', hostId: 1, eventType: 'host.offline', state: 'problem', sequence: 3, observedAt: 61_000 })
    expect(store.readState().deliveryJobs[0].state).toBe('cancelled')

    await manager.observe({ hostType: 'server', hostId: 1, eventType: 'host.offline', state: 'healthy', sequence: 4, observedAt: 62_000 })
    setNow(62_001)
    expect(await manager.evaluateSuppressedOpenings()).toEqual([1])
    expect(store.readState().deliveryJobs).toMatchObject([{ idempotencyKey: '1:1:opening', state: 'queued' }])
  })

  it('rejects duplicate event sequences before they advance debounce', async () => {
    const { store, manager } = await setup()
    await manager.observe({ hostType: 'server', hostId: 1, resourceId: 7, eventType: 'service.unhealthy', state: 'problem', sequence: 4, observedAt: 0 })
    expect((await manager.observe({ hostType: 'server', hostId: 1, resourceId: 7, eventType: 'service.unhealthy', state: 'problem', sequence: 4, observedAt: 60_000 })).reason).toBe('replayed-sequence')
    expect(store.readState().pendingTransitions[0].observations).toBe(1)
    expect(store.readState().incidents).toHaveLength(0)
  })

  it('cancels host incidents and removes live policy when an agent is unlinked', async () => {
    const { store, manager, setNow } = await setup()
    await store.mutateConfig((draft) => {
      const resourceId = nextRelationalId(draft, 'monitoredResource')
      draft.monitoredResources.push({ id: resourceId, hostType: 'server', hostId: 1, family: 'service', key: 'docker.service', name: 'Docker', enabled: true })
    })
    await manager.observe({ hostType: 'server', hostId: 1, eventType: 'host.offline', state: 'problem', observedAt: 0 })
    setNow(60_000)
    await manager.evaluatePending()
    await manager.cancelHost('server', 1)
    expect(store.readState().incidents[0].state).toBe('cancelled')
    expect(store.readState().deliveryJobs[0].state).toBe('cancelled')
    expect(store.readConfig().monitoredResources).toHaveLength(0)
    expect(store.readState().deliveryJobs.some((job) => job.kind === 'recovery')).toBe(false)
  })

  it('cancels active incidents when their resource is no longer monitored', async () => {
    const { store, manager } = await setup()
    await store.mutateConfig((draft) => {
      const resourceId = nextRelationalId(draft, 'monitoredResource')
      draft.monitoredResources.push({ id: resourceId, hostType: 'server', hostId: 1, family: 'service', key: 'docker.service', name: 'Docker', enabled: true })
    })
    await manager.observe({ hostType: 'server', hostId: 1, resourceId: 1, eventType: 'service.unhealthy', state: 'problem', sequence: 1, observedAt: 0 })
    await manager.observe({ hostType: 'server', hostId: 1, resourceId: 1, eventType: 'service.unhealthy', state: 'problem', sequence: 2, observedAt: 60_000 })
    await store.mutateConfig((draft) => { draft.monitoredResources[0].enabled = false })
    expect(await manager.reconcilePolicies({ hostType: 'server', hostId: 1 })).toEqual([1])
    expect(store.readState().incidents[0].state).toBe('cancelled')
    expect(store.readState().normalizedStates).toHaveLength(0)
    expect(store.readState().deliveryJobs[0].state).toBe('cancelled')
  })
})
