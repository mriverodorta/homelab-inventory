import crypto from 'node:crypto'
import { nextRelationalId } from './model.mjs'
import { createNtfyAdapter } from './adapters/ntfy.mjs'
import { createWebhookAdapter } from './adapters/webhook.mjs'
import { resolveHostNotificationPolicy, resolveRule } from './policy-resolver.mjs'

const RETRY_DELAYS_MS = [0, 30_000, 120_000, 600_000, 1_800_000, 7_200_000]
const LEASE_MS = 30_000

function iso(now) {
  return new Date(now).toISOString()
}

function redactError(error) {
  const message = error instanceof Error ? error.message : 'Notification delivery failed.'
  return message.replace(/(bearer|basic)\s+[a-z0-9._~+/=-]+/gi, '$1 [redacted]').slice(0, 1024)
}

function eventFor(incident, kind, idempotencyKey) {
  return {
    version: 1,
    idempotencyKey,
    incidentId: incident.id,
    eventType: incident.eventType,
    kind,
    severity: kind === 'recovery' ? 'info' : incident.severity,
    host: { type: incident.hostType, id: incident.hostId },
    resourceId: incident.resourceId,
    title: kind === 'recovery' ? `${incident.title} recovered` : kind === 'reminder' ? `Reminder: ${incident.title}` : incident.title,
    message: kind === 'recovery' ? `Recovered at ${incident.resolvedAt}.` : incident.summary,
    openedAt: incident.openedAt,
    resolvedAt: incident.resolvedAt,
  }
}

function hostUnavailable(state, incident) {
  if (incident.eventType === 'host.offline') return false
  return state.incidents.some((candidate) => (
    candidate.hostType === incident.hostType
    && candidate.hostId === incident.hostId
    && candidate.eventType === 'host.offline'
    && candidate.state === 'open'
  )) || state.pendingTransitions.some((candidate) => (
    candidate.hostType === incident.hostType
    && candidate.hostId === incident.hostId
    && candidate.eventType === 'host.offline'
  ))
}

export class NotificationDeliveryCoordinator {
  constructor({ store, vault, adapters = null, now = () => Date.now(), pollIntervalMs = 1_000 }) {
    this.store = store
    this.vault = vault
    this.adapters = adapters ?? { ntfy: createNtfyAdapter(), webhook: createWebhookAdapter() }
    this.now = now
    this.pollIntervalMs = pollIntervalMs
    this.workerId = crypto.randomUUID()
    this.timer = null
    this.running = false
  }

  start() {
    if (this.timer) return
    this.timer = setInterval(() => void this.wake(), this.pollIntervalMs)
    this.timer.unref?.()
    void this.wake()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async wake() {
    if (this.running) return false
    this.running = true
    try {
      let processed = false
      while (await this.processNext()) processed = true
      return processed
    } finally {
      this.running = false
    }
  }

  async #leaseNext() {
    const now = this.now()
    const snapshot = this.store.readState()
    const hasWork = snapshot.deliveryJobs.some((job) => (
      (job.state === 'leased' && Date.parse(job.leaseExpiresAt ?? '') <= now)
      || (['queued', 'retrying'].includes(job.state) && Date.parse(job.availableAt) <= now)
    ))
    if (!hasWork) return null
    return this.store.mutateState((draft) => {
      for (const job of draft.deliveryJobs) {
        if (job.state === 'leased' && Date.parse(job.leaseExpiresAt ?? '') <= now) {
          job.state = 'retrying'
          job.leaseOwner = null
          job.leaseExpiresAt = null
        }
      }
      const job = draft.deliveryJobs.find((candidate) => (
        ['queued', 'retrying'].includes(candidate.state)
        && Date.parse(candidate.availableAt) <= now
      ))
      if (!job) return null
      job.state = 'leased'
      job.leaseOwner = this.workerId
      job.leaseExpiresAt = iso(now + LEASE_MS)
      job.updatedAt = iso(now)
      return job
    })
  }

  async processNext() {
    const leased = await this.#leaseNext()
    if (!leased) return false
    const config = this.store.readConfig()
    const state = this.store.readState()
    const contactPoint = config.contactPoints.find((candidate) => candidate.id === leased.contactPointId)
    const incident = state.incidents.find((candidate) => candidate.id === leased.incidentId)
    if (!contactPoint || !incident || !contactPoint.enabled) {
      await this.#cancel(leased.id, 'Notification contact point or incident is unavailable.')
      return true
    }
    if (leased.kind === 'opening' && incident.state !== 'open') {
      await this.#cancel(leased.id, 'Incident resolved before its opening notification was delivered.')
      return true
    }
    const policy = resolveHostNotificationPolicy(config, incident.hostType, incident.hostId, this.now())
    const rule = resolveRule(policy, incident.eventType)
    if (!policy.enabled || !rule?.enabled || !rule.contactPointIds.includes(contactPoint.id)) {
      await this.#cancel(leased.id, 'Notification policy no longer permits this delivery.')
      return true
    }
    if (policy.muted || policy.quiet || hostUnavailable(state, incident)) {
      await this.#defer(leased.id, policy.mutedUntil)
      return true
    }
    const adapter = this.adapters[contactPoint.type]
    if (!adapter) {
      await this.#fail(leased.id, new Error(`Notification adapter ${contactPoint.type} is unavailable.`))
      return true
    }
    let secret = {}
    try {
      if (contactPoint.secretId !== null) secret = JSON.parse(await this.vault.open(contactPoint.secretId))
      const result = await adapter.send({ contactPoint, secret, event: eventFor(incident, leased.kind, leased.idempotencyKey) })
      await this.#succeed(leased.id, result)
    } catch (error) {
      await this.#fail(leased.id, error)
    }
    return true
  }

  async #succeed(jobId, result) {
    const now = this.now()
    await this.store.mutateState((draft) => {
      const job = draft.deliveryJobs.find((candidate) => candidate.id === jobId)
      if (!job || job.leaseOwner !== this.workerId) return
      job.attempts += 1
      job.state = 'delivered'
      job.deliveredAt = iso(now)
      job.leaseOwner = null
      job.leaseExpiresAt = null
      job.lastError = null
      job.updatedAt = iso(now)
      draft.deliveryAttempts.push({
        id: nextRelationalId(draft, 'deliveryAttempt'),
        deliveryJobId: job.id,
        attempt: job.attempts,
        state: 'delivered',
        status: result.status,
        responseExcerpt: result.responseExcerpt,
        error: null,
        attemptedAt: iso(now),
      })
      const incident = draft.incidents.find((candidate) => candidate.id === job.incidentId)
      if (incident && job.kind === 'opening') {
        incident.notificationDeliveredAt ??= iso(now)
        incident.updatedAt = iso(now)
        const config = this.store.readConfig()
        const rule = resolveRule(resolveHostNotificationPolicy(config, incident.hostType, incident.hostId, now), incident.eventType)
        if (rule?.cooldownSeconds > 0) {
          let cooldown = draft.cooldowns.find((candidate) => (
            candidate.hostType === incident.hostType
            && candidate.hostId === incident.hostId
            && candidate.resourceId === incident.resourceId
            && candidate.eventType === incident.eventType
            && candidate.contactPointId === job.contactPointId
          ))
          const fields = {
            hostType: incident.hostType,
            hostId: incident.hostId,
            resourceId: incident.resourceId,
            eventType: incident.eventType,
            contactPointId: job.contactPointId,
            expiresAt: iso(now + rule.cooldownSeconds * 1000),
            updatedAt: iso(now),
          }
          if (cooldown) Object.assign(cooldown, fields)
          else {
            cooldown = { id: nextRelationalId(draft, 'cooldown'), ...fields, createdAt: iso(now) }
            draft.cooldowns.push(cooldown)
          }
        }
      }
    })
  }

  async #fail(jobId, error) {
    const now = this.now()
    const message = redactError(error)
    await this.store.mutateState((draft) => {
      const job = draft.deliveryJobs.find((candidate) => candidate.id === jobId)
      if (!job || job.leaseOwner !== this.workerId) return
      job.attempts += 1
      const exhausted = job.attempts >= RETRY_DELAYS_MS.length
      job.state = exhausted ? 'exhausted' : 'retrying'
      job.availableAt = iso(now + (RETRY_DELAYS_MS[job.attempts] ?? 0))
      job.leaseOwner = null
      job.leaseExpiresAt = null
      job.lastError = message
      job.updatedAt = iso(now)
      draft.deliveryAttempts.push({
        id: nextRelationalId(draft, 'deliveryAttempt'),
        deliveryJobId: job.id,
        attempt: job.attempts,
        state: exhausted ? 'exhausted' : 'failed',
        status: null,
        responseExcerpt: null,
        error: message,
        attemptedAt: iso(now),
      })
    })
  }

  async #cancel(jobId, reason) {
    const now = this.now()
    await this.store.mutateState((draft) => {
      const job = draft.deliveryJobs.find((candidate) => candidate.id === jobId)
      if (!job) return
      job.state = 'cancelled'
      job.leaseOwner = null
      job.leaseExpiresAt = null
      job.lastError = reason
      job.updatedAt = iso(now)
    })
  }

  async #defer(jobId, mutedUntil = null) {
    const now = this.now()
    const mutedUntilMs = Date.parse(mutedUntil ?? '')
    await this.store.mutateState((draft) => {
      const job = draft.deliveryJobs.find((candidate) => candidate.id === jobId)
      if (!job || job.leaseOwner !== this.workerId) return
      job.state = 'retrying'
      job.availableAt = iso(Number.isFinite(mutedUntilMs) && mutedUntilMs > now ? mutedUntilMs : now + 30_000)
      job.leaseOwner = null
      job.leaseExpiresAt = null
      job.updatedAt = iso(now)
    })
  }

  async retry(jobId) {
    const now = this.now()
    const result = await this.store.mutateState((draft) => {
      const job = draft.deliveryJobs.find((candidate) => candidate.id === jobId)
      if (!job) throw new Error(`Notification delivery job ${jobId} does not exist.`)
      if (!['exhausted', 'cancelled'].includes(job.state)) throw new Error('Only exhausted or cancelled deliveries can be retried.')
      job.state = 'queued'
      job.availableAt = iso(now)
      job.lastError = null
      job.updatedAt = iso(now)
      return job
    })
    void this.wake()
    return result
  }

  async sendTest(contactPointId) {
    const config = this.store.readConfig()
    const contactPoint = config.contactPoints.find((candidate) => candidate.id === contactPointId)
    if (!contactPoint) throw new Error(`Notification contact point ${contactPointId} does not exist.`)
    const adapter = this.adapters[contactPoint.type]
    if (!adapter) throw new Error(`Notification adapter ${contactPoint.type} is unavailable.`)
    const secret = contactPoint.secretId === null ? {} : JSON.parse(await this.vault.open(contactPoint.secretId))
    return adapter.send({
      contactPoint,
      secret,
      event: {
        version: 1,
        idempotencyKey: `test:${contactPoint.id}:${crypto.randomUUID()}`,
        incidentId: 0,
        eventType: 'test',
        kind: 'test',
        severity: 'info',
        host: null,
        resourceId: null,
        title: 'Homelab Inventory test notification',
        message: 'This contact point is configured correctly.',
        openedAt: iso(this.now()),
        resolvedAt: null,
      },
    })
  }
}
