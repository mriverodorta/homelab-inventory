function olderThan(value, cutoff) {
  const timestamp = Date.parse(value ?? '')
  return Number.isFinite(timestamp) && timestamp < cutoff
}

const DEFAULT_LIMITS = Object.freeze({ incidents: 200, attempts: 1_000, cooldowns: 1_000 })

export async function pruneNotificationHistory(store, now = Date.now(), limits = DEFAULT_LIMITS) {
  const config = store.readConfig()
  const incidentCutoff = now - config.retention.incidentDays * 86_400_000
  const attemptCutoff = now - config.retention.deliveryAttemptDays * 86_400_000
  const state = store.readState()
  const hasExpired = state.incidents.some((incident) => (
    ['resolved', 'cancelled'].includes(incident.state)
    && olderThan(incident.resolvedAt ?? incident.updatedAt, incidentCutoff)
  )) || state.deliveryAttempts.some((attempt) => olderThan(attempt.attemptedAt, attemptCutoff))
    || state.cooldowns.some((cooldown) => olderThan(cooldown.expiresAt, now))
  if (!hasExpired) return { incidents: 0, attempts: 0, remaining: false }

  return store.mutateState((draft) => {
    const removedIncidentIds = new Set(draft.incidents
      .filter((incident) => (
        ['resolved', 'cancelled'].includes(incident.state)
        && olderThan(incident.resolvedAt ?? incident.updatedAt, incidentCutoff)
      ))
      .sort((left, right) => Date.parse(left.resolvedAt ?? left.updatedAt) - Date.parse(right.resolvedAt ?? right.updatedAt))
      .slice(0, limits.incidents)
      .map((incident) => incident.id))
    const removedJobIds = new Set(draft.deliveryJobs
      .filter((job) => removedIncidentIds.has(job.incidentId))
      .map((job) => job.id))
    const before = {
      incidents: draft.incidents.length,
      attempts: draft.deliveryAttempts.length,
    }

    draft.incidents = draft.incidents.filter((incident) => !removedIncidentIds.has(incident.id))
    draft.transitions = draft.transitions.filter((transition) => !removedIncidentIds.has(transition.incidentId))
    draft.acknowledgements = draft.acknowledgements.filter((acknowledgement) => !removedIncidentIds.has(acknowledgement.incidentId))
    draft.deliveryJobs = draft.deliveryJobs.filter((job) => !removedIncidentIds.has(job.incidentId))
    const removedAttemptIds = new Set(draft.deliveryAttempts
      .filter((attempt) => !removedJobIds.has(attempt.deliveryJobId) && olderThan(attempt.attemptedAt, attemptCutoff))
      .sort((left, right) => Date.parse(left.attemptedAt) - Date.parse(right.attemptedAt))
      .slice(0, limits.attempts)
      .map((attempt) => attempt.id))
    draft.deliveryAttempts = draft.deliveryAttempts.filter((attempt) => (
      !removedJobIds.has(attempt.deliveryJobId) && !removedAttemptIds.has(attempt.id)
    ))
    const removedCooldownIds = new Set(draft.cooldowns
      .filter((cooldown) => olderThan(cooldown.expiresAt, now))
      .sort((left, right) => Date.parse(left.expiresAt) - Date.parse(right.expiresAt))
      .slice(0, limits.cooldowns)
      .map((cooldown) => cooldown.id))
    draft.cooldowns = draft.cooldowns.filter((cooldown) => !removedCooldownIds.has(cooldown.id))

    return {
      incidents: before.incidents - draft.incidents.length,
      attempts: before.attempts - draft.deliveryAttempts.length,
      remaining: draft.incidents.some((incident) => (
        ['resolved', 'cancelled'].includes(incident.state)
        && olderThan(incident.resolvedAt ?? incident.updatedAt, incidentCutoff)
      )) || draft.deliveryAttempts.some((attempt) => olderThan(attempt.attemptedAt, attemptCutoff))
        || draft.cooldowns.some((cooldown) => olderThan(cooldown.expiresAt, now)),
    }
  })
}
