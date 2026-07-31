const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const MACHINE_AGENT_ROUTE = /^\/api\/agent\/servers\/[1-9]\d*\/(?:register|heartbeat)\/?$/

function requestOrigin(request) {
  try {
    return new URL(`${request.protocol}://${request.get('host')}`).origin
  } catch {
    return null
  }
}

export function browserMutationGuard(request, response, next) {
  if (
    SAFE_METHODS.has(request.method)
    || !request.path.startsWith('/api/')
    || MACHINE_AGENT_ROUTE.test(request.path)
  ) {
    next()
    return
  }

  const fetchSite = request.get('sec-fetch-site')?.trim().toLowerCase()
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) {
    response.status(403).json({ message: 'Cross-origin browser mutations are not allowed.' })
    return
  }

  const origin = request.get('origin')
  if (origin) {
    const expectedOrigin = requestOrigin(request)
    let normalizedOrigin = null
    try {
      normalizedOrigin = new URL(origin).origin
    } catch {
      // Invalid and opaque origins are never valid browser mutation sources.
    }

    if (!expectedOrigin || normalizedOrigin !== expectedOrigin || origin === 'null') {
      response.status(403).json({ message: 'Cross-origin browser mutations are not allowed.' })
      return
    }
  }

  next()
}
