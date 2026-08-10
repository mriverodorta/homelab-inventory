import { sendBoundedRequest } from './http-utils.mjs'

const PRIORITIES = new Set(['min', 'low', 'default', 'high', 'max'])

function authHeader(secret = {}) {
  if (secret.token) return `Bearer ${secret.token}`
  if (secret.username || secret.password) {
    return `Basic ${Buffer.from(`${secret.username ?? ''}:${secret.password ?? ''}`).toString('base64')}`
  }
  return null
}

export function createNtfyAdapter({ fetchImpl = fetch } = {}) {
  return {
    async send({ contactPoint, secret = {}, event }) {
      const serverUrl = String(contactPoint.config.serverUrl ?? '').replace(/\/+$/, '')
      const topic = String(contactPoint.config.topic ?? '').trim()
      if (!serverUrl || !topic || topic.length > 128) throw new Error('Ntfy server URL and topic are required.')
      const priority = contactPoint.config.priorityMap?.[event.severity] ?? 'default'
      if (!PRIORITIES.has(priority)) throw new Error('Ntfy priority mapping is invalid.')
      const authorization = authHeader(secret)
      return sendBoundedRequest(fetchImpl, serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(event.idempotencyKey ? { 'Idempotency-Key': event.idempotencyKey } : {}),
          ...(authorization ? { Authorization: authorization } : {}),
        },
        body: JSON.stringify({
          topic,
          title: event.title,
          message: event.message,
          priority,
          tags: Array.isArray(contactPoint.config.tags) ? contactPoint.config.tags.slice(0, 10) : [],
        }),
      })
    },
  }
}
