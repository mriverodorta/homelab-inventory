import { describe, expect, it, vi } from 'vitest'
import { CanvasRuntimeManager } from '@/engine/canvas-runtime-manager'
import type { DomainEngineClient } from '@/engine/client'
import type { CanvasRuntimeScope } from '@/engine/runtime-scope'
import type { DomainEngineState } from '@/engine/types'

function scope(workspaceId: number, accountScope = 'account:1'): CanvasRuntimeScope {
  return { accountScope, projectId: 1, workspaceId, workspaceType: 'canvas' }
}

function stubClient(revision: number) {
  let state: DomainEngineState = { phase: 'idle', revision: null }
  const listeners = new Set<(next: DomainEngineState) => void>()
  const emit = (next: DomainEngineState) => {
    state = next
    for (const listener of listeners) listener(next)
  }
  return {
    status: () => state,
    subscribe: vi.fn((listener: (next: DomainEngineState) => void) => {
      listeners.add(listener)
      listener(state)
      return () => { listeners.delete(listener) }
    }),
    start: vi.fn(async () => {
      emit({ phase: 'loading', revision: null })
      emit({ phase: 'ready', revision })
    }),
    rebuild: vi.fn(async () => {
      emit({ phase: 'rebuilding', revision })
      emit({ phase: 'ready', revision })
    }),
    applyCommittedResponse: vi.fn(async () => ({ kind: 'acknowledged' as const })),
    dispose: vi.fn(() => emit({ phase: 'disposed', revision: null })),
  } as unknown as DomainEngineClient
}

function fixture() {
  const clients = new Map<number, ReturnType<typeof stubClient>>()
  const sources = new Map<string, { addEventListener: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }>()
  const manager = new CanvasRuntimeManager({
    capacity: 3,
    clientFactory: (runtimeScope) => {
      const client = stubClient(runtimeScope.workspaceId)
      clients.set(runtimeScope.workspaceId, client)
      return client
    },
    eventSourceFactory: (url) => {
      const source = { addEventListener: vi.fn(), close: vi.fn() }
      sources.set(url, source)
      return source as unknown as EventSource
    },
  })
  return { clients, manager, sources }
}

describe('CanvasRuntimeManager', () => {
  it('keeps a ready Canvas runtime warm while Systems is active', async () => {
    const { clients, manager } = fixture()
    manager.activate(scope(2))
    await vi.waitFor(() => expect(manager.snapshot().state.phase).toBe('ready'))

    manager.activate(null)
    expect(manager.snapshot()).toMatchObject({ enabled: false, runtimeKey: null })
    manager.activate(scope(2))

    expect(clients.get(2)?.start).toHaveBeenCalledOnce()
    expect(clients.get(2)?.dispose).not.toHaveBeenCalled()
    expect(manager.snapshot()).toMatchObject({ enabled: true, state: { phase: 'ready', revision: 2 } })
    manager.dispose()
  })

  it('keeps three runtimes and disposes the least recently used fourth entry', async () => {
    const { clients, manager } = fixture()
    for (const workspaceId of [2, 3, 4]) manager.activate(scope(workspaceId))
    await vi.waitFor(() => expect(manager.snapshot().state.phase).toBe('ready'))
    manager.activate(scope(2))
    manager.activate(scope(5))

    expect(manager.runtimeCount()).toBe(3)
    expect(manager.runtimeKeys()).toEqual([
      'account%3A1:1:2:canvas',
      'account%3A1:1:4:canvas',
      'account%3A1:1:5:canvas',
    ])
    expect(clients.get(3)?.dispose).toHaveBeenCalledOnce()
    expect(clients.get(2)?.dispose).not.toHaveBeenCalled()
    manager.dispose()
  })

  it('opens one immutable scoped event stream per retained Canvas', async () => {
    const { manager, sources } = fixture()
    manager.activate(scope(2))
    manager.activate(scope(9))
    await vi.waitFor(() => expect(sources.size).toBe(2))

    expect([...sources.keys()]).toEqual([
      '/api/engine/events?projectId=1&workspaceId=2',
      '/api/engine/events?projectId=1&workspaceId=9',
    ])
    manager.dispose()
    for (const source of sources.values()) expect(source.close).toHaveBeenCalledOnce()
  })

  it('clears every runtime when the account boundary changes', async () => {
    const { clients, manager } = fixture()
    manager.activate(scope(2, 'account:1'))
    manager.activate(scope(3, 'account:1'))
    await vi.waitFor(() => expect(manager.runtimeCount()).toBe(2))

    manager.clear()
    manager.activate(scope(2, 'account:2'))

    expect(clients.get(3)?.dispose).toHaveBeenCalledOnce()
    expect(manager.runtimeKeys()).toEqual(['account%3A2:1:2:canvas'])
    manager.dispose()
  })

  it('does not evict a busy inactive runtime until its operation settles', async () => {
    const { clients, manager } = fixture()
    manager.activate(scope(2))
    manager.activate(scope(3))
    manager.activate(scope(4))
    await vi.waitFor(() => expect(manager.runtimeCount()).toBe(3))

    manager.setBusy('account%3A1:1:2:canvas', true)
    manager.activate(scope(5))

    expect(manager.runtimeCount()).toBe(3)
    expect(manager.runtimeKeys()).toContain('account%3A1:1:2:canvas')
    expect(clients.get(2)?.dispose).not.toHaveBeenCalled()

    manager.setBusy('account%3A1:1:2:canvas', false)
    expect(manager.runtimeCount()).toBe(3)
    manager.dispose()
  })
})
