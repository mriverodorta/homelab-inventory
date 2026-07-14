export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000
export const DEFAULT_RATE_LIMIT_MAX = 600

const RATE_LIMIT_MESSAGE = 'Too many requests. Please try again shortly.'

function readPositiveInteger(value, fallback, name, warn) {
  if (value === undefined || value === '') {
    return fallback
  }

  const parsed = Number(value)

  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed
  }

  warn(`Invalid ${name} value "${value}"; using ${fallback}.`)
  return fallback
}

function readTrustProxy(value, warn) {
  const normalized = value?.trim()

  if (!normalized || normalized === 'false') {
    return false
  }

  if (/^\d+$/.test(normalized)) {
    return Number(normalized)
  }

  if (normalized === 'true') {
    warn('TRUST_PROXY=true would allow clients to spoof their IP address; using false. Set an explicit hop count or proxy range instead.')
    return false
  }

  return normalized
}

export function readRateLimitConfig(environment = process.env, warn = console.warn) {
  return {
    windowMs: readPositiveInteger(
      environment.RATE_LIMIT_WINDOW_MS,
      DEFAULT_RATE_LIMIT_WINDOW_MS,
      'RATE_LIMIT_WINDOW_MS',
      warn,
    ),
    limit: readPositiveInteger(
      environment.RATE_LIMIT_MAX,
      DEFAULT_RATE_LIMIT_MAX,
      'RATE_LIMIT_MAX',
      warn,
    ),
    trustProxy: readTrustProxy(environment.TRUST_PROXY, warn),
  }
}

export function createRateLimitOptions({ windowMs, limit }) {
  return {
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler(request, response) {
      if (request.originalUrl.startsWith('/api/')) {
        response.status(429).json({ message: RATE_LIMIT_MESSAGE })
        return
      }

      response.status(429).type('text/plain').send(RATE_LIMIT_MESSAGE)
    },
  }
}
