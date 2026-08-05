import { useCallback, useRef } from 'react'
import type { CanvasPortDragPoint } from '@/types/canvas'
import type {
  ConnectionEndpoint,
  ConnectionRoutePreferences,
  ConnectionRouteSide,
} from '@/types/inventory'
import type { CableRouteCanonicalRepair } from '@/lib/cable-routing-coordinator'

interface StableCanvasCallbacksOptions {
  onSelect: (itemId: string) => void
  onSelectConnection: (connectionId: string | number) => void
  onRemoveAssignment: (assignmentId: string | number) => void
  onEndpointClick: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDragStart: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDrop: (endpoint: ConnectionEndpoint) => void
  onUpdateConnectionRoute: (
    connectionId: string | number,
    route: ConnectionRoutePreferences,
  ) => void
  onResolveConnectionRouteSides: (changes: Array<{
    connectionId: number
    sourceSide: ConnectionRouteSide
    targetSide: ConnectionRouteSide
  }>) => Promise<void>
  onCanonicalizeConnectionRoutes: (changes: CableRouteCanonicalRepair[]) => Promise<void>
}

export function useStableCanvasCallbacks(options: StableCanvasCallbacksOptions) {
  const callbackRef = useRef(options)
  callbackRef.current = options

  return {
    onSelect: useCallback((itemId: string) => callbackRef.current.onSelect(itemId), []),
    onSelectConnection: useCallback(
      (connectionId: string | number) => callbackRef.current.onSelectConnection(connectionId),
      [],
    ),
    onRemoveAssignment: useCallback(
      (assignmentId: string | number) => callbackRef.current.onRemoveAssignment(assignmentId),
      [],
    ),
    onEndpointClick: useCallback(
      (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) =>
        callbackRef.current.onEndpointClick(endpoint, point),
      [],
    ),
    onEndpointDragStart: useCallback(
      (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) =>
        callbackRef.current.onEndpointDragStart(endpoint, point),
      [],
    ),
    onEndpointDrop: useCallback(
      (endpoint: ConnectionEndpoint) => callbackRef.current.onEndpointDrop(endpoint),
      [],
    ),
    onUpdateConnectionRoute: useCallback(
      (connectionId: string | number, route: ConnectionRoutePreferences) =>
        callbackRef.current.onUpdateConnectionRoute(connectionId, route),
      [],
    ),
    onResolveConnectionRouteSides: useCallback(
      (changes: Array<{
        connectionId: number
        sourceSide: ConnectionRouteSide
        targetSide: ConnectionRouteSide
      }>) => callbackRef.current.onResolveConnectionRouteSides(changes),
      [],
    ),
    onCanonicalizeConnectionRoutes: useCallback(
      (changes: CableRouteCanonicalRepair[]) =>
        callbackRef.current.onCanonicalizeConnectionRoutes(changes),
      [],
    ),
  }
}
