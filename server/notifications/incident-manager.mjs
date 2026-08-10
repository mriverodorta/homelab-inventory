import { nextRelationalId, notificationHostKey } from './model.mjs'
import { resolveHostNotificationPolicy, resolveRule } from './policy-resolver.mjs'

function timestamp(now) {
  return new Date(now).toISOString()
}

function eventKeyFor(observation) {
  return [
    notificationHostKey(observation.hostType, observation.hostId),
    observation.resourceId ?? 0,
    observation.eventType,
  ].join(':')
}

function jobKey(incidentId, contactPointId, kind, occurrence = null) {
  return [incidentId, contactPointId, kind, occurrence].filter((value) => value !== null).join(':')
}

function contactPointsFor(config, rule) {
  const enabled = new Set(config.contactPoints.filter((point) => point.enabled).map((point) => point.id))
  return [...new Set(rule.contactPointIds)].filter((id) => enabled.has(id))
}

function cooldownActive(draft, incident, contactPointId, now) {
  return draft.cooldowns.some((cooldown) => (
    cooldown.hostType === incident.hostType
    && cooldown.hostId === incident.hostId
    && cooldown.resourceId === incident.resourceId
    && cooldown.eventType === incident.eventType
    && cooldown.contactPointId === contactPointId
    && Date.parse(cooldown.expiresAt) > now
  ))
}

function queueJobs(draft, config, incident, rule, kind, now, occurrence = null, recipientIds = null) {
  const recipients = recipientIds === null
    ? contactPointsFor(config, rule)
    : contactPointsFor(config, rule).filter((id) => recipientIds.has(id))
  for (const contactPointId of recipients) {
    if (kind === 'opening' && cooldownActive(draft, incident, contactPointId, now)) continue
    const idempotencyKey = jobKey(incident.id, contactPointId, kind, occurrence)
    if (draft.deliveryJobs.some((job) => job.idempotencyKey === idempotencyKey)) continue
    draft.deliveryJobs.push({
      id: nextRelationalId(draft, 'deliveryJob'),
      incidentId: incident.id,
      contactPointId,
      kind,
      state: 'queued',
      idempotencyKey,
      attempts: 0,
      availableAt: timestamp(now),
      leaseOwner: null,
      leaseExpiresAt: null,
      deliveredAt: null,
      lastError: null,
      createdAt: timestamp(now),
      updatedAt: timestamp(now),
    })
  }
}

function restoreCancelledOpeningJobs(draft, config, incident, rule, now) {
  let restored = false
  for (const contactPointId of contactPointsFor(config, rule)) {
    const job = draft.deliveryJobs.find((candidate) => (
      candidate.idempotencyKey === jobKey(incident.id, contactPointId, 'opening')
    ))
    if (!job || job.state !== 'cancelled' || cooldownActive(draft, incident, contactPointId, now)) continue
    job.state = 'queued'
    job.availableAt = timestamp(now)
    job.leaseOwner = null
    job.leaseExpiresAt = null
    job.lastError = null
    job.updatedAt = timestamp(now)
    restored = true
  }
  return restored
}

function addTransition(draft, incident, from, to, reason, now) {
  draft.transitions.push({
    id: nextRelationalId(draft, 'transition'),
    incidentId: incident.id,
    from,
    to,
    reason,
    occurredAt: timestamp(now),
  })
}

function hostIncidentUnavailable(draft, hostType, hostId) {
  return draft.incidents.some((incident) => (
    incident.hostType === hostType
    && incident.hostId === hostId
    && incident.eventType === 'host.offline'
    && incident.state === 'open'
  )) || draft.pendingTransitions.some((pending) => (
    pending.hostType === hostType
    && pending.hostId === hostId
    && pending.eventType === 'host.offline'
  ))
}

function cancelPendingChildDeliveries(draft, hostType, hostId, now) {
  const childIncidentIds = new Set(draft.incidents
    .filter((incident) => incident.hostType === hostType && incident.hostId === hostId && incident.eventType !== 'host.offline')
    .map((incident) => incident.id))
  for (const job of draft.deliveryJobs) {
    if (!childIncidentIds.has(job.incidentId) || !['queued', 'retrying'].includes(job.state)) continue
    job.state = 'cancelled'
    job.leaseOwner = null
    job.leaseExpiresAt = null
    job.lastError = 'Delivery inhibited by a pending host outage.'
    job.updatedAt = timestamp(now)
  }
}

export class IncidentManager {
  constructor({ store, now = () => Date.now() }) {
    this.store = store
    this.now = now
  }

  async observe(observation) {
    const now = observation.observedAt ?? this.now()
    const config = this.store.readConfig()
    const policy = resolveHostNotificationPolicy(config, observation.hostType, observation.hostId, now)
    const rule = resolveRule(policy, observation.eventType)
    if (!policy.enabled || !rule?.enabled) return { action: 'ignored', reason: 'disabled' }
    const eventKey = eventKeyFor(observation)
    if (observation.eventType === 'host.offline' && (observation.sequence === undefined || observation.sequence === null)) {
      const snapshot = this.store.readState()
      const normalized = snapshot.normalizedStates.find((state) => state.eventKey === eventKey)
      const pending = snapshot.pendingTransitions.find((candidate) => candidate.eventKey === eventKey)
      const incident = snapshot.incidents.find((candidate) => candidate.eventKey === eventKey && candidate.state === 'open')
      if (normalized?.state === observation.state) {
        if (observation.state === 'problem' && pending) return { action: 'pending', pendingId: pending.id }
        if (observation.state === 'problem' && incident) return { action: 'unchanged', incidentId: incident.id }
        if (observation.state === 'unknown' && !pending) return { action: 'unchanged' }
        if (observation.state === 'healthy' && !pending && !incident) return { action: 'unchanged' }
      }
    }

    return this.store.mutateState((draft) => {
      draft.lastEvaluatedAt = timestamp(now)
      let normalized = draft.normalizedStates.find((state) => state.eventKey === eventKey)
      if (normalized && observation.sequence !== undefined && observation.sequence !== null
        && normalized.sequence !== null && observation.sequence <= normalized.sequence) {
        return { action: 'ignored', reason: 'replayed-sequence' }
      }
      if (!normalized) {
        normalized = {
          id: nextRelationalId(draft, 'normalizedState'),
          eventKey,
          hostType: observation.hostType,
          hostId: observation.hostId,
          resourceId: observation.resourceId ?? null,
          eventType: observation.eventType,
          state: 'unknown',
          firstObservedAt: timestamp(now),
          lastObservedAt: timestamp(now),
          sequence: observation.sequence ?? null,
        }
        draft.normalizedStates.push(normalized)
      }

      const previousState = normalized.state
      normalized.state = observation.state
      normalized.lastObservedAt = timestamp(now)
      normalized.sequence = observation.sequence ?? normalized.sequence
      normalized.title = observation.title ?? normalized.title ?? observation.eventType
      normalized.summary = observation.summary ?? normalized.summary ?? ''

      const pending = draft.pendingTransitions.find((candidate) => candidate.eventKey === eventKey)
      const incident = draft.incidents.find((candidate) => candidate.eventKey === eventKey && candidate.state === 'open')

      if (observation.state === 'healthy' || observation.state === 'unknown') {
        if (pending) draft.pendingTransitions.splice(draft.pendingTransitions.indexOf(pending), 1)
        if (!incident || observation.state !== 'healthy') return { action: pending ? 'cancelled' : 'observed', previousState }
        const from = incident.state
        incident.state = 'resolved'
        incident.resolvedAt = timestamp(now)
        incident.updatedAt = timestamp(now)
        addTransition(draft, incident, from, 'resolved', 'healthy-observation', now)
        const openingRecipients = new Set(draft.deliveryJobs
          .filter((job) => job.incidentId === incident.id && job.kind === 'opening' && job.state === 'delivered')
          .map((job) => job.contactPointId))
        if (openingRecipients.size > 0) queueJobs(draft, config, incident, rule, 'recovery', now, null, openingRecipients)
        return { action: 'resolved', incidentId: incident.id }
      }

      if (observation.state !== 'problem') return { action: 'observed', previousState }
      if (observation.eventType !== 'host.offline' && hostIncidentUnavailable(draft, observation.hostType, observation.hostId)) {
        if (pending) draft.pendingTransitions.splice(draft.pendingTransitions.indexOf(pending), 1)
        return { action: 'inhibited', reason: 'host-offline' }
      }
      if (incident) return { action: 'unchanged', incidentId: incident.id }

      let currentPending = pending
      if (!currentPending) {
        currentPending = {
          id: nextRelationalId(draft, 'pendingTransition'),
          eventKey,
          hostType: observation.hostType,
          hostId: observation.hostId,
          resourceId: observation.resourceId ?? null,
          eventType: observation.eventType,
          severity: rule.severity,
          title: normalized.title,
          summary: normalized.summary,
          firstObservedAt: timestamp(now),
          lastObservedAt: timestamp(now),
          observations: 1,
          dueAt: timestamp(now + rule.debounceSeconds * 1000),
        }
        draft.pendingTransitions.push(currentPending)
      } else {
        currentPending.lastObservedAt = timestamp(now)
        currentPending.observations += 1
      }
      if (observation.eventType === 'host.offline') {
        draft.pendingTransitions = draft.pendingTransitions.filter((candidate) => (
          candidate.eventKey === eventKey
          || candidate.hostType !== observation.hostType
          || candidate.hostId !== observation.hostId
        ))
        cancelPendingChildDeliveries(draft, observation.hostType, observation.hostId, now)
      }

      const minimumObservations = observation.eventType === 'service.unhealthy'
        || observation.eventType.startsWith('container.')
        ? 2
        : 1
      const enoughTime = now >= Date.parse(currentPending.dueAt)
      const firstObserved = Date.parse(currentPending.firstObservedAt)
      const enoughSpacing = minimumObservations === 1 || now - firstObserved >= 60_000
      if (!enoughTime || currentPending.observations < minimumObservations || !enoughSpacing) {
        return { action: 'pending', pendingId: currentPending.id }
      }

      return this.#openFromPending(draft, config, policy, rule, currentPending, now)
    })
  }

  async evaluatePending(evaluatedAt = this.now()) {
    const now = evaluatedAt
    const config = this.store.readConfig()
    const snapshot = this.store.readState()
    const hasDueWork = snapshot.pendingTransitions.some((pending) => {
      if (now < Date.parse(pending.dueAt)) return false
      const minimumObservations = pending.eventType === 'service.unhealthy' || pending.eventType.startsWith('container.') ? 2 : 1
      if (pending.observations < minimumObservations) return false
      const policy = resolveHostNotificationPolicy(config, pending.hostType, pending.hostId, now)
      const rule = resolveRule(policy, pending.eventType)
      return !policy.enabled || !rule?.enabled
        || pending.eventType === 'host.offline'
        || !hostIncidentUnavailable(snapshot, pending.hostType, pending.hostId)
    })
    if (!hasDueWork) return []
    return this.store.mutateState((draft) => {
      const opened = []
      for (const pending of [...draft.pendingTransitions]) {
        if (now < Date.parse(pending.dueAt)) continue
        const minimumObservations = pending.eventType === 'service.unhealthy' || pending.eventType.startsWith('container.') ? 2 : 1
        if (pending.observations < minimumObservations) continue
        const policy = resolveHostNotificationPolicy(config, pending.hostType, pending.hostId, now)
        const rule = resolveRule(policy, pending.eventType)
        if (!policy.enabled || !rule?.enabled) {
          draft.pendingTransitions.splice(draft.pendingTransitions.indexOf(pending), 1)
          continue
        }
        if (pending.eventType !== 'host.offline' && hostIncidentUnavailable(draft, pending.hostType, pending.hostId)) {
          draft.pendingTransitions.splice(draft.pendingTransitions.indexOf(pending), 1)
          continue
        }
        const result = this.#openFromPending(draft, config, policy, rule, pending, now)
        if (result.action === 'opened') opened.push(result.incidentId)
      }
      draft.lastEvaluatedAt = timestamp(now)
      return opened
    })
  }

  async evaluateReminders(evaluatedAt = this.now()) {
    const now = evaluatedAt
    const config = this.store.readConfig()
    const snapshot = this.store.readState()
    const hasDueReminder = snapshot.incidents.some((incident) => {
      if (incident.state !== 'open' || incident.acknowledgedAt || !incident.notificationDeliveredAt) return false
      if (incident.eventType !== 'host.offline' && hostIncidentUnavailable(snapshot, incident.hostType, incident.hostId)) return false
      const policy = resolveHostNotificationPolicy(config, incident.hostType, incident.hostId, now)
      const rule = resolveRule(policy, incident.eventType)
      const interval = rule?.reminderIntervalSeconds
      const lastSentAt = Date.parse(incident.lastReminderAt ?? incident.notificationDeliveredAt)
      return policy.enabled && !policy.muted && !policy.quiet && rule?.enabled && interval
        && Number.isFinite(lastSentAt) && now - lastSentAt >= interval * 1000
    })
    if (!hasDueReminder) return []
    return this.store.mutateState((draft) => {
      const reminded = []
      for (const incident of draft.incidents) {
        if (incident.state !== 'open' || incident.acknowledgedAt || !incident.notificationDeliveredAt) continue
        if (incident.eventType !== 'host.offline' && hostIncidentUnavailable(draft, incident.hostType, incident.hostId)) continue
        const policy = resolveHostNotificationPolicy(config, incident.hostType, incident.hostId, now)
        const rule = resolveRule(policy, incident.eventType)
        const interval = rule?.reminderIntervalSeconds
        if (!policy.enabled || policy.muted || policy.quiet || !rule?.enabled || !interval) continue
        const lastSentAt = Date.parse(incident.lastReminderAt ?? incident.notificationDeliveredAt)
        if (!Number.isFinite(lastSentAt) || now - lastSentAt < interval * 1000) continue
        const occurrence = timestamp(now)
        const before = draft.deliveryJobs.length
        queueJobs(draft, config, incident, rule, 'reminder', now, occurrence)
        if (draft.deliveryJobs.length === before) continue
        incident.lastReminderAt = occurrence
        incident.updatedAt = occurrence
        reminded.push(incident.id)
      }
      return reminded
    })
  }

  async evaluateSuppressedOpenings(evaluatedAt = this.now()) {
    const now = evaluatedAt
    const config = this.store.readConfig()
    const snapshot = this.store.readState()
    const hasOpeningOpportunity = snapshot.incidents.some((incident) => {
      if (incident.state !== 'open') return false
      if (incident.eventType !== 'host.offline' && hostIncidentUnavailable(snapshot, incident.hostType, incident.hostId)) return false
      const policy = resolveHostNotificationPolicy(config, incident.hostType, incident.hostId, now)
      const rule = resolveRule(policy, incident.eventType)
      if (!policy.enabled || policy.muted || policy.quiet || !rule?.enabled) return false
      return contactPointsFor(config, rule).some((contactPointId) => {
        const job = snapshot.deliveryJobs.find((candidate) => (
          candidate.idempotencyKey === jobKey(incident.id, contactPointId, 'opening')
        ))
        return (!job || job.state === 'cancelled') && !cooldownActive(snapshot, incident, contactPointId, now)
      })
    })
    if (!hasOpeningOpportunity) return []
    return this.store.mutateState((draft) => {
      const queued = []
      for (const incident of draft.incidents) {
        if (incident.state !== 'open') continue
        if (incident.eventType !== 'host.offline' && hostIncidentUnavailable(draft, incident.hostType, incident.hostId)) continue
        const policy = resolveHostNotificationPolicy(config, incident.hostType, incident.hostId, now)
        const rule = resolveRule(policy, incident.eventType)
        if (!policy.enabled || policy.muted || policy.quiet || !rule?.enabled) continue
        const restored = restoreCancelledOpeningJobs(draft, config, incident, rule, now)
        const before = draft.deliveryJobs.length
        queueJobs(draft, config, incident, rule, 'opening', now)
        if (restored || draft.deliveryJobs.length > before) queued.push(incident.id)
      }
      return queued
    })
  }

  async evaluateRecoveries(evaluatedAt = this.now()) {
    const now = evaluatedAt
    const config = this.store.readConfig()
    const snapshot = this.store.readState()
    const hasRecoveryOpportunity = snapshot.incidents.some((incident) => {
      if (incident.state !== 'resolved') return false
      const policy = resolveHostNotificationPolicy(config, incident.hostType, incident.hostId, now)
      const rule = resolveRule(policy, incident.eventType)
      if (!policy.enabled || !rule?.enabled) return false
      const delivered = new Set(snapshot.deliveryJobs
        .filter((job) => job.incidentId === incident.id && job.kind === 'opening' && job.state === 'delivered')
        .map((job) => job.contactPointId))
      const recovered = new Set(snapshot.deliveryJobs
        .filter((job) => job.incidentId === incident.id && job.kind === 'recovery')
        .map((job) => job.contactPointId))
      return contactPointsFor(config, rule).some((contactPointId) => delivered.has(contactPointId) && !recovered.has(contactPointId))
    })
    if (!hasRecoveryOpportunity) return []
    return this.store.mutateState((draft) => {
      const queued = []
      for (const incident of draft.incidents) {
        if (incident.state !== 'resolved') continue
        const policy = resolveHostNotificationPolicy(config, incident.hostType, incident.hostId, now)
        const rule = resolveRule(policy, incident.eventType)
        if (!policy.enabled || !rule?.enabled) continue
        const openingRecipients = new Set(draft.deliveryJobs
          .filter((job) => job.incidentId === incident.id && job.kind === 'opening' && job.state === 'delivered')
          .map((job) => job.contactPointId))
        const recoveredRecipients = new Set(draft.deliveryJobs
          .filter((job) => job.incidentId === incident.id && job.kind === 'recovery')
          .map((job) => job.contactPointId))
        for (const contactPointId of recoveredRecipients) openingRecipients.delete(contactPointId)
        if (openingRecipients.size === 0) continue
        const before = draft.deliveryJobs.length
        queueJobs(draft, config, incident, rule, 'recovery', now, null, openingRecipients)
        if (draft.deliveryJobs.length > before) queued.push(incident.id)
      }
      return queued
    })
  }

  async cancelHost(hostType, hostId, reason = 'agent-unlinked') {
    const now = this.now()
    await this.store.mutateConfig((draft) => {
      const resourceIds = new Set(draft.monitoredResources
        .filter((resource) => resource.hostType === hostType && resource.hostId === hostId)
        .map((resource) => resource.id))
      draft.hostOverrides = draft.hostOverrides.filter((override) => override.hostType !== hostType || override.hostId !== hostId)
      draft.monitoredResources = draft.monitoredResources.filter((resource) => resource.hostType !== hostType || resource.hostId !== hostId)
      for (const override of draft.hostOverrides) {
        override.monitoredResourceIds = override.monitoredResourceIds.filter((id) => !resourceIds.has(id))
      }
    })
    return this.store.mutateState((draft) => {
      draft.pendingTransitions = draft.pendingTransitions.filter((pending) => pending.hostType !== hostType || pending.hostId !== hostId)
      draft.normalizedStates = draft.normalizedStates.filter((state) => state.hostType !== hostType || state.hostId !== hostId)
      draft.evaluationCursors = draft.evaluationCursors.filter((cursor) => cursor.hostType !== hostType || cursor.hostId !== hostId)
      draft.cooldowns = draft.cooldowns.filter((cooldown) => cooldown.hostType !== hostType || cooldown.hostId !== hostId)
      for (const incident of draft.incidents) {
        if (incident.hostType !== hostType || incident.hostId !== hostId || incident.state !== 'open') continue
        incident.state = 'cancelled'
        incident.updatedAt = timestamp(now)
        addTransition(draft, incident, 'open', 'cancelled', reason, now)
      }
      const hostIncidentIds = new Set(draft.incidents
        .filter((incident) => incident.hostType === hostType && incident.hostId === hostId)
        .map((incident) => incident.id))
      for (const job of draft.deliveryJobs) {
        if (!hostIncidentIds.has(job.incidentId) || !['queued', 'retrying'].includes(job.state)) continue
        job.state = 'cancelled'
        job.leaseOwner = null
        job.leaseExpiresAt = null
        job.lastError = 'Delivery cancelled because the monitored host was disconnected.'
        job.updatedAt = timestamp(now)
      }
      return { hostType, hostId, cancelled: true }
    })
  }

  async reconcilePolicies({ hostType = null, hostId = null, reason = 'notification-policy-changed' } = {}) {
    const now = this.now()
    const config = this.store.readConfig()
    const inScope = (record) => (
      (hostType === null || record.hostType === hostType)
      && (hostId === null || record.hostId === hostId)
    )
    const allowed = (record) => {
      if (!inScope(record)) return true
      const policy = resolveHostNotificationPolicy(config, record.hostType, record.hostId, now)
      const rule = resolveRule(policy, record.eventType)
      if (!policy.enabled || !rule?.enabled) return false
      if (record.eventType === 'host.offline') return true
      return record.resourceId !== null && policy.resources.some((resource) => resource.id === record.resourceId)
    }
    const snapshot = this.store.readState()
    const requiresReconciliation = snapshot.pendingTransitions.some((record) => !allowed(record))
      || snapshot.normalizedStates.some((record) => !allowed(record))
      || snapshot.cooldowns.some((record) => !allowed(record))
      || snapshot.incidents.some((record) => record.state === 'open' && !allowed(record))
    if (!requiresReconciliation) return []
    return this.store.mutateState((draft) => {
      draft.pendingTransitions = draft.pendingTransitions.filter(allowed)
      draft.normalizedStates = draft.normalizedStates.filter(allowed)
      draft.cooldowns = draft.cooldowns.filter(allowed)
      const cancelledIncidentIds = new Set()
      for (const incident of draft.incidents) {
        if (incident.state !== 'open' || allowed(incident)) continue
        incident.state = 'cancelled'
        incident.updatedAt = timestamp(now)
        addTransition(draft, incident, 'open', 'cancelled', reason, now)
        cancelledIncidentIds.add(incident.id)
      }
      for (const job of draft.deliveryJobs) {
        if (!cancelledIncidentIds.has(job.incidentId) || !['queued', 'retrying'].includes(job.state)) continue
        job.state = 'cancelled'
        job.leaseOwner = null
        job.leaseExpiresAt = null
        job.lastError = 'Delivery cancelled because the notification policy no longer monitors this incident.'
        job.updatedAt = timestamp(now)
      }
      return [...cancelledIncidentIds]
    })
  }

  #openFromPending(draft, config, policy, rule, pending, now) {
    const incident = {
      id: nextRelationalId(draft, 'incident'),
      eventKey: pending.eventKey,
      hostType: pending.hostType,
      hostId: pending.hostId,
      resourceId: pending.resourceId,
      eventType: pending.eventType,
      severity: rule.severity,
      title: pending.title,
      summary: pending.summary,
      state: 'open',
      openedAt: timestamp(now),
      resolvedAt: null,
      acknowledgedAt: null,
      acknowledgedBy: null,
      notificationDeliveredAt: null,
      lastReminderAt: null,
      createdAt: timestamp(now),
      updatedAt: timestamp(now),
    }
    draft.incidents.push(incident)
    draft.pendingTransitions.splice(draft.pendingTransitions.indexOf(pending), 1)
    if (incident.eventType === 'host.offline') {
      draft.pendingTransitions = draft.pendingTransitions.filter((candidate) => (
        candidate.hostType !== incident.hostType
        || candidate.hostId !== incident.hostId
        || candidate.eventType === 'host.offline'
      ))
    }
    addTransition(draft, incident, 'pending', 'open', 'debounce-satisfied', now)
    if (!policy.muted && !policy.quiet) queueJobs(draft, config, incident, rule, 'opening', now)
    return { action: 'opened', incidentId: incident.id }
  }

  async acknowledge(incidentId, actor = null) {
    const now = this.now()
    return this.store.mutateState((draft) => {
      const incident = draft.incidents.find((candidate) => candidate.id === incidentId)
      if (!incident) throw new Error(`Notification incident ${incidentId} does not exist.`)
      if (incident.acknowledgedAt) return incident
      incident.acknowledgedAt = timestamp(now)
      incident.acknowledgedBy = actor
      incident.updatedAt = timestamp(now)
      draft.acknowledgements.push({
        id: nextRelationalId(draft, 'acknowledgement'),
        incidentId,
        actor,
        acknowledgedAt: timestamp(now),
      })
      return incident
    })
  }
}
