import { useCallback, useRef, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import {
  createEmptyHistory,
  redoHistory,
  undoHistory,
  type HistoryState,
} from '@/lib/history'
import { restoreInventoryItemMetadataHistory } from '@/lib/inventory-metadata-api'
import { updateCompatibilityPolicy } from '@/lib/compatibility-audit-api'
import { compatibilityPolicyOnlyChanged } from '@/lib/compatibility-policy'
import {
  createProjectHistorySnapshot,
  metadataHistoryChanges,
  projectHistoryContentEqual,
  type InventoryMetadataHistoryState,
  type ProjectHistorySnapshot,
} from '@/app/project-history-snapshot'
import type { ProjectState } from '@/types/inventory'

type ProjectHistoryOptions = {
  projectRef: MutableRefObject<ProjectState | null>
  inventoryMetadataHistoryRef: MutableRefObject<InventoryMetadataHistoryState>
  setProject: Dispatch<SetStateAction<ProjectState | null>>
  setSelectedItemId: Dispatch<SetStateAction<string | null>>
  setSelectedConnectionId: Dispatch<SetStateAction<string | number | null>>
  setValidationMessage: (message: string | null) => void
  scheduleProjectSave: (project: ProjectState) => void
  refreshInventoryMetadata?: (projectIds: readonly number[]) => Promise<void>
}

export function useProjectHistory({
  projectRef,
  inventoryMetadataHistoryRef,
  setProject,
  setSelectedItemId,
  setSelectedConnectionId,
  setValidationMessage,
  scheduleProjectSave: scheduleLegacyProjectSave,
  refreshInventoryMetadata,
}: ProjectHistoryOptions) {
  const [history, setHistoryState] = useState<HistoryState<ProjectHistorySnapshot>>(() => createEmptyHistory())
  const [historyBusy, setHistoryBusy] = useState(false)
  const historyRef = useRef(history)
  const busyRef = useRef(false)
  historyRef.current = history

  const setHistory: Dispatch<SetStateAction<HistoryState<ProjectHistorySnapshot>>> = useCallback((value) => {
    setHistoryState((current) => {
      const next = typeof value === 'function' ? value(current) : value
      historyRef.current = next
      return next
    })
  }, [])

  async function applyHistory(direction: 'undo' | 'redo') {
    if (busyRef.current) return
    const currentProject = projectRef.current
    if (!currentProject) return
    const currentSnapshot = createProjectHistorySnapshot(
      currentProject,
      inventoryMetadataHistoryRef.current,
    )
    const result = direction === 'undo'
      ? undoHistory(historyRef.current, currentSnapshot)
      : redoHistory(historyRef.current, currentSnapshot)
    if (!result) return

    busyRef.current = true
    setHistoryBusy(true)
    try {
      const target = result.project
      const metadataChanges = metadataHistoryChanges(
        inventoryMetadataHistoryRef.current,
        target.inventoryMetadata,
      )
      if (metadataChanges.length > 0) {
        const restored = await restoreInventoryItemMetadataHistory(metadataChanges)
        inventoryMetadataHistoryRef.current = new Map(target.inventoryMetadata)
        await refreshInventoryMetadata?.(restored.affectedProjectIds)
      }

      const projectChanged = !projectHistoryContentEqual(target.project, currentProject)
      const policyOnlyChanged = projectChanged
        && compatibilityPolicyOnlyChanged(currentProject, target.project)
      const policyResult = policyOnlyChanged
        ? await updateCompatibilityPolicy(
            currentProject.metadata.projectId ?? 1,
            target.project.compatibilityPolicy,
          )
        : null
      const rebasedProject = policyResult
        ? { ...currentProject, compatibilityPolicy: policyResult.policy }
        : projectChanged
          ? target.project
          : currentProject
      projectRef.current = rebasedProject
      setProject(rebasedProject)
      historyRef.current = result.history
      setHistoryState(result.history)

      if (projectChanged && !policyOnlyChanged) scheduleLegacyProjectSave(rebasedProject)
      setSelectedItemId((current) => (current && rebasedProject.items[current] ? current : null))
      setSelectedConnectionId((current) =>
        current && rebasedProject.connections.some((connection) => connection.id === current)
          ? current
          : null,
      )
      setValidationMessage(null)
    } catch (error) {
      setValidationMessage(
        error instanceof Error ? error.message : 'The history change could not be restored.',
      )
    } finally {
      busyRef.current = false
      setHistoryBusy(false)
    }
  }

  return {
    history,
    historyBusy,
    setHistory,
    undoProjectChange: () => { void applyHistory('undo') },
    redoProjectChange: () => { void applyHistory('redo') },
  }
}
