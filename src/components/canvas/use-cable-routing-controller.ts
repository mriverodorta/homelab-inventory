import { useEffect, useRef, useState } from 'react'
import { useDomainEngine } from '@/hooks/use-domain-engine'
import type { CableLaneRouteRequest } from '@/engine/routing'
import type { ConnectionRouteSide } from '@/types/inventory'
import {
  CableRoutingCoordinator,
  type CableRouteCanonicalRepair,
  type CableRoutingState,
} from '@/lib/cable-routing-coordinator'
import { loadRoutingCache, saveRoutingCache } from '@/lib/routing-cache-api'

type UseCableRoutingControllerOptions = {
  routeRequests: CableLaneRouteRequest[]
  routeGeometryReady: boolean
  onResolveConnectionRouteSides(changes: Array<{
    connectionId: number
    sourceSide: ConnectionRouteSide
    targetSide: ConnectionRouteSide
  }>): Promise<void>
  onCanonicalizeConnectionRoutes(changes: CableRouteCanonicalRepair[]): Promise<void>
}

export function useCableRoutingController({
  routeRequests,
  routeGeometryReady,
  onResolveConnectionRouteSides,
  onCanonicalizeConnectionRoutes,
}: UseCableRoutingControllerOptions) {
  const domainEngine = useDomainEngine()
  const routingEngineError = domainEngine.state.phase === 'failed' && 'error' in domainEngine.state
    ? domainEngine.state.error ?? 'Background cable routing is unavailable.'
    : null
  const [routingState, setRoutingState] = useState<CableRoutingState>({
    routes: new Map(),
    pending: false,
    error: null,
    warnings: new Map(),
    repairs: new Map(),
  })
  const [routingCacheReady, setRoutingCacheReady] = useState(false)
  const routingCoordinatorRef = useRef<CableRoutingCoordinator | null>(null)
  const routingEnginePhaseRef = useRef(domainEngine.state.phase)
  const routingEngineSynchronizedRef = useRef(false)
  const routeSideResolutionSignatureRef = useRef<string | null>(null)
  const routeCanonicalizationSignatureRef = useRef<string | null>(null)

  useEffect(() => {
    if (!domainEngine.enabled) return

    let cancelled = false
    setRoutingCacheReady(false)
    const coordinator = new CableRoutingCoordinator(domainEngine.client, {
      persistCache: saveRoutingCache,
    })
    routingEngineSynchronizedRef.current = false
    routingCoordinatorRef.current = coordinator
    const unsubscribe = coordinator.subscribe(setRoutingState)
    void loadRoutingCache()
      .then((cache) => coordinator.hydrate(cache))
      .catch((error) => {
        console.warn('[Cable routing] Unable to load derived route cache.', error)
      })
      .finally(() => {
        if (!cancelled) setRoutingCacheReady(true)
      })

    return () => {
      cancelled = true
      unsubscribe()
      coordinator.dispose()
      routingCoordinatorRef.current = null
    }
  }, [domainEngine.client, domainEngine.enabled])

  useEffect(() => {
    if (domainEngine.state.phase === 'ready') return

    setRoutingState((current) => ({
      ...current,
      pending: current.error ? false : domainEngine.enabled,
      error: current.error ?? routingEngineError,
    }))
  }, [domainEngine.enabled, domainEngine.state.phase, routingEngineError])

  useEffect(() => {
    const coordinator = routingCoordinatorRef.current
    if (!coordinator || !routingCacheReady || domainEngine.state.phase !== 'ready') return
    const synchronizeEngine = !routingEngineSynchronizedRef.current
      || routingEnginePhaseRef.current !== 'ready'
    routingEnginePhaseRef.current = domainEngine.state.phase

    if (!routeGeometryReady) return

    if (routeRequests.length === 0) {
      coordinator.clear()
    } else {
      coordinator.request(routeRequests, synchronizeEngine && coordinator.getState().error === null)
    }
    routingEngineSynchronizedRef.current = true
  }, [domainEngine.state.phase, routeGeometryReady, routeRequests, routingCacheReady])

  useEffect(() => {
    if (domainEngine.state.phase !== 'ready') {
      routingEnginePhaseRef.current = domainEngine.state.phase
      routingEngineSynchronizedRef.current = false
    }
  }, [domainEngine.state.phase])

  useEffect(() => {
    if (routingState.pending || routingState.error) return

    const changes = routeRequests.flatMap((entry) => {
      if (entry.request.sourceSide && entry.request.targetSide) return []
      const route = routingState.routes.get(entry.connectionId)
      return route ? [{
        connectionId: entry.connectionId,
        sourceSide: route.sourceSide,
        targetSide: route.targetSide,
      }] : []
    })
    if (changes.length === 0) {
      routeSideResolutionSignatureRef.current = null
      return
    }

    const signature = changes
      .map((change) => `${change.connectionId}:${change.sourceSide}:${change.targetSide}`)
      .join('|')
    if (routeSideResolutionSignatureRef.current === signature) return
    routeSideResolutionSignatureRef.current = signature
    void onResolveConnectionRouteSides(changes).catch(() => {
      if (routeSideResolutionSignatureRef.current === signature) {
        routeSideResolutionSignatureRef.current = null
      }
    })
  }, [onResolveConnectionRouteSides, routeRequests, routingState])

  useEffect(() => {
    if (routingState.pending || routingState.error || routingState.repairs.size === 0) return

    const changes = [...routingState.repairs.values()]
      .filter((repair) => {
        const request = routeRequests.find((entry) => entry.connectionId === repair.connectionId)
        return request && pointsEqual(
          request.request.manualBendPoints ?? [],
          repair.originalBendPoints,
        )
      })
      .sort((left, right) => left.connectionId - right.connectionId)
    if (changes.length === 0) return

    const signature = changes.map((change) => [
      change.connectionId,
      pointSignature(change.originalBendPoints),
      pointSignature(change.bendPoints),
    ].join(':')).join('|')
    if (routeCanonicalizationSignatureRef.current === signature) return
    routeCanonicalizationSignatureRef.current = signature
    void onCanonicalizeConnectionRoutes(changes).catch(() => {
      if (routeCanonicalizationSignatureRef.current === signature) {
        routeCanonicalizationSignatureRef.current = null
      }
    })
  }, [onCanonicalizeConnectionRoutes, routeRequests, routingState])

  return {
    routingState,
    enginePhase: domainEngine.state.phase,
  }
}

function pointsEqual(
  left: readonly { x: number; y: number }[],
  right: readonly { x: number; y: number }[],
) {
  return left.length === right.length && left.every(
    (point, index) => point.x === right[index]?.x && point.y === right[index]?.y,
  )
}

function pointSignature(points: readonly { x: number; y: number }[]) {
  return points.map((point) => `${point.x},${point.y}`).join(';')
}
