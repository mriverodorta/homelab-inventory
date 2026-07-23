import type {
  EngineResponse,
  ProjectPatch,
  TopologyConnection,
  TopologyConnectionRoute,
} from '../../shared/engine/protocol.mjs'
import { fromTopologyEndpointRef } from '@/engine/topology'
import type {
  ConnectionRoutePreferences,
  InventoryConnection,
  InventoryConnectionType,
  ProjectState,
} from '@/types/inventory'

function runtimeRoute(route: TopologyConnectionRoute | null): ConnectionRoutePreferences | undefined {
  if (!route) return undefined
  const result: ConnectionRoutePreferences = {
    ...(route.source_side ? { sourceSide: route.source_side as ConnectionRoutePreferences['sourceSide'] } : {}),
    ...(route.target_side ? { targetSide: route.target_side as ConnectionRoutePreferences['targetSide'] } : {}),
    ...(route.bend_points.length > 0 ? { bendPoints: route.bend_points } : {}),
    ...(route.avoid_cable_overlap ? { avoidCableOverlap: true } : {}),
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function runtimeConnection(connection: TopologyConnection): InventoryConnection {
  const route = runtimeRoute(connection.route)
  return {
    id: connection.id,
    from: fromTopologyEndpointRef(connection.from),
    to: fromTopologyEndpointRef(connection.to),
    type: connection.connection_type as InventoryConnectionType,
    ...(connection.negotiated_speed_mbps === null
      ? {}
      : { negotiatedSpeedMbps: connection.negotiated_speed_mbps }),
    ...(connection.label === null ? {} : { label: connection.label }),
    ...(route ? { route } : {}),
    createdAt: connection.created_at,
  }
}

export function applyProjectPatch(
  project: ProjectState,
  patch: ProjectPatch,
  revision: number,
): ProjectState {
  if (patch.kind === 'batch') {
    return patch.payload.patches.reduce(
      (current, childPatch) => applyProjectPatch(current, childPatch, revision),
      project,
    )
  }
  if (patch.kind === 'set-project-name') {
    return {
      ...project,
      revision,
      metadata: {
        ...project.metadata,
        name: patch.payload.name,
      },
    }
  }
  if (patch.kind === 'add-connection') {
    return {
      ...project,
      revision,
      connections: [...project.connections, runtimeConnection(patch.payload.connection)],
    }
  }
  if (patch.kind === 'remove-connection') {
    return {
      ...project,
      revision,
      connections: project.connections.filter(
        (connection) => connection.id !== patch.payload.connection.id,
      ),
    }
  }
  if (patch.kind === 'set-connection-label') {
    return {
      ...project,
      revision,
      connections: project.connections.map((connection) => {
        if (connection.id !== patch.payload.connection_id) return connection
        const { label: _label, ...withoutLabel } = connection
        return patch.payload.label === null
          ? withoutLabel
          : { ...withoutLabel, label: patch.payload.label }
      }),
    }
  }
  if (patch.kind === 'set-connection-route') {
    const route = runtimeRoute(patch.payload.route)
    return {
      ...project,
      revision,
      connections: project.connections.map((connection) => {
        if (connection.id !== patch.payload.connection_id) return connection
        const { route: _route, ...withoutRoute } = connection
        return route ? { ...withoutRoute, route } : withoutRoute
      }),
    }
  }
  if (patch.kind === 'set-connection-derived') {
    const states = new Map(
      patch.payload.states.map((state) => [state.connection_id, state]),
    )
    return {
      ...project,
      revision,
      connections: project.connections.map((connection) => {
        const state = states.get(connection.id)
        if (!state) return connection
        const { negotiatedSpeedMbps: _speed, ...withoutSpeed } = connection
        return {
          ...withoutSpeed,
          type: state.connection_type as InventoryConnectionType,
          ...(state.negotiated_speed_mbps === null
            ? {}
            : { negotiatedSpeedMbps: state.negotiated_speed_mbps }),
        }
      }),
    }
  }
  return project
}

export function applyEngineResponsePatch(project: ProjectState, response: EngineResponse) {
  if (response.result.kind !== 'patch') return project
  return applyProjectPatch(
    project,
    response.result.payload.forward,
    response.result.payload.revision,
  )
}
