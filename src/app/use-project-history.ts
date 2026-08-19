import { useCallback, useRef, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import {
  createEmptyHistory,
  redoHistory,
  undoHistory,
  type HistoryState,
} from '@/lib/history'
import { restoreInventoryItemMetadataHistory } from '@/lib/inventory-metadata-api'
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
  synchronizeCanonicalRevision?: (revision: number) => Promise<number>
}

export function useProjectHistory({
  projectRef,
  inventoryMetadataHistoryRef,
  setProject,
  setSelectedItemId,
  setSelectedConnectionId,
  setValidationMessage,
  scheduleProjectSave: scheduleLegacyProjectSave,
  synchronizeCanonicalRevision,
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
      let canonicalRevision = currentProject.revision
      if (metadataChanges.length > 0) {
        const restored = await restoreInventoryItemMetadataHistory(metadataChanges)
        const projectId = currentProject.metadata.projectId ?? 1
        canonicalRevision = restored.affectedProjectRevisions[String(projectId)] ?? canonicalRevision
        if (synchronizeCanonicalRevision) {
          canonicalRevision = await synchronizeCanonicalRevision(canonicalRevision)
        }
        inventoryMetadataHistoryRef.current = new Map(target.inventoryMetadata)
      }

      const projectChanged = !projectHistoryContentEqual(target.project, currentProject)
      const rebasedProject = projectChanged
        ? { ...target.project, revision: canonicalRevision }
        : { ...currentProject, revision: canonicalRevision }
      projectRef.current = rebasedProject
      setProject(rebasedProject)
      historyRef.current = result.history
      setHistoryState(result.history)

      if (projectChanged) scheduleLegacyProjectSave(rebasedProject)
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
