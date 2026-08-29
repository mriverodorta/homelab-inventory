const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost'])

export function createTestFetchGuard(fetchImpl, { onAttempt = () => {} } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('Test fetch guard requires an injected fetch implementation.')
  return async function guardedFetch(input, init) {
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input?.url
    let url = null
    try { url = new URL(raw) } catch { /* Relative application URLs are handled by the injected test transport. */ }
    if (url && ['http:', 'https:'].includes(url.protocol) && !LOOPBACK_HOSTS.has(url.hostname)) {
      onAttempt({ allowed: false, origin: url.origin })
      const error = new Error(`Automated tests cannot access external origin ${url.origin}.`)
      error.code = 'test-external-network-forbidden'
      throw error
    }
    onAttempt({ allowed: true, origin: url?.origin ?? null })
    return fetchImpl(input, init)
  }
}
