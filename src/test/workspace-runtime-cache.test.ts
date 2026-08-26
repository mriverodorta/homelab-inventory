import { describe, expect, it, vi } from 'vitest'
import {
  WorkspaceRuntimeCache,
  type WorkspaceRuntimeRecord,
} from '@/lib/workspace-runtime-cache'

type Runtime = WorkspaceRuntimeRecord & { disposed: boolean }

function runtime(key: string, busy = false): Runtime {
  return { key, busy, disposed: false }
}

function fixture(capacity = 3) {
  const disposedKeys: string[] = []
  const dispose = vi.fn((entry: Runtime) => {
    entry.disposed = true
    disposedKeys.push(entry.key)
  })
  return {
    cache: new WorkspaceRuntimeCache<Runtime>(capacity, { dispose }),
    dispose,
    disposedKeys,
  }
}

describe('WorkspaceRuntimeCache', () => {
  it('keeps three runtimes and evicts the least recently used inactive entry', () => {
    const { cache, disposedKeys } = fixture()
    cache.insert(runtime('a'))
    cache.insert(runtime('b'))
    cache.insert(runtime('c'))
    cache.activate('a')
    cache.insert(runtime('d'))

    expect(disposedKeys).toEqual(['b'])
    expect(cache.keys()).toEqual(['a', 'c', 'd'])
  })

  it('never evicts the active runtime', () => {
    const { cache, disposedKeys } = fixture(2)
    cache.insert(runtime('a'))
    cache.insert(runtime('b'))
    cache.activate('a')
    cache.insert(runtime('c'))

    expect(disposedKeys).toEqual(['b'])
    expect(cache.get('a')).toBeDefined()
  })

  it('temporarily exceeds capacity when every inactive candidate is busy', () => {
    const { cache, disposedKeys } = fixture(2)
    cache.insert(runtime('a'))
    cache.activate('a')
    cache.insert(runtime('b', true))
    cache.insert(runtime('c', true))

    expect(cache.size).toBe(3)
    expect(disposedKeys).toEqual([])

    cache.setBusy('b', false)
    expect(cache.size).toBe(2)
    expect(disposedKeys).toEqual(['b'])
  })

  it('updates recency whenever a runtime is activated', () => {
    const { cache, disposedKeys } = fixture()
    cache.insert(runtime('a'))
    cache.insert(runtime('b'))
    cache.insert(runtime('c'))
    cache.activate('a')
    cache.activate('b')
    cache.insert(runtime('d'))

    expect(disposedKeys).toEqual(['c'])
  })

  it('disposes explicit removals and clear entries exactly once', () => {
    const { cache, dispose } = fixture()
    cache.insert(runtime('a'))
    cache.insert(runtime('b'))

    expect(cache.remove('a')).toBe(true)
    expect(cache.remove('a')).toBe(false)
    cache.clear()
    cache.clear()

    expect(dispose.mock.calls.map(([entry]) => entry.key)).toEqual(['a', 'b'])
  })

  it('rejects invalid capacities', () => {
    expect(() => new WorkspaceRuntimeCache(0, { dispose: vi.fn() })).toThrow(
      'positive safe integer',
    )
  })
})
