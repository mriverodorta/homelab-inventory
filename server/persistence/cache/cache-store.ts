export type CacheDiagnostics = Readonly<{
  hits: number
  misses: number
  evictions: number
  entries: number
  bytes: number
  maxBytes: number
}>

export interface CacheStore {
  get<T>(key: string): T | undefined
  set<T>(key: string, value: T, options?: { ttlMs?: number; tags?: string[] }): boolean
  delete(key: string): boolean
  invalidateTags(tags: string[]): number
  clear(): void
  diagnostics(): CacheDiagnostics
}
