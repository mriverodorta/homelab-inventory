import crypto from 'node:crypto'
import { sanitizeCustomHeaders, sendBoundedRequest } from './http-utils.mjs'

export function createWebhookAdapter({ fetchImpl = fetch } = {}) {
  return {
    async send({ contactPoint, secret = {}, event }) {
      const body = JSON.stringify(event)
      const headers = {
        'Content-Type': 'application/json',
        ...(event.idempotencyKey ? { 'Idempotency-Key': event.idempotencyKey } : {}),
        ...sanitizeCustomHeaders(secret.customHeaders),
      }
      if (secret.bearerToken) headers.Authorization = `Bearer ${secret.bearerToken}`
      if (secret.basicUsername || secret.basicPassword) {
        headers.Authorization = `Basic ${Buffer.from(`${secret.basicUsername ?? ''}:${secret.basicPassword ?? ''}`).toString('base64')}`
      }
      if (secret.hmacSecret) {
        headers['x-homelab-inventory-signature'] = `sha256=${crypto.createHmac('sha256', secret.hmacSecret).update(body).digest('hex')}`
      }
      return sendBoundedRequest(fetchImpl, secret.url ?? contactPoint.config.url, {
        method: 'POST',
        headers,
        body,
      })
    },
  }
}
