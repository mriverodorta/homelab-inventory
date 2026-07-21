import { getConnectionRoute } from '@/lib/cable-routing'
import type { ProjectState } from '@/types/inventory'

export type CanvasHandleIndex = ReadonlyMap<string, ReadonlySet<string>>

export function buildCanvasHandleIndex(project: ProjectState): CanvasHandleIndex {
  const mutableIndex = new Map<string, Set<string>>()

  const add = (itemId: string, handleId: string) => {
    const handles = mutableIndex.get(itemId) ?? new Set<string>()
    handles.add(handleId)
    mutableIndex.set(itemId, handles)
  }

  for (const [connectionIndex, connection] of (project.connections ?? []).entries()) {
    const route = getConnectionRoute(project, connection, connectionIndex)
    if (!route) continue

    add(connection.from.itemId, route.sourceHandle)
    add(connection.to.itemId, route.targetHandle)
  }

  return mutableIndex
}

export function getRequiredCanvasHandles(
  index: CanvasHandleIndex,
  itemId: string,
): ReadonlySet<string> {
  return index.get(itemId) ?? EMPTY_HANDLE_SET
}

const EMPTY_HANDLE_SET: ReadonlySet<string> = new Set<string>()
