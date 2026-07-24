import { getConnectionRoute } from '@/lib/cable-routing'
import type { ProjectState } from '@/types/inventory'

export type CanvasHandleIndex = ReadonlyMap<string, ReadonlySet<string>>

function handleSetsEqual(
  first: ReadonlySet<string> | undefined,
  second: ReadonlySet<string> | undefined,
): boolean {
  if (first === second) return true
  if (!first || !second || first.size !== second.size) return false
  return [...first].every((handleId) => second.has(handleId))
}

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

export function getChangedCanvasHandleItemIds(
  previous: CanvasHandleIndex,
  next: CanvasHandleIndex,
): ReadonlySet<string> {
  const itemIds = new Set([...previous.keys(), ...next.keys()])

  return new Set(
    [...itemIds].filter((itemId) => !handleSetsEqual(previous.get(itemId), next.get(itemId))),
  )
}

const EMPTY_HANDLE_SET: ReadonlySet<string> = new Set<string>()
