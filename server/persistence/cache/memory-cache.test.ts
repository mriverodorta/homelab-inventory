import { describe, expect, test } from 'bun:test'
import { MemoryCacheStore } from './memory-cache.ts'

describe('MemoryCacheStore', () => {
  test('returns cloned values and records hits and misses', () => {
    const cache = new MemoryCacheStore({ maxBytes: 1024 })
    cache.set('workspace:1', { nested: { value: 1 } })
    const first = cache.get<{ nested: { value: number } }>('workspace:1')!
    first.nested.value = 2
    expect(cache.get('workspace:1')).toEqual({ nested: { value: 1 } })
    expect(cache.get('missing')).toBeUndefined()
    expect(cache.diagnostics()).toMatchObject({ hits: 2, misses: 1, entries: 1 })
  })

  test('evicts least-recently-used entries within its byte budget', () => {
    const cache = new MemoryCacheStore({ maxBytes: 45 })
    expect(cache.set('one', { value: 'a'.repeat(20) })).toBe(true)
    expect(cache.set('two', { value: 'b'.repeat(20) })).toBe(true)
    expect(cache.get('one')).toBeUndefined()
    expect(cache.get('two')).toEqual({ value: 'b'.repeat(20) })
    expect(cache.diagnostics()).toMatchObject({ evictions: 1, entries: 1 })
  })

  test('rejects oversized values without clearing existing entries', () => {
    const cache = new MemoryCacheStore({ maxBytes: 64 })
    cache.set('small', { value: 1 })
    expect(cache.set('oversized', { value: 'x'.repeat(128) })).toBe(false)
    expect(cache.get('small')).toEqual({ value: 1 })
  })

  test('expires entries and invalidates all keys carrying a tag', async () => {
    const cache = new MemoryCacheStore({ maxBytes: 1024 })
    cache.set('workspace:1', { id: 1 }, { tags: ['project:1', 'workspace:1'] })
    cache.set('item:2', { id: 2 }, { tags: ['project:1', 'item:2'] })
    cache.set('short', true, { ttlMs: 5 })
    await Bun.sleep(10)
    expect(cache.get('short')).toBeUndefined()
    expect(cache.invalidateTags(['workspace:1'])).toBe(1)
    expect(cache.get('workspace:1')).toBeUndefined()
    expect(cache.get('item:2')).toEqual({ id: 2 })
    expect(cache.invalidateTags(['project:1'])).toBe(1)
  })

  test('refuses secret-bearing keys and supports a complete clear', () => {
    const cache = new MemoryCacheStore()
    expect(() => cache.set('registry:private-key', 'unsafe')).toThrow(/prohibited/iu)
    expect(() => cache.get('auth:session:1')).toThrow(/prohibited/iu)
    cache.set('safe:1', { ok: true })
    cache.clear()
    expect(cache.diagnostics()).toMatchObject({ entries: 0, bytes: 0 })
  })
})
