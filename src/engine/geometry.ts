import type { GeometryNode } from '../../shared/engine/protocol.mjs'
import type { DomainEngineClient } from '@/engine/client'
import {
  getCanvasItemHeight,
  getCanvasItemWidth,
  SERVER_CARD_COLLISION_GAP,
} from '@/lib/project'
import type { ProjectState, ServerPlacement } from '@/types/inventory'

const ARRANGEMENT_COLUMN_GAP = 78
const ARRANGEMENT_GRID_SIZE = 24

export type ProjectGeometrySnapshot = {
  fingerprint: string
  nodes: GeometryNode[]
}

function arrangementColumn(project: ProjectState, itemId: string) {
  const type = project.items[itemId]?.type
  if (type === 'server' || type === 'nas' || type === 'pcBuild') return 0
  if (type === 'patchPanel') return 1
  if (type === 'switch') return 2
  return 3
}

function placementNode(project: ProjectState, placement: ServerPlacement): GeometryNode {
  return {
    item_id: placement.serverId,
    bounds: {
      x: placement.x,
      y: placement.y,
      width: getCanvasItemWidth(project, placement.serverId) + SERVER_CARD_COLLISION_GAP,
      height: getCanvasItemHeight(project, placement.serverId) + SERVER_CARD_COLLISION_GAP,
    },
  }
}

export async function syncProjectGeometry(
  client: DomainEngineClient,
  snapshot: ProjectGeometrySnapshot,
) {
  const response = await client.transient({
    operation: {
      kind: 'replace-geometry',
      payload: {
        nodes: snapshot.nodes,
        handles: [],
      },
    },
  })
  if (response.result.kind === 'geometry-updated') return response.result.payload.geometry_revision
  throw new Error(
    response.result.kind === 'error'
      ? response.result.payload.message
      : 'Workspace geometry could not be synchronized.',
  )
}

export function createProjectGeometrySnapshot(project: ProjectState): ProjectGeometrySnapshot {
  const nodes = project.placements.map((placement) => placementNode(project, placement))
  return { nodes, fingerprint: JSON.stringify(nodes) }
}

export async function checkProjectPlacement(
  client: DomainEngineClient,
  project: ProjectState,
  placement: ServerPlacement,
) {
  const node = placementNode(project, placement)
  const response = await client.queryConsistent({
    operation: {
      kind: 'check-placement',
      payload: {
        item_id: node.item_id,
        bounds: node.bounds,
        exclude_item_ids: [],
      },
    },
  })
  if (response.result.kind === 'placement-check') return response.result.payload
  throw new Error(
    response.result.kind === 'error'
      ? response.result.payload.message
      : 'Workspace placement could not be validated.',
  )
}

export async function checkProjectGroupMove(
  client: DomainEngineClient,
  project: ProjectState,
  placements: ServerPlacement[],
) {
  const response = await client.queryConsistent({
    operation: {
      kind: 'check-group-move',
      payload: { moves: placements.map((placement) => placementNode(project, placement)) },
    },
  })
  if (response.result.kind === 'placement-check') return response.result.payload
  throw new Error(
    response.result.kind === 'error'
      ? response.result.payload.message
      : 'Workspace group placement could not be validated.',
  )
}

export async function arrangeProjectItems(
  client: DomainEngineClient,
  project: ProjectState,
): Promise<ServerPlacement[]> {
  const response = await client.queryConsistent({
    operation: {
      kind: 'arrange-items',
      payload: {
        items: project.placements.map((placement) => ({
          item_id: placement.serverId,
          name: project.items[placement.serverId]?.name ?? placement.serverId,
          column: arrangementColumn(project, placement.serverId),
          width: getCanvasItemWidth(project, placement.serverId),
          height: getCanvasItemHeight(project, placement.serverId),
        })),
        grid_size: ARRANGEMENT_GRID_SIZE,
        column_gap: ARRANGEMENT_COLUMN_GAP,
        item_gap: SERVER_CARD_COLLISION_GAP,
      },
    },
  })
  if (response.result.kind === 'arrangement') {
    return response.result.payload.nodes.map((node) => ({
      serverId: node.item_id,
      x: node.bounds.x,
      y: node.bounds.y,
    }))
  }
  throw new Error(
    response.result.kind === 'error'
      ? response.result.payload.message
      : 'Canvas items could not be arranged.',
  )
}
