export const ENGINE_PROTOCOL_VERSION: 1
export const EMPTY_ENGINE_TOPOLOGY: TopologySnapshot

export type EngineSnapshot = {
  revision: number
  project_name: string
  topology: TopologySnapshot
}

export type TopologyItemRef = {
  item_type: string
  id: number
}

export type TopologyEndpointRef = {
  item: TopologyItemRef
  port_id: number
  endpoint_id: number | null
  hosted_item: TopologyItemRef | null
}

export type TopologyPort = {
  id: number
  key: string | null
  port_type: string
  slot_number: number
  speed: string | null
  endpoints: Array<{ id: number; side: string }>
}

export type TopologyItem = {
  item: TopologyItemRef
  archived: boolean
  power_configuration: string | null
  allow_outlet_fan_out: boolean
  ports: TopologyPort[]
}

export type TopologyConnectionRoute = {
  source_side: string | null
  target_side: string | null
  bend_points: Array<{ x: number; y: number }>
  avoid_cable_overlap: boolean
}

export type TopologyConnection = {
  id: number
  from: TopologyEndpointRef
  to: TopologyEndpointRef
  connection_type: string
  negotiated_speed_mbps: number | null
  label: string | null
  route: TopologyConnectionRoute | null
  created_at: string
}

export type ConnectionDerivedState = {
  connection_id: number
  connection_type: string
  negotiated_speed_mbps: number | null
}

export type TopologyNetworkTrace = {
  start: TopologyEndpointRef
  steps: Array<{
    endpoint: TopologyEndpointRef
    state: 'connected' | 'open' | 'internal'
    connection_id: number | null
  }>
  complete: boolean
}

export type TopologyPowerFinding = {
  id: string
  code:
    | 'power.host.missing-input'
    | 'power.host.unpowered'
    | 'power.monitor.unpowered'
    | 'power.connection.stale-endpoint'
    | 'power.connection.invalid-direction'
    | 'power.connection.duplicate-input'
    | 'power.connection.output-fan-out'
    | 'power.connection.misclassified'
  severity: 'warning' | 'error'
  item: TopologyItemRef | null
  connection_id: number | null
  endpoint: TopologyEndpointRef | null
}

export type TopologyPowerTopology = {
  endpoints: TopologyEndpointDescriptor[]
  findings: TopologyPowerFinding[]
}

export type TopologySnapshot = {
  items: TopologyItem[]
  assignments: Array<{
    id: number
    host: TopologyItemRef
    item: TopologyItemRef
    component_type: string
  }>
  connections: TopologyConnection[]
  placements: TopologyItemRef[]
}

export type TopologyEndpointDescriptor = {
  endpoint: TopologyEndpointRef
  host: TopologyItemRef
  owner: TopologyItemRef
  port_type: string
  slot_number: number
  side: string | null
  speed: string | null
  connection_ids: number[]
  placed: boolean
  available: boolean
  power: {
    direction: string
    kind: string
    allow_fan_out: boolean
  } | null
}

export type GeometryRect = {
  x: number
  y: number
  width: number
  height: number
}

export type GeometryNode = {
  item_id: string
  bounds: GeometryRect
}

export type GeometryHandle = {
  key: string
  item_id: string
  point: { x: number; y: number }
  side: 'left' | 'right' | 'top' | 'bottom'
}

export type ArrangementItem = {
  item_id: string
  name: string
  column: number
  width: number
  height: number
}

export type CanvasPlacement = {
  item: TopologyItemRef
  x: number
  y: number
}

export type PlacementChange = {
  previous: CanvasPlacement | null
  next: CanvasPlacement | null
}

export type RouteDefinition = {
  connection_id: number
  source: { x: number; y: number }
  target: { x: number; y: number }
  source_side: 'left' | 'right' | 'top' | 'bottom'
  target_side: 'left' | 'right' | 'top' | 'bottom'
  lane_offset: number
  manual_bends: Array<{ x: number; y: number }>
}

export type RoutedPath = {
  connection_id: number
  points: Array<{ x: number; y: number }>
  manual_anchor_point_indexes: number[]
}

export type RoutePatch = {
  connection_id: number
  bend_points: Array<{ x: number; y: number }>
}

export type RouteEdit = {
  route: RoutedPath
  forward: RoutePatch
  inverse: RoutePatch
}

export type RouteObstacle = {
  item_id: string
  bounds: GeometryRect
}

export type ReservedSegment = {
  start: { x: number; y: number }
  end: { x: number; y: number }
}

export type ObstacleRouteRequest = {
  definition: RouteDefinition
  source_item_id: string
  target_item_id: string
  obstacles: RouteObstacle[]
  reserved_segments: ReservedSegment[]
  snap_to_grid: boolean
  grid_size: number
  previous_valid_route: RoutedPath | null
}

export type ObstacleRouteResult = {
  route: RoutedPath
  used_fallback: boolean
  warning: 'search-exhausted' | null
}

export type LaneRouteRequest = {
  avoid_cable_overlap: boolean
  request: ObstacleRouteRequest
}

export type CableRoutePlanRequest = {
  obstacles: RouteObstacle[]
  requests: LaneRouteRequest[]
}

export type CableRoutePlan = {
  routes: ObstacleRouteResult[]
  recalculated_connection_ids: number[]
}

export type EngineOperation =
  | { kind: 'status' }
  | { kind: 'topology-endpoints' }
  | {
      kind: 'compatible-destinations'
      payload: { source: TopologyEndpointRef }
    }
  | {
      kind: 'validate-connection'
      payload: { from: TopologyEndpointRef; to: TopologyEndpointRef }
    }
  | { kind: 'trace-network-path'; payload: { start: TopologyEndpointRef } }
  | { kind: 'network-traces' }
  | { kind: 'power-topology' }
  | { kind: 'connection-derived-states' }
  | {
      kind: 'create-connection'
      payload: { from: TopologyEndpointRef; to: TopologyEndpointRef; created_at: string }
    }
  | { kind: 'remove-connection'; payload: { connection_id: number } }
  | {
      kind: 'update-connection-label'
      payload: { connection_id: number; label: string | null }
    }
  | {
      kind: 'update-connection-route'
      payload: { connection_id: number; route: TopologyConnectionRoute | null }
    }
  | { kind: 'update-project-metadata'; payload: { name: string } }
  | { kind: 'update-placements'; payload: { changes: PlacementChange[] } }
  | {
      kind: 'replace-geometry'
      payload: { nodes: GeometryNode[]; handles: GeometryHandle[] }
    }
  | {
      kind: 'update-geometry'
      payload: {
        upsert_nodes: GeometryNode[]
        remove_node_ids: string[]
        upsert_handles: GeometryHandle[]
        remove_handle_keys: string[]
      }
    }
  | {
      kind: 'check-placement'
      payload: { item_id: string; bounds: GeometryRect; exclude_item_ids: string[] }
    }
  | { kind: 'check-group-move'; payload: { moves: GeometryNode[] } }
  | {
      kind: 'find-nearest-placement'
      payload: {
        item_id: string
        preferred: GeometryRect
        clearance: number
        step: number
        max_rings: number
      }
    }
  | {
      kind: 'arrange-items'
      payload: {
        items: ArrangementItem[]
        grid_size: number
        column_gap: number
        item_gap: number
      }
    }
  | { kind: 'replace-routes'; payload: { routes: RouteDefinition[] } }
  | { kind: 'build-route'; payload: { connection_id: number } }
  | {
      kind: 'route-around-obstacles'
      payload: { request: ObstacleRouteRequest }
    }
  | {
      kind: 'plan-cable-routes'
      payload: { plan: CableRoutePlanRequest }
    }
  | {
      kind: 'preview-planned-route-segment'
      payload: {
        connection_id: number
        segment_index: number
        coordinate: number
        snap_grid: number | null
        endpoint_snap_threshold: number
      }
    }
  | {
      kind: 'insert-planned-manual-bend'
      payload: {
        connection_id: number
        segment_index: number
        point: { x: number; y: number }
        snap_grid: number | null
      }
    }
  | {
      kind: 'preview-move-route-segment'
      payload: {
        connection_id: number
        segment_index: number
        coordinate: number
        snap_grid: number | null
        endpoint_snap_threshold: number
      }
    }
  | {
      kind: 'insert-manual-bend'
      payload: {
        connection_id: number
        segment_index: number
        point: { x: number; y: number }
        snap_grid: number | null
      }
    }
  | {
      kind: 'remove-manual-bend'
      payload: { connection_id: number; bend_index: number }
    }
  | {
      kind: 'move-route-segment'
      payload: {
        connection_id: number
        segment_index: number
        coordinate: number
        snap_grid: number | null
        endpoint_snap_threshold: number
      }
    }
  | { kind: 'reset-route'; payload: { connection_id: number } }

export type EngineRequest = {
  protocol_version: 1
  request_id: number
  base_revision: number
  operation: EngineOperation
}

export type ProjectPatch =
  | { kind: 'set-project-name'; payload: { name: string } }
  | { kind: 'add-connection'; payload: { connection: TopologyConnection } }
  | { kind: 'remove-connection'; payload: { connection: TopologyConnection } }
  | {
      kind: 'set-connection-label'
      payload: { connection_id: number; label: string | null }
    }
  | {
      kind: 'set-connection-route'
      payload: { connection_id: number; route: TopologyConnectionRoute | null }
    }
  | {
      kind: 'set-connection-derived'
      payload: { states: ConnectionDerivedState[] }
    }
  | {
      kind: 'patch-placements'
      payload: { upsert: CanvasPlacement[]; remove_items: TopologyItemRef[] }
    }
  | { kind: 'batch'; payload: { patches: ProjectPatch[] } }

export type EngineResponseBody =
  | {
      kind: 'status'
      payload: {
        revision: number
        geometry_revision: number
        routing_revision: number
        project_name: string
      }
    }
  | {
      kind: 'topology-endpoints'
      payload: { endpoints: TopologyEndpointDescriptor[] }
    }
  | {
      kind: 'connection-validation'
      payload: { ok: boolean; code: string | null; message: string | null }
    }
  | {
      kind: 'network-trace'
      payload: { trace: TopologyNetworkTrace | null }
    }
  | {
      kind: 'network-traces'
      payload: { traces: TopologyNetworkTrace[] }
    }
  | {
      kind: 'power-topology'
      payload: { topology: TopologyPowerTopology }
    }
  | {
      kind: 'connection-derived-states'
      payload: { states: ConnectionDerivedState[] }
    }
  | {
      kind: 'patch'
      payload: { revision: number; forward: ProjectPatch; inverse: ProjectPatch }
    }
  | { kind: 'geometry-updated'; payload: { geometry_revision: number } }
  | {
      kind: 'placement-check'
      payload: { valid: boolean; colliding_item_ids: string[] }
    }
  | { kind: 'nearest-placement'; payload: { bounds: GeometryRect | null } }
  | { kind: 'arrangement'; payload: { nodes: GeometryNode[] } }
  | { kind: 'routes-updated'; payload: { routing_revision: number } }
  | { kind: 'route'; payload: { route: RoutedPath } }
  | { kind: 'obstacle-route'; payload: ObstacleRouteResult }
  | { kind: 'cable-routes-planned'; payload: CableRoutePlan }
  | { kind: 'route-preview'; payload: RouteEdit }
  | { kind: 'route-edited'; payload: { routing_revision: number; edit: RouteEdit } }
  | { kind: 'error'; payload: { code: string; message: string } }

export type EngineResponse = {
  protocol_version: 1
  request_id: number
  base_revision: number
  result: EngineResponseBody
}

export function encodeEngineSnapshot(snapshot: EngineSnapshot): Uint8Array
export function decodeEngineSnapshot(bytes: ArrayBuffer | Uint8Array): EngineSnapshot
export function encodeEngineRequest(request: EngineRequest): Uint8Array
export function decodeEngineRequest(bytes: ArrayBuffer | Uint8Array): EngineRequest
export function encodeEngineResponse(response: EngineResponse): Uint8Array
export function decodeEngineResponse(bytes: ArrayBuffer | Uint8Array): EngineResponse
