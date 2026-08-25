import { planHostAllocations } from '@/lib/compatibility'
import {
  getCanvasItemHeight,
  getCanvasItemWidth,
  SERVER_CARD_COLLISION_GAP,
} from '@/lib/project'
import type { ComponentAssignment, ConnectionEndpoint, InventoryConnection, ProjectState } from '@/types/inventory'

type CopyCanvasHostConfigurationOptions = Readonly<{
  source: ProjectState
  destination: ProjectState
  hostId: string
  includeComponents?: boolean
  includeConnections?: boolean
}>

export type CopiedCanvasHostConfiguration = Readonly<{
  project: ProjectState
  placedHost: boolean
  copiedAssignmentCount: number
  copiedConnectionCount: number
  unavailableConnections: readonly Readonly<{ id: number; reason: string }>[]
}>

function endpointIdentity(endpoint: ConnectionEndpoint) {
  return `${endpoint.hostedItemId ?? endpoint.itemId}:${endpoint.portId}:${endpoint.endpointId ?? 0}`
}

function hostPlacement(project: ProjectState, itemId: string) {
  return project.placements.find((placement) => placement.serverId === itemId)
}

function destinationHostPlacement(source: ProjectState, destination: ProjectState, hostId: string) {
  const preferred = hostPlacement(source, hostId)
  if (!preferred) throw new Error('The host must be placed on the source canvas.')

  const width = getCanvasItemWidth(source, hostId) + SERVER_CARD_COLLISION_GAP
  const height = getCanvasItemHeight(source, hostId) + SERVER_CARD_COLLISION_GAP
  const occupied = destination.placements.map((placement) => ({
    x: placement.x,
    y: placement.y,
    width: getCanvasItemWidth(destination, placement.serverId) + SERVER_CARD_COLLISION_GAP,
    height: getCanvasItemHeight(destination, placement.serverId) + SERVER_CARD_COLLISION_GAP,
  }))

  for (let offset = 0; offset <= 4096; offset += 1) {
    const candidate = { ...preferred, x: preferred.x + offset * SERVER_CARD_COLLISION_GAP }
    const overlaps = occupied.some((existing) => (
      candidate.x < existing.x + existing.width
      && candidate.x + width > existing.x
      && candidate.y < existing.y + existing.height
      && candidate.y + height > existing.y
    ))
    if (!overlaps) return candidate
  }

  throw new Error('A collision-free position could not be found on the destination canvas.')
}

function allocationIdentity(assignment: ComponentAssignment) {
  const allocation = assignment.allocation
  return allocation
    ? `${allocation.resourceType}:${allocation.groupId ?? ''}:${[...allocation.positions].sort((a, b) => a - b).join(',')}`
    : null
}

function nextAssignmentId(project: ProjectState) {
  return Math.max(project.nextAssignmentId ?? 1, ...project.assignments.map((assignment) => assignment.id + 1))
}

function nextConnectionId(project: ProjectState) {
  return Math.max(project.nextConnectionId ?? 1, ...project.connections.map((connection) => connection.id + 1))
}

function containsEndpoint(project: ProjectState, endpoint: ConnectionEndpoint) {
  if (!hostPlacement(project, endpoint.itemId)) return false
  if (!endpoint.hostedItemId) return true
  return project.assignments.some((assignment) => (
    assignment.serverId === endpoint.itemId && assignment.itemId === endpoint.hostedItemId
  ))
}

function touchesHost(connection: InventoryConnection, hostId: string) {
  return connection.from.itemId === hostId || connection.to.itemId === hostId
}

function matchingGeometry(source: ProjectState, destination: ProjectState, connection: InventoryConnection) {
  return [connection.from.itemId, connection.to.itemId].every((itemId) => {
    const before = hostPlacement(source, itemId)
    const after = hostPlacement(destination, itemId)
    return before && after && before.x === after.x && before.y === after.y
  })
}

export function copyCanvasHostConfiguration({
  source,
  destination,
  hostId,
  includeComponents = true,
  includeConnections = false,
}: CopyCanvasHostConfigurationOptions): CopiedCanvasHostConfiguration {
  if (source.metadata.projectId !== destination.metadata.projectId) {
    throw new Error('Host configurations can only be copied within the same project.')
  }
  if (source.metadata.workspaceId === destination.metadata.workspaceId) {
    throw new Error('Choose a different destination canvas.')
  }
  if (!hostPlacement(source, hostId)) {
    throw new Error('The host must be placed on the source canvas.')
  }
  if (
    !source.items[hostId]
    || !destination.items[hostId]
    || source.items[hostId].inventoryId !== destination.items[hostId].inventoryId
  ) {
    throw new Error('The selected canvases do not contain the same physical host.')
  }

  const placedHost = !hostPlacement(destination, hostId)
  let project: ProjectState = {
    ...destination,
    placements: placedHost
      ? [...destination.placements, destinationHostPlacement(source, destination, hostId)]
      : [...destination.placements],
    assignments: [...destination.assignments],
    connections: [...destination.connections],
  }
  let copiedAssignmentCount = 0
  let copiedConnectionCount = 0
  const unavailableConnections: Array<{ id: number; reason: string }> = []

  if (includeComponents) {
    for (const assignment of source.assignments.filter((candidate) => candidate.serverId === hostId)) {
      const existing = project.assignments.find((candidate) => candidate.itemId === assignment.itemId)
      if (existing) {
        if (existing.serverId !== hostId) {
          throw new Error(`${project.items[assignment.itemId]?.name ?? assignment.itemId} is already installed in another host on this canvas.`)
        }
        if (allocationIdentity(existing) !== allocationIdentity(assignment)) {
          throw new Error(`${project.items[assignment.itemId]?.name ?? assignment.itemId} is already installed in a different slot on this canvas.`)
        }
        continue
      }
      const identity = allocationIdentity(assignment)
      if (identity && project.assignments.some((candidate) => (
        candidate.serverId === hostId && allocationIdentity(candidate) === identity
      ))) {
        throw new Error(`The destination slot for ${project.items[assignment.itemId]?.name ?? assignment.itemId} is already occupied.`)
      }
      project.assignments.push({
        ...structuredClone(assignment),
        id: nextAssignmentId(project),
      })
      copiedAssignmentCount += 1
    }

    const planned = planHostAllocations(project, hostId)
    const results = new Map(planned.results.map((result) => [result.assignmentId, result]))
    for (const assignment of project.assignments.filter((candidate) => candidate.serverId === hostId)) {
      const result = results.get(assignment.id)
      if (result?.status === 'incompatible') {
        throw new Error(result.findings?.[0]?.message ?? 'A copied component is incompatible with this host.')
      }
      const projected = planned.assignments.find((candidate) => candidate.id === assignment.id)
      if (
        assignment.allocation
        && projected?.allocation
        && allocationIdentity(assignment) !== allocationIdentity(projected)
      ) {
        throw new Error(`The destination slot for ${project.items[assignment.itemId]?.name ?? assignment.itemId} is unavailable.`)
      }
    }
    const replacements = new Map(planned.assignments.map((assignment) => [assignment.id, assignment]))
    project = {
      ...project,
      assignments: project.assignments.map((assignment) => {
        const replacement = replacements.get(assignment.id)
        if (!replacement || (assignment.allocation && !replacement.allocation)) return assignment
        return replacement
      }),
    }
  }

  if (includeConnections) {
    for (const connection of source.connections.filter((candidate) => touchesHost(candidate, hostId))) {
      if (!containsEndpoint(project, connection.from) || !containsEndpoint(project, connection.to)) {
        unavailableConnections.push({ id: connection.id, reason: 'The other endpoint is not present on this canvas.' })
        continue
      }
      const sourceEndpoint = endpointIdentity(connection.from)
      const targetEndpoint = endpointIdentity(connection.to)
      const identical = project.connections.some((candidate) => (
        endpointIdentity(candidate.from) === sourceEndpoint && endpointIdentity(candidate.to) === targetEndpoint
      ))
      if (identical) continue
      const occupied = project.connections.some((candidate) => (
        [endpointIdentity(candidate.from), endpointIdentity(candidate.to)].some((endpoint) => (
          endpoint === sourceEndpoint || endpoint === targetEndpoint
        ))
      ))
      if (occupied) {
        unavailableConnections.push({ id: connection.id, reason: 'One of the destination ports is already connected.' })
        continue
      }
      const copied = structuredClone(connection)
      copied.id = nextConnectionId(project)
      if (copied.route && !matchingGeometry(source, project, connection)) delete copied.route.bendPoints
      project.connections.push(copied)
      copiedConnectionCount += 1
    }
  }

  return { project, placedHost, copiedAssignmentCount, copiedConnectionCount, unavailableConnections }
}
