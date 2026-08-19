import type { CanvasPlacement, PlacementChange } from '../../shared/engine/protocol.mjs'
import type { DomainEngineClient } from '@/engine/client'
import { toTopologyItemRef } from '@/engine/topology'
import type { ProjectState, ServerPlacement } from '@/types/inventory'

function enginePlacement(project: ProjectState, placement: ServerPlacement): CanvasPlacement {
  return {
    item: toTopologyItemRef(project, placement.serverId),
    x: placement.x,
    y: placement.y,
  }
}

export async function updateProjectPlacements(
  client: DomainEngineClient,
  project: ProjectState,
  placements: ServerPlacement[],
) {
  const current = new Map(project.placements.map((placement) => [placement.serverId, placement]))
  const changes: PlacementChange[] = placements.flatMap((placement) => {
    const previous = current.get(placement.serverId)
    if (previous?.x === placement.x && previous.y === placement.y) return []
    return [{
      previous: previous ? enginePlacement(project, previous) : null,
      next: enginePlacement(project, placement),
    }]
  })
  if (changes.length === 0) return null
  return client.mutate({ operation: { kind: 'update-placements', payload: { changes } } })
}

export async function replaceProjectPlacements(
  client: DomainEngineClient,
  currentProject: ProjectState,
  targetProject: ProjectState,
) {
  const current = new Map(
    currentProject.placements.map((placement) => [placement.serverId, placement]),
  )
  const target = new Map(
    targetProject.placements.map((placement) => [placement.serverId, placement]),
  )
  const itemIds = [...new Set([...current.keys(), ...target.keys()])].sort()
  const changes: PlacementChange[] = itemIds.flatMap((itemId) => {
    const previous = current.get(itemId)
    const next = target.get(itemId)
    if (previous?.x === next?.x && previous?.y === next?.y) return []
    return [{
      previous: previous ? enginePlacement(currentProject, previous) : null,
      next: next ? enginePlacement(targetProject, next) : null,
    }]
  })
  if (changes.length === 0) return null
  return client.mutate({ operation: { kind: 'update-placements', payload: { changes } } })
}
