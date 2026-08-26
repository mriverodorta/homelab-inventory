import { decodeEngineResponse, type EngineResponse } from '../../shared/engine/protocol.mjs'
import { scopedEngineUrl } from '@/engine/api'
import type { DomainEngineClient } from '@/engine/client'
import {
  canvasRuntimeKey,
  type CanvasRuntimeScope,
} from '@/engine/runtime-scope'
import type { DomainEngineSyncEvent } from '@/engine/react-context'
import type { DomainEngineState } from '@/engine/types'
import { disposeCanvasRoutingRuntime } from '@/engine/canvas-routing-runtime'
import {
  WorkspaceRuntimeCache,
  type WorkspaceRuntimeRecord,
} from '@/lib/workspace-runtime-cache'

const idleState: DomainEngineState = { phase: 'idle', revision: null }

function decodeBase64(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export type CanvasEngineRuntime = WorkspaceRuntimeRecord & {
  scope: CanvasRuntimeScope
  client: DomainEngineClient
  generation: number
  state: DomainEngineState
  syncEvent: DomainEngineSyncEvent | null
  eventSource: EventSource | null
  unsubscribe: (() => void) | null
  dirty: boolean
  starting: boolean
  lifecycleBusy: boolean
  externalBusy: boolean
}

export type CanvasRuntimeManagerSnapshot = {
  enabled: boolean
  runtimeKey: string | null
  generation: number
  session: number
  client: DomainEngineClient | null
  state: DomainEngineState
  syncEvent: DomainEngineSyncEvent | null
}

export type CanvasRuntimeManagerOptions = {
  capacity?: number
  clientFactory(scope: CanvasRuntimeScope): DomainEngineClient
  eventSourceFactory(url: string): EventSource
  onRuntimeDisposed?(runtimeKey: string): void
  onSyncEvent?(scope: CanvasRuntimeScope, event: DomainEngineSyncEvent): void
}

export class CanvasRuntimeManager {
  private readonly cache: WorkspaceRuntimeCache<CanvasEngineRuntime>
  private readonly clientFactory: CanvasRuntimeManagerOptions['clientFactory']
  private readonly eventSourceFactory: CanvasRuntimeManagerOptions['eventSourceFactory']
  private readonly onRuntimeDisposed?: CanvasRuntimeManagerOptions['onRuntimeDisposed']
  private readonly onSyncEvent?: CanvasRuntimeManagerOptions['onSyncEvent']
  private readonly listeners = new Set<() => void>()
  private activeKey: string | null = null
  private generation = 0
  private session = 0
  private sequence = 0
  private disposed = false

  constructor({
    capacity = 3,
    clientFactory,
    eventSourceFactory,
    onRuntimeDisposed,
    onSyncEvent,
  }: CanvasRuntimeManagerOptions) {
    this.clientFactory = clientFactory
    this.eventSourceFactory = eventSourceFactory
    this.onRuntimeDisposed = onRuntimeDisposed
    this.onSyncEvent = onSyncEvent
    this.cache = new WorkspaceRuntimeCache(capacity, {
      dispose: (entry) => this.disposeEntry(entry),
    })
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot(): CanvasRuntimeManagerSnapshot {
    const active = this.activeKey ? this.cache.get(this.activeKey) : null
    return active
      ? {
          enabled: true,
          runtimeKey: active.key,
          generation: active.generation,
          session: this.session,
          client: active.client,
          state: active.state,
          syncEvent: active.syncEvent,
        }
      : {
          enabled: false,
          runtimeKey: null,
          generation: 0,
          session: this.session,
          client: null,
          state: idleState,
          syncEvent: null,
        }
  }

  activate(scope: CanvasRuntimeScope | null) {
    if (this.disposed) return
    if (!scope) {
      if (this.activeKey === null) return
      this.activeKey = null
      this.cache.activate(null)
      this.session += 1
      this.notify()
      return
    }

    const key = canvasRuntimeKey(scope)
    let entry = this.cache.get(key)
    let created = false
    if (!entry) {
      entry = this.createEntry(scope, key)
      this.cache.insert(entry)
      created = true
    }

    const changed = this.activeKey !== key
    this.activeKey = key
    this.cache.activate(key)
    if (changed) this.session += 1
    this.notify()

    if (entry.dirty) {
      entry.dirty = false
      void entry.client.rebuild('Synchronizing the selected canvas workspace.')
        .then(() => this.emitSyncEvent(entry, { kind: 'invalidation' }))
        .catch(() => {})
    } else if (created || entry.state.phase === 'idle' || entry.state.phase === 'failed') {
      this.start(entry)
    }
  }

  setBusy(runtimeKey: string, busy: boolean) {
    const entry = this.cache.get(runtimeKey)
    if (!entry) return
    entry.externalBusy = busy
    entry.busy = entry.lifecycleBusy || entry.externalBusy
    this.cache.setBusy(runtimeKey, entry.busy)
  }

  remove(scopeOrKey: CanvasRuntimeScope | string) {
    const key = typeof scopeOrKey === 'string' ? scopeOrKey : canvasRuntimeKey(scopeOrKey)
    if (this.activeKey === key) this.activeKey = null
    const removed = this.cache.remove(key)
    if (removed) this.notify()
    return removed
  }

  clear() {
    this.activeKey = null
    this.cache.clear()
    this.session += 1
    this.notify()
  }

  retryActive() {
    const entry = this.activeKey ? this.cache.get(this.activeKey) : null
    if (!entry) return Promise.resolve()
    entry.dirty = false
    return entry.client.start()
  }

  runtimeCount() {
    return this.cache.size
  }

  runtimeKeys() {
    return this.cache.keys()
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.activeKey = null
    this.cache.clear()
    this.listeners.clear()
  }

  private createEntry(scope: CanvasRuntimeScope, key: string): CanvasEngineRuntime {
    const client = this.clientFactory(scope)
    const entry: CanvasEngineRuntime = {
      key,
      scope,
      client,
      generation: ++this.generation,
      state: client.status(),
      syncEvent: null,
      eventSource: null,
      unsubscribe: null,
      dirty: false,
      busy: true,
      starting: false,
      lifecycleBusy: true,
      externalBusy: false,
    }
    entry.unsubscribe = client.subscribe((state) => {
      entry.state = state
      const lifecycleBusy = state.phase === 'idle'
        || state.phase === 'loading'
        || state.phase === 'rebuilding'
        || state.phase === 'conflict'
      entry.lifecycleBusy = lifecycleBusy
      entry.busy = entry.lifecycleBusy || entry.externalBusy
      this.cache.setBusy(key, entry.busy)
      if (state.phase === 'ready') this.ensureEventSource(entry)
      if (this.activeKey === key) this.notify()
    })
    return entry
  }

  private start(entry: CanvasEngineRuntime) {
    if (entry.starting) return
    entry.starting = true
    entry.lifecycleBusy = true
    entry.busy = true
    this.cache.setBusy(entry.key, entry.busy)
    void entry.client.start()
      .catch(() => {})
      .finally(() => {
        entry.starting = false
        const lifecycleBusy = entry.state.phase === 'loading'
          || entry.state.phase === 'rebuilding'
          || entry.state.phase === 'conflict'
        entry.lifecycleBusy = lifecycleBusy
        entry.busy = entry.lifecycleBusy || entry.externalBusy
        this.cache.setBusy(entry.key, entry.busy)
      })
  }

  private ensureEventSource(entry: CanvasEngineRuntime) {
    if (entry.eventSource || this.disposed) return
    const source = this.eventSourceFactory(scopedEngineUrl('/api/engine/events', entry.scope))
    entry.eventSource = source
    source.addEventListener('project-patch', (event) => {
      void this.applyPatchEvent(entry, (event as MessageEvent<string>).data)
    })
    source.addEventListener('project-invalidated', (event) => {
      const data = (event as MessageEvent<string>).data
      const invalidatedRevision = (() => {
        try {
          const payload = JSON.parse(data) as { revision?: unknown }
          return typeof payload.revision === 'number' ? payload.revision : null
        } catch {
          return null
        }
      })()

      if (
        invalidatedRevision !== null
        && entry.state.phase === 'ready'
        && entry.state.revision === invalidatedRevision
      ) return

      if (this.activeKey === entry.key) {
        void entry.client.rebuild('Project data changed outside the domain command stream.')
          .then(() => this.emitSyncEvent(entry, { kind: 'invalidation' }))
          .catch(() => {})
      } else {
        entry.dirty = true
      }
    })
  }

  private async applyPatchEvent(entry: CanvasEngineRuntime, data: string) {
    try {
      const message = JSON.parse(data) as { payload: string }
      const bytes = decodeBase64(message.payload)
      const response = decodeEngineResponse(bytes)
      const beforeRevision = entry.client.status().revision
      const result = await entry.client.applyCommittedResponse(bytes)
      this.emitSyncEvent(entry, {
        kind: 'patch',
        external: result.kind === 'applied' && response.base_revision === beforeRevision,
        response,
      })
    } catch {
      if (this.activeKey === entry.key) {
        await entry.client.rebuild('A committed project event could not be decoded.').catch(() => {})
        this.emitSyncEvent(entry, { kind: 'invalidation' })
      } else {
        entry.dirty = true
      }
    }
  }

  private emitSyncEvent(
    entry: CanvasEngineRuntime,
    event:
      | { kind: 'patch'; external: boolean; response: EngineResponse }
      | { kind: 'invalidation' },
  ) {
    this.sequence += 1
    const syncEvent = {
      ...event,
      runtimeKey: entry.key,
      sequence: this.sequence,
    } as DomainEngineSyncEvent
    this.onSyncEvent?.(entry.scope, syncEvent)
    if (this.activeKey === entry.key) {
      entry.syncEvent = syncEvent
      this.notify()
    }
  }

  private disposeEntry(entry: CanvasEngineRuntime) {
    disposeCanvasRoutingRuntime(entry.client)
    entry.eventSource?.close()
    entry.eventSource = null
    entry.unsubscribe?.()
    entry.unsubscribe = null
    entry.client.dispose()
    this.onRuntimeDisposed?.(entry.key)
  }

  private notify() {
    for (const listener of this.listeners) listener()
  }
}
