export const DEFAULT_AGENT_HEARTBEAT_INTERVAL_SECONDS = 60

export function agentStatusTiming(heartbeatIntervalSeconds = DEFAULT_AGENT_HEARTBEAT_INTERVAL_SECONDS) {
  if (!Number.isSafeInteger(heartbeatIntervalSeconds) || heartbeatIntervalSeconds < 1) {
    throw new TypeError('Agent heartbeat interval must be a positive integer.')
  }

  const heartbeatIntervalMs = heartbeatIntervalSeconds * 1_000
  return {
    heartbeatIntervalMs,
    onlineMaxAgeMs: Math.ceil(heartbeatIntervalMs * 1.5),
    staleMaxAgeMs: heartbeatIntervalMs * 5,
  }
}

export function resolveAgentStatusState({ connected, lastSeenAt, now = Date.now(), timing }) {
  const parsedLastSeenAt = typeof lastSeenAt === 'string' ? Date.parse(lastSeenAt) : Number.NaN
  const ageMs = Number.isFinite(parsedLastSeenAt) ? Math.max(0, now - parsedLastSeenAt) : null
  const state = !connected
    ? 'unregistered'
    : ageMs === null
      ? 'unknown'
      : ageMs <= timing.onlineMaxAgeMs
        ? 'online'
        : ageMs <= timing.staleMaxAgeMs
          ? 'stale'
          : 'offline'

  return { state, ageMs }
}
