import { useMemo, useState, type RefObject } from 'react'
import type { EngineResponse } from '../../shared/engine/protocol.mjs'
import { useDomainEngine } from '@/hooks/use-domain-engine'
import { removeTopologyConnection } from '@/engine/topology'
import {
  findAssignmentById,
  getAssignedComponentConnectionIds,
  tryRemoveAssignedComponent,
} from '@/lib/constraints'
import {
  getReturnCanvasItemImpact,
  returnCanvasItemToInventory,
} from '@/lib/project'
import type { ProjectState } from '@/types/inventory'

type PendingAssignmentRemoval = {
  assignmentId: string | number
  itemName: string
  connectionCount: number
}

type CommitEngineMutation = (
  createMutation: (canonicalProject: ProjectState) => Promise<EngineResponse>,
  options?: { recordHistory?: boolean },
) => Promise<EngineResponse>

type CanvasEquipmentLifecycleOptions = {
  project: ProjectState | null
  projectRef: RefObject<ProjectState | null>
  updateProject(project: ProjectState): void
  commitEngineMutation: CommitEngineMutation
  commitAssignmentUpdate(
    previousProject: ProjectState,
    nextProject: ProjectState,
    fallbackMessage?: string,
    options?: { recordHistory?: boolean },
  ): Promise<boolean>
  recoverMutation(error: unknown, fallbackMessage: string): void
  recordHistorySnapshot(project: ProjectState): void
  clearCanvasSelection(): void
  showMessage(message: string): void
}

export function useCanvasEquipmentLifecycle({
  project,
  projectRef,
  updateProject,
  commitEngineMutation,
  commitAssignmentUpdate,
  recoverMutation,
  recordHistorySnapshot,
  clearCanvasSelection,
  showMessage,
}: CanvasEquipmentLifecycleOptions) {
  const domainEngine = useDomainEngine()
  const [returnToInventoryItemId, setReturnToInventoryItemId] = useState<string | null>(null)
  const [returnToInventoryBusy, setReturnToInventoryBusy] = useState(false)
  const [pendingAssignmentRemoval, setPendingAssignmentRemoval] = useState<PendingAssignmentRemoval | null>(null)

  const returnToInventoryItem = returnToInventoryItemId
    ? project?.items[returnToInventoryItemId] ?? null
    : null
  const returnToInventoryImpact = useMemo(
    () => project && returnToInventoryItemId
      ? getReturnCanvasItemImpact(project, returnToInventoryItemId)
      : null,
    [project, returnToInventoryItemId],
  )

  function requestReturnToInventory(runtimeItemId: string) {
    const currentProject = projectRef.current

    if (!currentProject || !getReturnCanvasItemImpact(currentProject, runtimeItemId)) {
      showMessage('This item is no longer placed on the canvas.')
      return
    }

    setReturnToInventoryItemId(runtimeItemId)
  }

  function dismissReturnToInventory() {
    if (!returnToInventoryBusy) setReturnToInventoryItemId(null)
  }

  function confirmReturnToInventory() {
    const currentProject = projectRef.current
    const runtimeItemId = returnToInventoryItemId

    if (!currentProject || !runtimeItemId) return

    setReturnToInventoryBusy(true)
    const result = returnCanvasItemToInventory(currentProject, runtimeItemId)

    if (!result.ok) {
      setReturnToInventoryBusy(false)
      setReturnToInventoryItemId(null)
      showMessage(result.message)
      return
    }

    updateProject(result.project)
    clearCanvasSelection()
    setReturnToInventoryItemId(null)
    setReturnToInventoryBusy(false)
  }

  async function removeAssignedComponent(assignmentId: string | number) {
    const currentProject = projectRef.current
    if (!currentProject) return

    const result = tryRemoveAssignedComponent(currentProject, assignmentId)
    if (!result.ok) {
      showMessage(result.message)
      return
    }

    const removedConnectionIds = new Set(
      currentProject.connections
        .filter((connection) => !result.project.connections.some((candidate) => candidate.id === connection.id))
        .map((connection) => connection.id),
    )
    if (removedConnectionIds.size > 0) {
      try {
        for (const connectionId of removedConnectionIds) {
          await commitEngineMutation(
            () => removeTopologyConnection(domainEngine.client, connectionId),
          )
        }
      } catch (error) {
        recoverMutation(error, 'The component connections could not be removed.')
        return
      }

      const disconnectedProject = projectRef.current
      if (!disconnectedProject) return
      const disconnectedResult = tryRemoveAssignedComponent(disconnectedProject, assignmentId)
      if (!disconnectedResult.ok) {
        showMessage(disconnectedResult.message)
        return
      }
      if (!await commitAssignmentUpdate(
        disconnectedProject,
        disconnectedResult.project,
        'The component could not be removed.',
        { recordHistory: false },
      )) return
      recordHistorySnapshot(currentProject)
    } else if (!await commitAssignmentUpdate(
      currentProject,
      result.project,
      'The component could not be removed.',
    )) {
      return
    }
    setPendingAssignmentRemoval(null)
  }

  function requestAssignedComponentRemoval(assignmentId: string | number) {
    const currentProject = projectRef.current
    if (!currentProject) return

    const assignment = findAssignmentById(currentProject.assignments, assignmentId)
    if (!assignment) {
      showMessage('That assigned component is no longer attached.')
      return
    }

    const connectionIds = getAssignedComponentConnectionIds(currentProject, assignmentId)
    if (connectionIds.length === 0) {
      void removeAssignedComponent(assignmentId)
      return
    }

    setPendingAssignmentRemoval({
      assignmentId,
      itemName: currentProject.items[assignment.itemId]?.name ?? 'component',
      connectionCount: connectionIds.length,
    })
  }

  return {
    returnToInventoryItemId,
    returnToInventoryItem,
    returnToInventoryImpact,
    returnToInventoryBusy,
    pendingAssignmentRemoval,
    requestReturnToInventory,
    dismissReturnToInventory,
    confirmReturnToInventory,
    requestAssignedComponentRemoval,
    dismissAssignmentRemoval: () => setPendingAssignmentRemoval(null),
    confirmAssignmentRemoval: () => {
      if (pendingAssignmentRemoval) {
        void removeAssignedComponent(pendingAssignmentRemoval.assignmentId)
      }
    },
  }
}
