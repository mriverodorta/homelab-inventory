import { describe, expect, it, vi } from 'vitest'
import { createNtfyAdapter } from './ntfy.mjs'

describe('Ntfy notification adapter', () => {
  it('maps severity and token auth without putting secrets in the body', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok'))
    await createNtfyAdapter({ fetchImpl }).send({
      contactPoint: { config: { serverUrl: 'https://ntfy.example.test', topic: 'lab', priorityMap: { critical: 'max' }, tags: ['warning'] } },
      secret: { token: 'private' },
      event: { title: 'Host offline', message: 'Host 1', severity: 'critical', idempotencyKey: 'incident:1:opening' },
    })
    const [, init] = fetchImpl.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer private')
    expect(init.headers['Idempotency-Key']).toBe('incident:1:opening')
    expect(init.body).not.toContain('private')
    expect(JSON.parse(init.body)).toMatchObject({ topic: 'lab', priority: 'max' })
    expect(init.redirect).toBe('error')
  })
})
