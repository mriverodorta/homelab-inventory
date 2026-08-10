import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NotificationEvaluator } from './evaluator.mjs'
import { nextRelationalId } from './model.mjs'
import { NotificationStore } from './store.mjs'

const directories = []
afterEach(async () => Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))))

async function setup() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'notification-evaluator-'))
  directories.push(dataDir)
  const store = await new NotificationStore({ dataDir }).init()
  await store.mutateConfig((draft) => {
    draft.enabled = true
    const id = nextRelationalId(draft, 'monitoredResource')
    draft.monitoredResources.push({ id, hostType: 'server', hostId: 1, family: 'container', key: 'docker\u0000compose\u0000app', name: 'App', enabled: true })
  })
  return { store, evaluator: new NotificationEvaluator({ store }) }
}

describe('NotificationEvaluator', () => {
  it('does not persist heartbeat evidence while notifications are globally disabled', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'notification-evaluator-disabled-'))
    directories.push(dataDir)
    const store = await new NotificationStore({ dataDir }).init()
    const evaluator = new NotificationEvaluator({ store })
    const updatedAt = store.readState().updatedAt

    expect(await evaluator.evaluateHeartbeat({
      hostType: 'server', hostId: 1, receivedAt: new Date(60_000).toISOString(),
      payload: { sequence: 1, collectedAt: new Date(60_000).toISOString(), containers: [] },
    })).toEqual([{ action: 'ignored', reason: 'notifications-disabled' }])
    expect(store.readState()).toMatchObject({ updatedAt, evaluationCursors: [], normalizedStates: [], incidents: [] })
  })

  it('maps selected container identity without monitoring unselected containers', async () => {
    const { store, evaluator } = await setup()
    await evaluator.evaluateHeartbeat({
      host: { hostType: 'server', hostId: 1, name: 'Host' },
      receivedAt: new Date(60_000).toISOString(),
      payload: { sequence: 1, containers: [{ runtime: 'docker', name: 'random', state: 'exited' }, { runtime: 'docker', composeService: 'app', name: 'app-1', state: 'running' }] },
    })
    expect(store.readState().normalizedStates.some((state) => state.eventType === 'container.unhealthy' && state.state === 'healthy')).toBe(true)
    expect(store.readState().normalizedStates.some((state) => state.title?.includes('random'))).toBe(false)
  })

  it('accepts the canonical heartbeat sink envelope from the agent route', async () => {
    const { store, evaluator } = await setup()
    await evaluator.evaluateHeartbeat({
      deviceId: 4,
      hostType: 'server',
      hostId: 1,
      receivedAt: new Date(60_000).toISOString(),
      payload: { sequence: 2, containers: [{ runtime: 'docker', composeService: 'app', name: 'app-1', state: 'running' }] },
    })

    expect(store.readState().normalizedStates).toEqual(expect.arrayContaining([
      expect.objectContaining({ hostType: 'server', hostId: 1, eventType: 'host.offline', state: 'healthy', sequence: 2 }),
      expect.objectContaining({ hostType: 'server', hostId: 1, eventType: 'container.unhealthy', state: 'healthy', sequence: 2 }),
    ]))
  })

  it('marks hosts problematic only after the five-minute offline threshold', async () => {
    const { store, evaluator } = await setup()
    await evaluator.evaluateHostStatuses([{ hostType: 'server', hostId: 1, lastSeenAt: new Date(0).toISOString() }], 299_000)
    expect(store.readState().pendingTransitions).toHaveLength(0)
    await evaluator.evaluateHostStatuses([{ hostType: 'server', hostId: 1, lastSeenAt: new Date(0).toISOString() }], 301_000)
    expect(store.readState().pendingTransitions).toHaveLength(1)
  })

  it('uses the persisted server receipt time in offline incident summaries', async () => {
    const { store, evaluator } = await setup()
    const receivedAt = new Date(60_000).toISOString()
    await store.mutateState((draft) => {
      draft.evaluationCursors.push({
        id: nextRelationalId(draft, 'evaluationCursor'), hostType: 'server', hostId: 1,
        lastSequence: 1, lastCollectedAt: receivedAt, lastReceivedAt: receivedAt,
        candidateCollectedAt: null, candidateReceivedAt: null,
      })
    })

    await evaluator.evaluateHostStatuses([{ hostType: 'server', hostId: 1, lastSeenAt: new Date(120_000).toISOString() }], 361_000)

    expect(store.readState().pendingTransitions[0].summary).toContain(receivedAt)
  })

  it('treats unavailable container collection as unknown instead of missing', async () => {
    const { store, evaluator } = await setup()
    await evaluator.evaluateHeartbeat({
      hostType: 'server', hostId: 1, receivedAt: new Date(60_000).toISOString(),
      payload: {
        sequence: 3,
        collectedAt: new Date(60_000).toISOString(),
        capabilities: { containers: { state: 'permission-blocked' } },
        containers: [],
      },
    })
    expect(store.readState().normalizedStates.filter((state) => state.eventType.startsWith('container.')))
      .toEqual(expect.arrayContaining([expect.objectContaining({ state: 'unknown' })]))
    expect(store.readState().pendingTransitions).toHaveLength(0)
  })

  it('resolves the alternate container state when a selected container changes between missing and unhealthy', async () => {
    const { store, evaluator } = await setup()
    await evaluator.evaluateHeartbeat({
      hostType: 'server', hostId: 1, receivedAt: new Date(60_000).toISOString(),
      payload: { sequence: 1, collectedAt: new Date(60_000).toISOString(), containers: [] },
    })
    await evaluator.evaluateHeartbeat({
      hostType: 'server', hostId: 1, receivedAt: new Date(120_000).toISOString(),
      payload: {
        sequence: 2,
        collectedAt: new Date(120_000).toISOString(),
        containers: [{ runtime: 'docker', composeService: 'app', name: 'app-1', state: 'exited' }],
      },
    })

    expect(store.readState().normalizedStates).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'container.missing', state: 'healthy' }),
      expect.objectContaining({ eventType: 'container.unhealthy', state: 'problem' }),
    ]))
    expect(store.readState().pendingTransitions).toEqual([
      expect.objectContaining({ eventType: 'container.unhealthy' }),
    ])
  })

  it('ignores buffered evidence and persists the sequence cursor across restart', async () => {
    const { store, evaluator } = await setup()
    expect(await evaluator.evaluateHeartbeat({
      hostType: 'server', hostId: 1, receivedAt: new Date(600_000).toISOString(),
      payload: { sequence: 20, collectedAt: new Date(0).toISOString(), containers: [] },
    })).toEqual([{ action: 'ignored', reason: 'buffered-evidence' }])
    const restarted = new NotificationEvaluator({ store })
    expect(await restarted.evaluateHeartbeat({
      hostType: 'server', hostId: 1, receivedAt: new Date(601_000).toISOString(),
      payload: { sequence: 20, collectedAt: new Date(601_000).toISOString(), containers: [] },
    })).toEqual([{ action: 'ignored', reason: 'replayed-sequence' }])
    expect(store.readState().pendingTransitions).toHaveLength(0)
    expect(store.readState().evaluationCursors).toMatchObject([{ lastSequence: 20 }])
  })

  it('does not let buffered delivery timestamps recover an offline host', async () => {
    const { store, evaluator } = await setup()
    await evaluator.evaluateHeartbeat({
      hostType: 'server', hostId: 1, receivedAt: new Date(60_000).toISOString(),
      payload: { sequence: 1, collectedAt: new Date(60_000).toISOString(), containers: [] },
    })
    await evaluator.evaluateHostStatuses([{ hostType: 'server', hostId: 1, lastSeenAt: new Date(600_000).toISOString() }], 361_000)
    await evaluator.evaluateHostStatuses([{ hostType: 'server', hostId: 1, lastSeenAt: new Date(600_000).toISOString() }], 421_000)
    expect(store.readState().incidents).toMatchObject([{ eventType: 'host.offline', state: 'open' }])

    await evaluator.evaluateHeartbeat({
      hostType: 'server', hostId: 1, receivedAt: new Date(600_000).toISOString(),
      payload: { sequence: 2, collectedAt: new Date(120_000).toISOString(), containers: [] },
    })
    await evaluator.evaluateHostStatuses([{ hostType: 'server', hostId: 1, lastSeenAt: new Date(600_000).toISOString() }], 600_001)
    expect(store.readState().incidents[0].state).toBe('open')
    expect(store.readState().evaluationCursors).toMatchObject([{
      lastSequence: 2,
      lastCollectedAt: new Date(60_000).toISOString(),
      lastReceivedAt: new Date(60_000).toISOString(),
    }])
  })

  it('uses relative clock offset so a consistently skewed agent remains valid', async () => {
    const { store, evaluator } = await setup()
    await store.mutateState((draft) => {
      draft.evaluationCursors.push({
        id: nextRelationalId(draft, 'evaluationCursor'), hostType: 'server', hostId: 1,
        lastSequence: 4, lastCollectedAt: new Date(0).toISOString(), lastReceivedAt: new Date(300_000).toISOString(),
      })
    })
    const results = await evaluator.evaluateHeartbeat({
      hostType: 'server', hostId: 1, receivedAt: new Date(360_000).toISOString(),
      payload: { sequence: 5, collectedAt: new Date(60_000).toISOString(), containers: [] },
    })
    expect(results.some((result) => result.reason === 'buffered-evidence')).toBe(false)
    expect(store.readState().evaluationCursors).toMatchObject([{ lastSequence: 5, lastReceivedAt: new Date(360_000).toISOString() }])
  })

  it('adopts a stable clock correction without accepting a rapidly replayed backlog', async () => {
    const { store, evaluator } = await setup()
    await store.mutateState((draft) => {
      draft.evaluationCursors.push({
        id: nextRelationalId(draft, 'evaluationCursor'), hostType: 'server', hostId: 1,
        lastSequence: 4, lastCollectedAt: new Date(300_000).toISOString(), lastReceivedAt: new Date(300_000).toISOString(),
        candidateCollectedAt: null, candidateReceivedAt: null,
      })
    })
    expect(await evaluator.evaluateHeartbeat({
      hostType: 'server', hostId: 1, receivedAt: new Date(360_000).toISOString(),
      payload: { sequence: 5, collectedAt: new Date(60_000).toISOString(), containers: [] },
    })).toEqual([{ action: 'ignored', reason: 'buffered-evidence' }])
    const accepted = await evaluator.evaluateHeartbeat({
      hostType: 'server', hostId: 1, receivedAt: new Date(420_000).toISOString(),
      payload: { sequence: 6, collectedAt: new Date(120_000).toISOString(), containers: [] },
    })
    expect(accepted.some((result) => result.reason === 'buffered-evidence')).toBe(false)
    expect(store.readState().evaluationCursors).toMatchObject([{
      lastSequence: 6,
      lastCollectedAt: new Date(120_000).toISOString(),
      lastReceivedAt: new Date(420_000).toISOString(),
      candidateCollectedAt: null,
      candidateReceivedAt: null,
    }])
  })
})
