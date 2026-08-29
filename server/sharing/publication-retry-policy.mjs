const BASE_DELAY_MS = 15_000
const TRANSIENT_MAX_ATTEMPTS = 6
const TRANSIENT_DELAY_CAP_MS = 15 * 60_000
const REGISTRY_DELAY_CAP_MS = 6 * 60 * 60_000

const TRANSIENT_CODES = new Set([
  'authentication-failed',
  'labgd-unavailable',
  'labgd-renewal-failed',
  'publication-readiness-unavailable',
  'sharing-authentication-failed',
  'sharing-network-failed',
  'sharing-rate-limited',
  'sharing-readiness-unavailable',
  'sharing-request-timeout',
])

export function classifyPublicationFailure(error, attemptCount) {
  if (String(error?.code ?? '') === 'registry-definition-unavailable') {
    return { disposition: 'durable-registry', maxAttempts: null, delayCapMs: REGISTRY_DELAY_CAP_MS }
  }
  const status = Number(error?.status)
  const transient = error instanceof TypeError
    || ['AbortError', 'TimeoutError'].includes(String(error?.name ?? ''))
    || TRANSIENT_CODES.has(String(error?.code ?? ''))
    || [408, 425, 429].includes(status)
    || (Number.isInteger(status) && status >= 500 && status <= 599)
  if (transient && attemptCount < TRANSIENT_MAX_ATTEMPTS) {
    return { disposition: 'transient', maxAttempts: TRANSIENT_MAX_ATTEMPTS, delayCapMs: TRANSIENT_DELAY_CAP_MS }
  }
  return { disposition: 'terminal', maxAttempts: 0, delayCapMs: 0 }
}

export function publicationRetryDelay(classification, attemptCount, retryAfterMs) {
  if (classification.disposition === 'terminal') return 0
  const exponent = Math.min(Math.max(0, attemptCount - 1), 30)
  const exponential = Math.min(classification.delayCapMs, BASE_DELAY_MS * 2 ** exponent)
  const requested = Number.isFinite(retryAfterMs) && retryAfterMs >= 0
    ? Math.min(classification.delayCapMs, retryAfterMs)
    : 0
  return Math.max(exponential, requested)
}
