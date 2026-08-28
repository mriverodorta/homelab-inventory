import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { createDomainEngineApi } from '@/engine/api'
import {
  CanvasRuntimeManager,
  type CanvasRuntimeDisposal,
} from '@/engine/canvas-runtime-manager'
import { DomainEngineClient } from '@/engine/client'
import {
  DomainEngineContext,
  type DomainEngineContextValue,
} from '@/engine/react-context'
import type { CanvasRuntimeScope } from '@/engine/runtime-scope'
import { applyEngineResponsePatch } from '@/engine/project-patches'
import { projectQueryKeyForScope } from '@/lib/project-query-key'
import type { ProjectState } from '@/types/inventory'
import { queryClient } from '@/lib/query-client'

const defaultEventSourceFactory = (url: string) => new EventSource(url)
const defaultClientFactory = (scope: CanvasRuntimeScope) => new DomainEngineClient({
  api: createDomainEngineApi({ scope }),
})
const legacyScope: CanvasRuntimeScope = {
  accountScope: 'test-legacy',
  projectId: 1,
  workspaceId: 1,
  workspaceType: 'canvas',
}

export function DomainEngineProvider({
  children,
  enabled,
  client: providedClient,
  clientFactory = defaultClientFactory,
  eventSourceFactory = defaultEventSourceFactory,
  onRuntimeDisposed,
  runtimeQueryClient = queryClient,
}: {
  children: ReactNode
  enabled?: boolean
  client?: DomainEngineClient
  clientFactory?: (scope: CanvasRuntimeScope) => DomainEngineClient
  eventSourceFactory?: (url: string) => EventSource
  onRuntimeDisposed?: (disposal: CanvasRuntimeDisposal) => void
  runtimeQueryClient?: QueryClient
}) {
  const providedClientUsedRef = useRef(false)
  const managerRef = useRef<CanvasRuntimeManager | null>(null)
  if (!managerRef.current) {
    managerRef.current = new CanvasRuntimeManager({
      capacity: 3,
      clientFactory: (scope) => {
        if (providedClient && !providedClientUsedRef.current) {
          providedClientUsedRef.current = true
          return providedClient
        }
        return clientFactory(scope)
      },
      eventSourceFactory,
      onRuntimeDisposed: (disposal) => {
        const { runtimeKey, scope } = disposal
        runtimeQueryClient.removeQueries({ queryKey: ['domain-engine-topology', runtimeKey] })
        runtimeQueryClient.removeQueries({ queryKey: ['domain-engine-compatible-endpoints', runtimeKey] })
        runtimeQueryClient.removeQueries({
          queryKey: projectQueryKeyForScope(scope.projectId, scope.workspaceId),
          exact: true,
        })
        onRuntimeDisposed?.(disposal)
      },
      onSyncEvent: (scope, event) => {
        const queryKey = projectQueryKeyForScope(scope.projectId, scope.workspaceId)
        if (event.kind === 'patch' && event.external) {
          runtimeQueryClient.setQueryData<ProjectState>(queryKey, (current) => (
            current ? applyEngineResponsePatch(current, event.response) : current
          ))
          return
        }
        if (event.kind === 'invalidation') {
          void runtimeQueryClient.invalidateQueries({ queryKey, exact: true, refetchType: 'none' })
        }
      },
    })
    if (enabled === true) managerRef.current.activate(legacyScope)
  }
  const manager = managerRef.current
  const [snapshot, setSnapshot] = useState(() => manager.snapshot())
  const disposeTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (disposeTimerRef.current !== null) {
      window.clearTimeout(disposeTimerRef.current)
      disposeTimerRef.current = null
    }
    const unsubscribe = manager.subscribe(() => setSnapshot(manager.snapshot()))
    return () => {
      unsubscribe()
      disposeTimerRef.current = window.setTimeout(() => {
        manager.dispose()
        disposeTimerRef.current = null
      }, 0)
    }
  }, [manager])

  const activateCanvas = useCallback((scope: CanvasRuntimeScope | null) => {
    manager.activate(scope)
    setSnapshot(manager.snapshot())
  }, [manager])
  const setRuntimeBusy = useCallback((runtimeKey: string, busy: boolean) => {
    manager.setBusy(runtimeKey, busy)
  }, [manager])
  const removeCanvasRuntime = useCallback((scope: CanvasRuntimeScope) => {
    manager.remove(scope)
    setSnapshot(manager.snapshot())
  }, [manager])
  const clearCanvasRuntimes = useCallback(() => {
    manager.clear()
    setSnapshot(manager.snapshot())
  }, [manager])
  const getCanvasRuntimeKeys = useCallback(() => manager.runtimeKeys(), [manager])
  const getCanvasRuntime = useCallback((runtimeKey: string) => {
    const runtime = manager.runtime(runtimeKey)
    if (!runtime) return null
    const { client: _client, ...surfaceRuntime } = runtime
    return surfaceRuntime
  }, [manager])
  const setEnabled = useCallback((nextEnabled: boolean) => {
    manager.activate(nextEnabled ? legacyScope : null)
    setSnapshot(manager.snapshot())
  }, [manager])
  useEffect(() => {
    if (enabled !== undefined) setEnabled(enabled)
  }, [enabled, setEnabled])

  const value = useMemo<DomainEngineContextValue>(() => ({
    enabled: snapshot.enabled,
    runtimeKey: snapshot.runtimeKey,
    generation: snapshot.generation,
    session: snapshot.session,
    client: snapshot.client ?? null as never,
    state: snapshot.state,
    syncEvent: snapshot.syncEvent,
    activateCanvas,
    setRuntimeBusy,
    removeCanvasRuntime,
    clearCanvasRuntimes,
    getCanvasRuntimeKeys,
    getCanvasRuntime,
    setEnabled,
    retry: () => manager.retryActive(),
  }), [
    activateCanvas,
    clearCanvasRuntimes,
    getCanvasRuntimeKeys,
    getCanvasRuntime,
    manager,
    removeCanvasRuntime,
    setRuntimeBusy,
    setEnabled,
    snapshot,
  ])

  return <DomainEngineContext.Provider value={value}>{children}</DomainEngineContext.Provider>
}
