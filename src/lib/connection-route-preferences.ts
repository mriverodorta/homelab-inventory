import type { ProjectState } from '@/types/inventory'

export function countConnectionsWithManualBends(project: ProjectState): number {
  return project.connections.reduce(
    (count, connection) => count + ((connection.route?.bendPoints?.length ?? 0) > 0 ? 1 : 0),
    0,
  )
}

export function clearAllManualConnectionBends(project: ProjectState): ProjectState {
  let changed = false
  const connections = project.connections.map((connection) => {
    const route = connection.route

    if (!route?.bendPoints?.length) return connection

    changed = true
    const { bendPoints: _bendPoints, ...remainingRoute } = route
    const hasRemainingPreferences = Object.keys(remainingRoute).length > 0

    if (hasRemainingPreferences) {
      return {
        ...connection,
        route: remainingRoute,
      }
    }

    const { route: _route, ...connectionWithoutRoute } = connection
    return connectionWithoutRoute
  })

  return changed ? { ...project, connections } : project
}

export function countConnectionsWithManualRouteGeometry(project: ProjectState): number {
  return project.connections.reduce((count, connection) => {
    const route = connection.route
    const hasManualGeometry = Boolean(
      route?.sourceSide
      || route?.targetSide
      || route?.bendPoints?.length,
    )
    return count + (hasManualGeometry ? 1 : 0)
  }, 0)
}

export function restoreAllAutomaticConnectionRoutes(project: ProjectState): ProjectState {
  let changed = false
  const connections = project.connections.map((connection) => {
    const route = connection.route
    if (!route || (!route.sourceSide && !route.targetSide && !route.bendPoints?.length)) {
      return connection
    }

    changed = true
    if (route.avoidCableOverlap) {
      return {
        ...connection,
        route: { avoidCableOverlap: true },
      }
    }

    const { route: _route, ...connectionWithoutRoute } = connection
    return connectionWithoutRoute
  })

  return changed ? { ...project, connections } : project
}
