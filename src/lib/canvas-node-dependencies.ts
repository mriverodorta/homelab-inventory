import type {
  ComponentAssignment,
  ConnectionEndpoint,
  InventoryConnection,
  ProjectState,
} from '@/types/inventory'

export type CanvasNodeProjectSnapshots = ReadonlyMap<string, ProjectState>

function assignmentMap(project: ProjectState): Map<number, ComponentAssignment> {
  return new Map(project.assignments.map((assignment) => [assignment.id, assignment]))
}

function assignedHostsByItem(project: ProjectState): Map<string, Set<string>> {
  const hostsByItem = new Map<string, Set<string>>()

  for (const assignment of project.assignments) {
    const hosts = hostsByItem.get(assignment.itemId) ?? new Set<string>()
    hosts.add(assignment.serverId)
    hostsByItem.set(assignment.itemId, hosts)
  }

  return hostsByItem
}

function assignmentsEqual(first: ComponentAssignment, second: ComponentAssignment): boolean {
  return first.serverId === second.serverId
    && first.itemId === second.itemId
    && first.type === second.type
    && first.assignedAt === second.assignedAt
    && JSON.stringify(first.allocation) === JSON.stringify(second.allocation)
}

function endpointsEqual(first: ConnectionEndpoint, second: ConnectionEndpoint): boolean {
  return first.itemId === second.itemId
    && first.portId === second.portId
    && first.endpointId === second.endpointId
    && first.hostedItemId === second.hostedItemId
}

function connectionsEqualForCanvasNodes(
  first: InventoryConnection,
  second: InventoryConnection,
): boolean {
  return first.type === second.type
    && first.negotiatedSpeedMbps === second.negotiatedSpeedMbps
    && first.label === second.label
    && first.createdAt === second.createdAt
    && endpointsEqual(first.from, second.from)
    && endpointsEqual(first.to, second.to)
    && first.route?.sourceSide === second.route?.sourceSide
    && first.route?.targetSide === second.route?.targetSide
}

function addEndpointDependencies(target: Set<string>, endpoint: ConnectionEndpoint): void {
  target.add(endpoint.itemId)
  if (endpoint.hostedItemId) target.add(endpoint.hostedItemId)
}

function compatibilityPoliciesEqual(first: ProjectState, second: ProjectState): boolean {
  const firstPolicy = first.compatibilityPolicy
  const secondPolicy = second.compatibilityPolicy

  if (firstPolicy === secondPolicy) return true
  if (!firstPolicy || !secondPolicy) return false
  if (firstPolicy.disabledHosts.length !== secondPolicy.disabledHosts.length) return false
  if (firstPolicy.ignoredWarningIds.length !== secondPolicy.ignoredWarningIds.length) return false

  return firstPolicy.disabledHosts.every((host, index) => {
    const candidate = secondPolicy.disabledHosts[index]
    return host.hostType === candidate?.hostType && host.hostId === candidate.hostId
  }) && firstPolicy.ignoredWarningIds.every(
    (warningId, index) => warningId === secondPolicy.ignoredWarningIds[index],
  )
}

export function getAffectedCanvasItemIds(
  previous: ProjectState,
  next: ProjectState,
): ReadonlySet<string> {
  if (previous === next) return new Set()

  const affected = new Set<string>()
  const previousAssignments = assignmentMap(previous)
  const nextAssignments = assignmentMap(next)
  const assignmentIds = new Set([...previousAssignments.keys(), ...nextAssignments.keys()])

  for (const assignmentId of assignmentIds) {
    const before = previousAssignments.get(assignmentId)
    const after = nextAssignments.get(assignmentId)
    if (before && after && assignmentsEqual(before, after)) continue
    if (before) {
      affected.add(before.serverId)
      affected.add(before.itemId)
    }
    if (after) {
      affected.add(after.serverId)
      affected.add(after.itemId)
    }
  }

  const previousHostsByItem = assignedHostsByItem(previous)
  const nextHostsByItem = assignedHostsByItem(next)
  const itemIds = new Set([...Object.keys(previous.items), ...Object.keys(next.items)])

  for (const itemId of itemIds) {
    if (previous.items[itemId] === next.items[itemId]) continue
    affected.add(itemId)
    for (const hostId of previousHostsByItem.get(itemId) ?? []) affected.add(hostId)
    for (const hostId of nextHostsByItem.get(itemId) ?? []) affected.add(hostId)
  }

  const previousConnections = new Map(previous.connections.map((connection) => [connection.id, connection]))
  const nextConnections = new Map(next.connections.map((connection) => [connection.id, connection]))
  const connectionIds = new Set([...previousConnections.keys(), ...nextConnections.keys()])

  for (const connectionId of connectionIds) {
    const before = previousConnections.get(connectionId)
    const after = nextConnections.get(connectionId)
    if (before && after && connectionsEqualForCanvasNodes(before, after)) continue
    if (before) {
      addEndpointDependencies(affected, before.from)
      addEndpointDependencies(affected, before.to)
    }
    if (after) {
      addEndpointDependencies(affected, after.from)
      addEndpointDependencies(affected, after.to)
    }
  }

  const previousPlacementIds = new Set(previous.placements.map((placement) => placement.serverId))
  const nextPlacementIds = new Set(next.placements.map((placement) => placement.serverId))
  for (const itemId of previousPlacementIds) {
    if (!nextPlacementIds.has(itemId)) affected.add(itemId)
  }
  for (const itemId of nextPlacementIds) {
    if (!previousPlacementIds.has(itemId)) affected.add(itemId)
  }

  if (!compatibilityPoliciesEqual(previous, next)) {
    for (const placement of next.placements) affected.add(placement.serverId)
  }

  return affected
}

export function reconcileCanvasNodeProjectSnapshots(
  previousProject: ProjectState,
  nextProject: ProjectState,
  previousSnapshots: CanvasNodeProjectSnapshots,
): CanvasNodeProjectSnapshots {
  const affected = getAffectedCanvasItemIds(previousProject, nextProject)
  if (
    affected.size === 0
    && previousSnapshots.size === nextProject.placements.length
    && nextProject.placements.every((placement) => previousSnapshots.has(placement.serverId))
  ) {
    return previousSnapshots
  }
  const nextSnapshots = new Map<string, ProjectState>()

  for (const placement of nextProject.placements) {
    const previousSnapshot = previousSnapshots.get(placement.serverId)
    nextSnapshots.set(
      placement.serverId,
      affected.has(placement.serverId) || !previousSnapshot ? nextProject : previousSnapshot,
    )
  }

  return nextSnapshots
}
