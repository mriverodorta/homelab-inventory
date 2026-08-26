import { useEffect, useRef, useState } from 'react'
import { useDomainEngine } from '@/hooks/use-domain-engine'
import type { CableLaneRouteRequest } from '@/engine/routing'
import type { ConnectionRouteSide } from '@/types/inventory'
import {
  type CableRouteCanonicalRepair,
  type CableRoutingState,
} from '@/lib/cable-routing-coordinator'
import { getCanvasRoutingRuntime } from '@/engine/canvas-routing-runtime'

type UseCableRoutingControllerOptions = {
  routeRequests: CableLaneRouteRequest[]
  routeGeometryReady: boolean
  topologyRevision: number
  onResolveConnectionRouteSides(changes: Array<{
    connectionId: number
    sourceSide: ConnectionRouteSide
    targetSide: ConnectionRouteSide
  }>): Promise<void>
  onCanonicalizeConnectionRoutes(changes: CableRouteCanonicalRepair[]): Promise<void>
}

const EMPTY_ROUTE_CLEAR_DELAY_MS = 250

export function useCableRoutingController({
  routeRequests,
  routeGeometryReady,
  topologyRevision,
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
  const routingRuntimeRef = useRef<ReturnType<typeof getCanvasRoutingRuntime> | null>(null)
  const emptyRouteClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const routedTopologyRevisionRef = useRef<number | null>(null)
  const routeSideResolutionSignatureRef = useRef<string | null>(null)
  const routeCanonicalizationSignatureRef = useRef<string | null>(null)

  useEffect(() => {
    if (!domainEngine.enabled) return
    const runtime = getCanvasRoutingRuntime(domainEngine.client)
    routingRuntimeRef.current = runtime
    const unsubscribe = runtime.subscribe((snapshot) => {
      setRoutingState(snapshot.state)
      setRoutingCacheReady(snapshot.cacheReady)
    })
    return () => {
      if (emptyRouteClearTimerRef.current) {
        clearTimeout(emptyRouteClearTimerRef.current)
        emptyRouteClearTimerRef.current = null
      }
      unsubscribe()
      if (routingRuntimeRef.current === runtime) routingRuntimeRef.current = null
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
    const coordinator = routingRuntimeRef.current?.coordinator
    if (!coordinator || !routingCacheReady || domainEngine.state.phase !== 'ready') return

    if (!routeGeometryReady) return

    if (routeRequests.length === 0) {
      const timer = setTimeout(() => {
        if (routingRuntimeRef.current?.coordinator !== coordinator) return
        emptyRouteClearTimerRef.current = null
        coordinator.clear()
      }, EMPTY_ROUTE_CLEAR_DELAY_MS)
      emptyRouteClearTimerRef.current = timer
      return () => {
        clearTimeout(timer)
        if (emptyRouteClearTimerRef.current === timer) {
          emptyRouteClearTimerRef.current = null
        }
      }
    } else {
      const topologyChanged = routedTopologyRevisionRef.current !== null
        && routedTopologyRevisionRef.current !== topologyRevision
      routedTopologyRevisionRef.current = topologyRevision
      coordinator.request(routeRequests, topologyChanged)
    }
  }, [
    domainEngine.state.phase,
    routeGeometryReady,
    routeRequests,
    routingCacheReady,
    topologyRevision,
  ])

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
