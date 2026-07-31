import { describe, expect, it } from 'vitest'
import { expectRegistryJson, readRegistryJson, registryErrorMessage } from './response-json.mjs'

describe('registry JSON responses', () => {
  it('parses a bounded response', async () => {
    await expect(readRegistryJson(new Response('{"ok":true}'), { maxBytes: 32 }))
      .resolves.toEqual({ ok: true })
  })

  it('rejects oversized responses before parsing', async () => {
    await expect(readRegistryJson(new Response(JSON.stringify({ value: 'x'.repeat(100) })), { maxBytes: 32 }))
      .rejects.toThrow('maximum allowed size')
  })

  it('does not surface an unbounded remote error message', async () => {
    const response = new Response(JSON.stringify({ message: 'x'.repeat(500) }), { status: 400 })
    await expect(expectRegistryJson(response, 'Registry request failed'))
      .rejects.toThrow('Registry request failed (HTTP 400).')
  })

  it('uses a bounded remote message when it is safe to surface', () => {
    expect(registryErrorMessage({ message: 'Request was rejected.' }, 'Fallback', 400))
      .toBe('Request was rejected.')
    expect(registryErrorMessage({ message: 'x'.repeat(241) }, 'Fallback', 400))
      .toBe('Fallback (HTTP 400).')
  })
})
