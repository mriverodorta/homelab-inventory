const MAX_RESPONSE_BYTES = 64 * 1024
const BLOCKED_HEADERS = new Set([
  'authorization',
  'connection',
  'content-length',
  'content-type',
  'cookie',
  'host',
  'idempotency-key',
  'set-cookie',
  'transfer-encoding',
  'x-homelab-inventory-signature',
])

export function parseDeliveryUrl(value) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('Notification destination URL is invalid.')
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error('Notification destination must be an HTTP or HTTPS URL without embedded credentials.')
  }
  return parsed
}

export function sanitizeCustomHeaders(value = {}) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Webhook headers must be an object.')
  const entries = Object.entries(value)
  if (entries.length > 20) throw new Error('Webhook headers exceed the limit of 20.')
  const result = {}
  for (const [rawName, rawValue] of entries) {
    const name = rawName.trim().toLowerCase()
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(name) || BLOCKED_HEADERS.has(name)) {
      throw new Error(`Webhook header ${rawName} is not allowed.`)
    }
    if (typeof rawValue !== 'string' || rawValue.length > 2048 || /[\r\n]/.test(rawValue)) {
      throw new Error(`Webhook header ${rawName} has an invalid value.`)
    }
    result[name] = rawValue
  }
  return result
}

export async function readBoundedResponse(response, maxBytes = MAX_RESPONSE_BYTES) {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maxBytes) throw new Error('Notification destination response exceeded 64 KiB.')
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))))
}

export async function sendBoundedRequest(fetchImpl, url, init, timeoutMs = 10_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  try {
    const response = await fetchImpl(parseDeliveryUrl(url), {
      ...init,
      redirect: 'error',
      signal: controller.signal,
    })
    const responseExcerpt = (await readBoundedResponse(response)).slice(0, 2048)
    if (!response.ok) throw new Error(`Notification destination returned HTTP ${response.status}.`)
    return { status: response.status, responseExcerpt }
  } finally {
    clearTimeout(timer)
  }
}
