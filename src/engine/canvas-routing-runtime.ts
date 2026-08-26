import type { DomainEngineClient } from '@/engine/client'
import {
  CableRoutingCoordinator,
  type CableRoutingState,
} from '@/lib/cable-routing-coordinator'
import { loadRoutingCache, saveRoutingCache } from '@/lib/routing-cache-api'

type Listener = (snapshot: CanvasRoutingRuntimeSnapshot) => void

export type CanvasRoutingRuntimeSnapshot = {
  state: CableRoutingState
  cacheReady: boolean
}

export class CanvasRoutingRuntime {
  readonly coordinator: CableRoutingCoordinator
  private readonly listeners = new Set<Listener>()
  private unsubscribeCoordinator: (() => void) | null
  private snapshot: CanvasRoutingRuntimeSnapshot
  private disposed = false

  constructor(client: DomainEngineClient) {
    this.coordinator = new CableRoutingCoordinator(client, { persistCache: saveRoutingCache })
    this.snapshot = { state: this.coordinator.getState(), cacheReady: false }
    this.unsubscribeCoordinator = this.coordinator.subscribe((state) => {
      this.snapshot = { ...this.snapshot, state }
      this.notify()
    })
    void loadRoutingCache()
      .then((cache) => this.coordinator.hydrate(cache))
      .catch((error) => {
        console.warn('[Cable routing] Unable to load derived route cache.', error)
      })
      .finally(() => {
        if (this.disposed) return
        this.snapshot = { ...this.snapshot, cacheReady: true }
        this.notify()
      })
  }

  getSnapshot() {
    return this.snapshot
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => { this.listeners.delete(listener) }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribeCoordinator?.()
    this.unsubscribeCoordinator = null
    this.coordinator.dispose()
    this.listeners.clear()
  }

  private notify() {
    for (const listener of this.listeners) listener(this.snapshot)
  }
}

const runtimes = new WeakMap<DomainEngineClient, CanvasRoutingRuntime>()

export function getCanvasRoutingRuntime(client: DomainEngineClient) {
  const existing = runtimes.get(client)
  if (existing) return existing
  const runtime = new CanvasRoutingRuntime(client)
  runtimes.set(client, runtime)
  return runtime
}

export function disposeCanvasRoutingRuntime(client: DomainEngineClient) {
  const runtime = runtimes.get(client)
  if (!runtime) return
  runtimes.delete(client)
  runtime.dispose()
}
