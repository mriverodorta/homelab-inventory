import { LRUCache } from 'lru-cache'
import type { CacheDiagnostics, CacheStore } from './cache-store.ts'

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024
const FORBIDDEN_KEY_PART = /(?:^|[:/=._-])(credential|password|private|secret|session|token)(?:$|[:/=._-])/iu

type CacheEntry = Readonly<{
  value: unknown
  bytes: number
  tags: readonly string[]
}>

function serializedBytes(value: unknown) {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new TypeError('Cache values must be JSON serializable.')
  return Buffer.byteLength(serialized)
}

function assertSafeKey(key: string) {
  if (!key.trim()) throw new TypeError('Cache key is required.')
  if (FORBIDDEN_KEY_PART.test(key)) throw new TypeError('Secret-bearing cache keys are prohibited.')
}

export class MemoryCacheStore implements CacheStore {
  private readonly cache: LRUCache<string, CacheEntry>
  private readonly keysByTag = new Map<string, Set<string>>()
  private hitCount = 0
  private missCount = 0
  private evictionCount = 0

  constructor({ maxBytes = DEFAULT_MAX_BYTES }: { maxBytes?: number } = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('Cache size must be a positive safe integer.')
    this.cache = new LRUCache<string, CacheEntry>({
      maxSize: maxBytes,
      sizeCalculation: (entry) => entry.bytes,
      dispose: (entry, key, reason) => {
        this.removeTags(key, entry.tags)
        if (reason === 'evict') this.evictionCount += 1
      },
    })
  }

  get<T>(key: string): T | undefined {
    assertSafeKey(key)
    const entry = this.cache.get(key)
    if (!entry) {
      this.missCount += 1
      return undefined
    }
    this.hitCount += 1
    return structuredClone(entry.value) as T
  }

  set<T>(key: string, value: T, { ttlMs, tags = [] }: { ttlMs?: number; tags?: string[] } = {}) {
    assertSafeKey(key)
    const bytes = serializedBytes(value)
    if (bytes > this.cache.maxSize) return false
    const normalizedTags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))]
    const current = this.cache.peek(key)
    if (current) this.removeTags(key, current.tags)
    this.cache.set(key, { value: structuredClone(value), bytes, tags: normalizedTags }, { ttl: ttlMs })
    for (const tag of normalizedTags) {
      const keys = this.keysByTag.get(tag) ?? new Set<string>()
      keys.add(key)
      this.keysByTag.set(tag, keys)
    }
    return true
  }

  delete(key: string) {
    assertSafeKey(key)
    return this.cache.delete(key)
  }

  invalidateTags(tags: string[]) {
    const keys = new Set(tags.flatMap((tag) => [...(this.keysByTag.get(tag) ?? [])]))
    for (const key of keys) this.cache.delete(key)
    return keys.size
  }

  clear() {
    this.cache.clear()
    this.keysByTag.clear()
  }

  diagnostics(): CacheDiagnostics {
    return {
      hits: this.hitCount,
      misses: this.missCount,
      evictions: this.evictionCount,
      entries: this.cache.size,
      bytes: this.cache.calculatedSize,
      maxBytes: this.cache.maxSize,
    }
  }

  private removeTags(key: string, tags: readonly string[]) {
    for (const tag of tags) {
      const keys = this.keysByTag.get(tag)
      if (!keys) continue
      keys.delete(key)
      if (keys.size === 0) this.keysByTag.delete(tag)
    }
  }
}
