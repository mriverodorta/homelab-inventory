import crypto from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createWebhookAdapter } from './webhook.mjs'

describe('generic webhook adapter', () => {
  it('signs the exact JSON body and rejects unsafe headers', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok'))
    const adapter = createWebhookAdapter({ fetchImpl })
    const event = { title: 'Test', severity: 'warning', idempotencyKey: 'incident:1:opening' }
    await adapter.send({
      contactPoint: { config: { url: 'https://hooks.example.test/inventory' } },
      secret: { hmacSecret: 'secret', customHeaders: { 'X-Workspace': 'lab' } },
      event,
    })
    const [, init] = fetchImpl.mock.calls[0]
    expect(init.headers['x-homelab-inventory-signature']).toBe(`sha256=${crypto.createHmac('sha256', 'secret').update(init.body).digest('hex')}`)
    expect(init.headers['Idempotency-Key']).toBe('incident:1:opening')
    await expect(adapter.send({
      contactPoint: { config: { url: 'https://hooks.example.test' } },
      secret: { customHeaders: { Host: 'evil.test' } },
      event,
    })).rejects.toThrow('not allowed')
    await expect(adapter.send({
      contactPoint: { config: { url: 'https://hooks.example.test' } },
      secret: { customHeaders: { 'Idempotency-Key': 'attacker-controlled' } },
      event,
    })).rejects.toThrow('not allowed')
  })
})
