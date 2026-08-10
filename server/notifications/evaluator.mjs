import { IncidentManager } from './incident-manager.mjs'
import { nextRelationalId } from './model.mjs'
import { resolveHostNotificationPolicy } from './policy-resolver.mjs'

const ONLINE_AFTER_MS = 90_000
const OFFLINE_AFTER_MS = 5 * 60_000
const MAX_CURRENT_EVIDENCE_AGE_MS = 2 * 60_000

function serviceProblem(service) {
  return service.activeState !== 'active' || (service.lastResult && service.lastResult !== 'success')
}

function containerProblem(container) {
  return container.state !== 'running' || (container.health && container.health !== 'healthy')
}

function containerKey(container) {
  return container.composeService
    ? `${container.runtime}\u0000compose\u0000${container.composeService}`
    : `${container.runtime}\u0000name\u0000${container.name}`
}

function capabilityAvailable(payload, key) {
  const capability = payload.capabilities?.[key]
  return capability === undefined || capability?.state === 'available'
}

function bufferedEvidence(cursor, collectedAt, receivedAt) {
  if (!Number.isFinite(collectedAt)) return { stale: false, stableClockReset: false }
  const previousCollectedAt = Date.parse(cursor?.lastCollectedAt ?? '')
  const previousReceivedAt = Date.parse(cursor?.lastReceivedAt ?? '')
  if (Number.isFinite(previousCollectedAt) && Number.isFinite(previousReceivedAt)) {
    const previousClockOffset = previousReceivedAt - previousCollectedAt
    const currentClockOffset = receivedAt - collectedAt
    const stale = currentClockOffset - previousClockOffset > MAX_CURRENT_EVIDENCE_AGE_MS
    if (!stale) return { stale: false, stableClockReset: false }
    const candidateCollectedAt = Date.parse(cursor?.candidateCollectedAt ?? '')
    const candidateReceivedAt = Date.parse(cursor?.candidateReceivedAt ?? '')
    const agentDelta = collectedAt - candidateCollectedAt
    const serverDelta = receivedAt - candidateReceivedAt
    const stableClockReset = Number.isFinite(agentDelta)
      && Number.isFinite(serverDelta)
      && serverDelta >= 30_000
      && agentDelta >= 0
      && Math.abs(agentDelta - serverDelta) <= 30_000
    return { stale: !stableClockReset, stableClockReset }
  }
  return { stale: receivedAt - collectedAt > MAX_CURRENT_EVIDENCE_AGE_MS, stableClockReset: false }
}

export class NotificationEvaluator {
  constructor({ store, incidentManager = null, now = () => Date.now() }) {
    this.store = store
    this.now = now
    this.incidentManager = incidentManager ?? new IncidentManager({ store, now })
    this.hostQueues = new Map()
  }

  async evaluateHeartbeat(input) {
    if (!this.store.readConfig().enabled) return [{ action: 'ignored', reason: 'notifications-disabled' }]
    const hostType = input.host?.hostType ?? input.hostType
    const hostId = input.host?.hostId ?? input.hostId
    const queueKey = `${hostType}:${hostId}`
    const previous = this.hostQueues.get(queueKey) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(() => this.#evaluateHeartbeat(input))
    this.hostQueues.set(queueKey, current)
    try {
      return await current
    } finally {
      if (this.hostQueues.get(queueKey) === current) this.hostQueues.delete(queueKey)
    }
  }

  async #evaluateHeartbeat(input) {
    const payload = input.payload
    const receivedValue = input.receivedAt ?? this.now()
    const receivedAt = typeof receivedValue === 'number' ? receivedValue : Date.parse(receivedValue)
    if (!Number.isFinite(receivedAt)) throw new Error('Notification heartbeat receivedAt is invalid.')
    const host = input.host ?? {
      hostType: input.hostType,
      hostId: input.hostId,
      name: input.hostName,
    }
    const sequence = Number(payload.sequence)
    const cursor = this.store.readState().evaluationCursors.find((candidate) => (
      candidate.hostType === host.hostType && candidate.hostId === host.hostId
    ))
    if (Number.isSafeInteger(sequence) && cursor && sequence <= cursor.lastSequence) {
      return [{ action: 'ignored', reason: 'replayed-sequence' }]
    }
    const collectedAt = Date.parse(payload.collectedAt ?? '')
    const evidence = bufferedEvidence(cursor, collectedAt, receivedAt)
    if (evidence.stale) {
      await this.#saveCursor(host, sequence, payload.collectedAt, receivedAt, { updateEvidence: false, updateCandidate: true })
      return [{ action: 'ignored', reason: 'buffered-evidence' }]
    }
    const policy = resolveHostNotificationPolicy(this.store.readConfig(), host.hostType, host.hostId, receivedAt)
    if (!policy.enabled) {
      await this.#saveCursor(host, sequence, payload.collectedAt, receivedAt)
      return []
    }
    const results = []
    results.push(await this.incidentManager.observe({
      hostType: host.hostType,
      hostId: host.hostId,
      resourceId: null,
      eventType: 'host.offline',
      state: 'healthy',
      observedAt: receivedAt,
      sequence: payload.sequence,
      title: `${host.name ?? `${host.hostType} ${host.hostId}`} is offline`,
      summary: 'The Homelab Inventory Agent resumed reporting.',
    }))

    for (const resource of policy.resources) {
      if (resource.family === 'service') {
        if (!capabilityAvailable(payload, 'host.services')) {
          results.push(await this.incidentManager.observe({
            hostType: host.hostType,
            hostId: host.hostId,
            resourceId: resource.id,
            eventType: 'service.unhealthy',
            state: 'unknown',
            observedAt: receivedAt,
            sequence: payload.sequence,
            title: `${resource.name} state is unavailable`,
            summary: 'The agent could not collect service state for this heartbeat.',
          }))
          continue
        }
        const service = (payload.services ?? []).find((candidate) => candidate.name === resource.key)
        results.push(await this.incidentManager.observe({
          hostType: host.hostType,
          hostId: host.hostId,
          resourceId: resource.id,
          eventType: 'service.unhealthy',
          state: service ? (serviceProblem(service) ? 'problem' : 'healthy') : 'problem',
          observedAt: receivedAt,
          sequence: payload.sequence,
          title: `${resource.name} is unhealthy`,
          summary: service ? `Service state: ${service.activeState}.` : 'The selected service was not reported.',
        }))
      } else if (resource.family === 'container') {
        if (!capabilityAvailable(payload, 'containers')) {
          for (const eventType of ['container.unhealthy', 'container.missing']) {
            results.push(await this.incidentManager.observe({
              hostType: host.hostType,
              hostId: host.hostId,
              resourceId: resource.id,
              eventType,
              state: 'unknown',
              observedAt: receivedAt,
              sequence: payload.sequence,
              title: `${resource.name} state is unavailable`,
              summary: 'The agent could not collect container state for this heartbeat.',
            }))
          }
          continue
        }
        const container = (payload.containers ?? []).find((candidate) => containerKey(candidate) === resource.key)
        const observations = [
          {
            eventType: 'container.missing',
            state: container ? 'healthy' : 'problem',
            title: `${resource.name} is missing`,
            summary: container ? 'The selected container is present.' : 'The selected container was not reported.',
          },
          {
            eventType: 'container.unhealthy',
            state: container ? (containerProblem(container) ? 'problem' : 'healthy') : 'healthy',
            title: `${resource.name} is unhealthy`,
            summary: container ? `Container state: ${container.state}.` : 'Container health is superseded by the missing state.',
          },
        ]
        for (const observation of observations) {
          results.push(await this.incidentManager.observe({
            hostType: host.hostType,
            hostId: host.hostId,
            resourceId: resource.id,
            observedAt: receivedAt,
            sequence: payload.sequence,
            ...observation,
          }))
        }
      } else if (resource.family === 'storage-health') {
        if (!capabilityAvailable(payload, 'storage.health')) {
          for (const eventType of ['storage.warning', 'storage.failed']) {
            results.push(await this.incidentManager.observe({
              hostType: host.hostType,
              hostId: host.hostId,
              resourceId: resource.id,
              eventType,
              state: 'unknown',
              observedAt: receivedAt,
              sequence: payload.sequence,
              title: `${resource.name} health is unavailable`,
              summary: 'The agent could not collect storage health for this heartbeat.',
            }))
          }
          continue
        }
        const storage = (payload.storageHealth ?? []).find((candidate) => candidate.deviceId === resource.key)
        const state = storage?.state ?? 'unknown'
        for (const eventType of ['storage.warning', 'storage.failed']) {
          results.push(await this.incidentManager.observe({
            hostType: host.hostType,
            hostId: host.hostId,
            resourceId: resource.id,
            eventType,
            state: state === eventType.split('.')[1] ? 'problem' : state === 'unknown' ? 'unknown' : 'healthy',
            observedAt: receivedAt,
            sequence: payload.sequence,
            title: `${resource.name} health is ${state}`,
            summary: `Storage health state: ${state}.`,
          }))
        }
      }
    }
    await this.#saveCursor(host, sequence, payload.collectedAt, receivedAt)
    return results
  }

  async #saveCursor(host, sequence, collectedAt, receivedAt, { updateEvidence = true, updateCandidate = false } = {}) {
    if (!Number.isSafeInteger(sequence) || sequence < 0) return
    await this.store.mutateState((draft) => {
      let cursor = draft.evaluationCursors.find((candidate) => (
        candidate.hostType === host.hostType && candidate.hostId === host.hostId
      ))
      const values = {
        hostType: host.hostType,
        hostId: host.hostId,
        lastSequence: sequence,
        lastCollectedAt: updateEvidence && !Number.isNaN(Date.parse(collectedAt ?? ''))
          ? new Date(collectedAt).toISOString()
          : cursor?.lastCollectedAt ?? null,
        lastReceivedAt: updateEvidence ? new Date(receivedAt).toISOString() : cursor?.lastReceivedAt ?? null,
        candidateCollectedAt: updateCandidate && !Number.isNaN(Date.parse(collectedAt ?? ''))
          ? new Date(collectedAt).toISOString()
          : updateEvidence ? null : cursor?.candidateCollectedAt ?? null,
        candidateReceivedAt: updateCandidate
          ? new Date(receivedAt).toISOString()
          : updateEvidence ? null : cursor?.candidateReceivedAt ?? null,
      }
      if (cursor) Object.assign(cursor, values)
      else {
        cursor = { id: nextRelationalId(draft, 'evaluationCursor'), ...values }
        draft.evaluationCursors.push(cursor)
      }
    })
  }

  async evaluateHostStatuses(hosts, now = this.now()) {
    const results = []
    for (const host of hosts) {
      const cursor = this.store.readState().evaluationCursors.find((candidate) => (
        candidate.hostType === host.hostType && candidate.hostId === host.hostId
      ))
      const lastSeenAt = cursor?.lastReceivedAt ?? host.lastSeenAt ?? null
      const lastSeen = Date.parse(lastSeenAt ?? '')
      if (!Number.isFinite(lastSeen)) continue
      const age = now - lastSeen
      const state = age > OFFLINE_AFTER_MS ? 'problem' : age <= ONLINE_AFTER_MS ? 'healthy' : 'unknown'
      results.push(await this.incidentManager.observe({
        hostType: host.hostType,
        hostId: host.hostId,
        resourceId: null,
        eventType: 'host.offline',
        state,
        observedAt: now,
        title: `${host.name ?? `${host.hostType} ${host.hostId}`} is offline`,
        summary: `Last heartbeat was received at ${lastSeenAt}.`,
      }))
    }
    await this.incidentManager.evaluatePending(now)
    return results
  }
}
