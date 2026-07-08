import type { ProjectState } from '@/types/inventory'
import { isCanvasItem } from '@/lib/project'

export function getFocusedCableItemIds(
  project: ProjectState,
  selectedItemId: string | null,
  selectedConnectionId: string | number | null,
): string[] {
  const ids = new Set<string>()

  if (selectedConnectionId) {
    const selectedConnection = project.connections.find(
      (connection) => String(connection.id) === String(selectedConnectionId),
    )

    if (selectedConnection) {
      ids.add(selectedConnection.from.itemId)
      ids.add(selectedConnection.to.itemId)
    }
  }

  if (selectedItemId) {
    const selectedItem = project.items[selectedItemId]
    const selectedAssignment = project.assignments.find(
      (assignment) => assignment.itemId === selectedItemId,
    )

    if (isCanvasItem(selectedItem)) {
      ids.add(selectedItemId)
    }

    if (selectedAssignment) {
      ids.add(selectedAssignment.serverId)
    }

    for (const connection of project.connections) {
      if (connection.from.itemId === selectedItemId) {
        ids.add(connection.to.itemId)
      }

      if (connection.to.itemId === selectedItemId) {
        ids.add(connection.from.itemId)
      }
    }
  }

  return [...ids]
}

export function connectionMatchesSelectedItem(
  selectedItemId: string | null,
  fromItemId: string,
  toItemId: string,
): boolean {
  return Boolean(selectedItemId && (fromItemId === selectedItemId || toItemId === selectedItemId))
}
