import { describe, expect, it, vi } from 'vitest'
import { createTestFetchGuard } from './test-network-guard.mjs'

describe('sharing test network guard', () => {
  it.each([
    ['https://', 'lab.gd'],
    ['https://', 'app.lab.gd'],
    ['https://', 'registry.homelabinventory.com'],
    ['http://', '192.0.2.10:8787'],
  ])('rejects external destination %s%s before transport', async (scheme, host) => {
    const transport = vi.fn()
    const guarded = createTestFetchGuard(transport)
    await expect(guarded(`${scheme}${host}/readyz`)).rejects.toMatchObject({ code: 'test-external-network-forbidden' })
    expect(transport).not.toHaveBeenCalled()
  })

  it.each(['http://127.0.0.1:8787/readyz', 'http://localhost:8787/readyz', 'http://[::1]:8787/readyz'])('allows loopback transport %s', async (url) => {
    const transport = vi.fn(async () => new Response('ok'))
    const guarded = createTestFetchGuard(transport)
    await expect(guarded(url)).resolves.toBeInstanceOf(Response)
    expect(transport).toHaveBeenCalledOnce()
  })
})
