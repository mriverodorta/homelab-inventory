import { and, asc, eq } from 'drizzle-orm'
import {
  componentAssignments,
  connectionEndpoints,
  inventoryPorts,
  projectConnections,
} from '../schema/index.ts'
import {
  assertPositiveId,
  bumpProjectRevision,
  type RepositoryContext,
} from './repository-context.ts'

export type ConnectionSide = 'left' | 'right' | 'top' | 'bottom'
export type ConnectionType = 'network' | 'display' | 'power' | 'other'

export type CreateConnectionInput = Readonly<{
  projectId: number
  type: ConnectionType
  sourcePortId: number
  sourceEndpointFaceId?: number | null
  targetPortId: number
  targetEndpointFaceId?: number | null
  sourceSide: ConnectionSide
  targetSide: ConnectionSide
  negotiatedSpeedBps?: number | null
  label?: string | null
  avoidCableOverlap?: boolean
}>

export function createTopologyRepository(context: RepositoryContext) {
  const { db, sqlite, now } = context

  function listAssignments(projectId: number) {
    assertPositiveId(projectId, 'Project ID')
    return db.select().from(componentAssignments)
      .where(eq(componentAssignments.projectId, projectId))
      .orderBy(asc(componentAssignments.id)).all()
  }

  function assignComponent(input: {
    projectId: number
    hostItemId: number
    componentItemId: number
    resourceSlotId?: number | null
  }) {
    const at = now()
    return sqlite.transaction(() => {
      const assignment = db.insert(componentAssignments).values({
        projectId: assertPositiveId(input.projectId, 'Project ID'),
        hostItemId: assertPositiveId(input.hostItemId, 'Host item ID'),
        componentItemId: assertPositiveId(input.componentItemId, 'Component item ID'),
        resourceSlotId: input.resourceSlotId == null ? null : assertPositiveId(input.resourceSlotId, 'Resource slot ID'),
        assignedAtMs: at,
      }).returning().get()
      bumpProjectRevision(context, input.projectId, at)
      return assignment
    }).immediate()
  }

  function unassignComponent(projectId: number, assignmentId: number) {
    const at = now()
    return sqlite.transaction(() => {
      const result = db.delete(componentAssignments).where(and(
        eq(componentAssignments.projectId, assertPositiveId(projectId, 'Project ID')),
        eq(componentAssignments.id, assertPositiveId(assignmentId, 'Assignment ID')),
      )).run()
      if (result.changes !== 1) throw new Error(`Assignment ${assignmentId} was not found in project ${projectId}.`)
      bumpProjectRevision(context, projectId, at)
    }).immediate()
  }

  function portAvailability(portId: number, endpointFaceId: number | null = null) {
    assertPositiveId(portId, 'Port ID')
    if (endpointFaceId != null) assertPositiveId(endpointFaceId, 'Endpoint face ID')
    const port = db.select({ id: inventoryPorts.id, itemId: inventoryPorts.itemId })
      .from(inventoryPorts).where(eq(inventoryPorts.id, portId)).get()
    if (!port) return null
    const endpoint = sqlite.query(`
      SELECT connection_id, role
      FROM connection_endpoints
      WHERE port_id = ? AND coalesce(endpoint_face_id, 0) = coalesce(?, 0)
    `).get(portId, endpointFaceId) as { connection_id: number; role: string } | null
    return { ...port, endpointFaceId, available: endpoint == null, connectionId: endpoint?.connection_id ?? null }
  }

  function createConnection(input: CreateConnectionInput) {
    if (input.sourcePortId === input.targetPortId && (input.sourceEndpointFaceId ?? null) === (input.targetEndpointFaceId ?? null)) {
      throw new Error('A connection requires two distinct endpoints.')
    }
    const source = portAvailability(input.sourcePortId, input.sourceEndpointFaceId ?? null)
    const target = portAvailability(input.targetPortId, input.targetEndpointFaceId ?? null)
    if (!source?.available) throw new Error('The source port endpoint is unavailable.')
    if (!target?.available) throw new Error('The target port endpoint is unavailable.')
    const at = now()
    return sqlite.transaction(() => {
      const connection = db.insert(projectConnections).values({
        projectId: assertPositiveId(input.projectId, 'Project ID'),
        connectionType: input.type,
        negotiatedSpeedBps: input.negotiatedSpeedBps ?? null,
        label: input.label?.trim() || null,
        sourceSide: input.sourceSide,
        targetSide: input.targetSide,
        avoidCableOverlap: input.avoidCableOverlap ?? false,
        createdAtMs: at,
      }).returning().get()
      db.insert(connectionEndpoints).values([
        {
          connectionId: connection.id,
          role: 'source',
          portId: input.sourcePortId,
          endpointFaceId: input.sourceEndpointFaceId ?? null,
        },
        {
          connectionId: connection.id,
          role: 'target',
          portId: input.targetPortId,
          endpointFaceId: input.targetEndpointFaceId ?? null,
        },
      ]).run()
      bumpProjectRevision(context, input.projectId, at)
      return connection
    }).immediate()
  }

  function removeConnection(projectId: number, connectionId: number) {
    const at = now()
    return sqlite.transaction(() => {
      const result = db.delete(projectConnections).where(and(
        eq(projectConnections.projectId, assertPositiveId(projectId, 'Project ID')),
        eq(projectConnections.id, assertPositiveId(connectionId, 'Connection ID')),
      )).run()
      if (result.changes !== 1) throw new Error(`Connection ${connectionId} was not found in project ${projectId}.`)
      bumpProjectRevision(context, projectId, at)
    }).immediate()
  }

  return { listAssignments, assignComponent, unassignComponent, portAvailability, createConnection, removeConnection }
}

export type TopologyRepository = ReturnType<typeof createTopologyRepository>
