import { useCallback, useRef, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import {
  createEmptyHistory,
  pushHistory,
  redoHistory,
  undoHistory,
  type HistoryState,
} from '@/lib/history'
import { restoreInventoryItemMetadataHistory } from '@/lib/inventory-metadata-api'
import { updateCompatibilityPolicy } from '@/lib/compatibility-audit-api'
import { compatibilityPolicyOnlyChanged } from '@/lib/compatibility-policy'
import { updateInventoryItem, updateInventoryItemProperties } from '@/lib/db'
import {
  createProjectHistorySnapshot,
  inventoryItemHistoryChanges,
  inventoryItemsOnlyChanged,
  inventoryPropertiesOnlyChanged,
  inventoryPropertyHistoryChanges,
  metadataHistoryChanges,
  placementsOnlyChanged,
  projectHistoryContentEqual,
  type InventoryMetadataHistoryState,
  type ProjectHistorySnapshot,
} from '@/app/project-history-snapshot'
import type { ProjectState } from '@/types/inventory'
import type { DomainMutationResult } from '@/types/domain-mutation'
import type { InventoryItemMetadata, InventoryMetadataItemRef } from '@/types/inventory-metadata'
import type { ProjectWorkbook } from '@/lib/workbook-api'

type ProjectHistoryOptions = {
  projectRef: MutableRefObject<ProjectState | null>
  inventoryMetadataHistoryRef: MutableRefObject<InventoryMetadataHistoryState>
  workbookHistoryRef?: MutableRefObject<ProjectWorkbook | null>
  setProject: Dispatch<SetStateAction<ProjectState | null>>
  setSelectedItemId: Dispatch<SetStateAction<string | null>>
  setSelectedConnectionId: Dispatch<SetStateAction<string | number | null>>
  setValidationMessage: (message: string | null) => void
  scheduleProjectSave: (project: ProjectState) => void
  refreshInventoryMetadata?: (
    projectIds: readonly number[],
    items: readonly Readonly<{ ref: InventoryMetadataItemRef; metadata: InventoryItemMetadata }>[],
  ) => Promise<void>
  applyDomainMutationResult?: (result: DomainMutationResult<ProjectState>) => Promise<ProjectState>
  restoreWorkbookHistory?: (workbook: ProjectWorkbook) => Promise<ProjectWorkbook>
  restorePlacementHistory?: (project: ProjectState) => Promise<ProjectState>
}

export function useProjectHistory({
  projectRef,
  inventoryMetadataHistoryRef,
  workbookHistoryRef,
  setProject,
  setSelectedItemId,
  setSelectedConnectionId,
  setValidationMessage,
  scheduleProjectSave: scheduleLegacyProjectSave,
  refreshInventoryMetadata,
  applyDomainMutationResult,
  restoreWorkbookHistory,
  restorePlacementHistory,
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
      workbookHistoryRef?.current ?? null,
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
        await refreshInventoryMetadata?.(
          restored.affectedProjectIds,
          metadataChanges.map((change, index) => ({
            ref: change.ref,
            metadata: restored.items[index].metadata,
          })),
        )
      }

      const projectChanged = !projectHistoryContentEqual(target.project, currentProject)
      const workbookChanged = target.workbook !== null
        && JSON.stringify(target.workbook) !== JSON.stringify(workbookHistoryRef?.current ?? null)
      const policyOnlyChanged = projectChanged
        && compatibilityPolicyOnlyChanged(currentProject, target.project)
      const propertiesOnlyChanged = projectChanged
        && inventoryPropertiesOnlyChanged(currentProject, target.project)
      const inventoryOnlyChanged = projectChanged
        && inventoryItemsOnlyChanged(currentProject, target.project)
      const placementOnlyChanged = projectChanged
        && placementsOnlyChanged(currentProject, target.project)
      const policyResult = policyOnlyChanged
        ? await updateCompatibilityPolicy(
            currentProject.metadata.projectId ?? 1,
            target.project.compatibilityPolicy,
          )
        : null
      let propertyProject: ProjectState | null = null
      if (propertiesOnlyChanged) {
        const scope = currentProject.metadata.projectId && currentProject.metadata.workspaceId
          ? {
              projectId: currentProject.metadata.projectId,
              workspaceId: currentProject.metadata.workspaceId,
            }
          : null
        for (const change of inventoryPropertyHistoryChanges(currentProject, target.project)) {
          const result = await updateInventoryItemProperties(change.ref, change.properties, scope)
          propertyProject = applyDomainMutationResult
            ? await applyDomainMutationResult(result)
            : result.data
        }
      }
      let inventoryProject: ProjectState | null = null
      if (inventoryOnlyChanged && !propertiesOnlyChanged) {
        const scope = currentProject.metadata.projectId && currentProject.metadata.workspaceId
          ? {
              projectId: currentProject.metadata.projectId,
              workspaceId: currentProject.metadata.workspaceId,
            }
          : null
        for (const targetItem of inventoryItemHistoryChanges(currentProject, target.project)) {
          const { id, key: _key, ...input } = targetItem
          const result = await updateInventoryItem({ type: targetItem.type, id }, input, scope)
          inventoryProject = applyDomainMutationResult
            ? await applyDomainMutationResult(result)
            : result.data
        }
      }
      const placementProject = placementOnlyChanged && restorePlacementHistory
        ? await restorePlacementHistory(target.project)
        : null
      let rebasedProject = currentProject
      if (policyResult) {
        rebasedProject = { ...currentProject, compatibilityPolicy: policyResult.policy }
      } else if (propertyProject) {
        rebasedProject = propertyProject
      } else if (inventoryProject) {
        rebasedProject = inventoryProject
      } else if (placementProject) {
        rebasedProject = placementProject
      } else if (projectChanged) {
        rebasedProject = { ...target.project, revision: currentProject.revision }
      }
      const restoredWorkbook = workbookChanged && target.workbook && restoreWorkbookHistory
        ? await restoreWorkbookHistory(target.workbook)
        : null
      if (restoredWorkbook && workbookHistoryRef) {
        workbookHistoryRef.current = restoredWorkbook
      }
      const finalProject = restoredWorkbook
        ? {
            ...rebasedProject,
            metadata: {
              ...rebasedProject.metadata,
              name: restoredWorkbook.project.name,
            },
          }
        : rebasedProject
      projectRef.current = finalProject
      setProject(finalProject)
      historyRef.current = result.history
      setHistoryState(result.history)

      if (
        projectChanged
        && !workbookChanged
        && !policyOnlyChanged
        && !propertiesOnlyChanged
        && !inventoryOnlyChanged
        && !placementProject
      ) {
        scheduleLegacyProjectSave(rebasedProject)
      }
      setSelectedItemId((current) => (current && finalProject.items[current] ? current : null))
      setSelectedConnectionId((current) =>
        current && finalProject.connections.some((connection) => connection.id === current)
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
    recordWorkbookChange: (before: ProjectWorkbook, after: ProjectWorkbook) => {
      const currentProject = projectRef.current
      if (!currentProject || JSON.stringify(before) === JSON.stringify(after)) return
      setHistory((currentHistory) => pushHistory(
        currentHistory,
        createProjectHistorySnapshot(
          currentProject,
          inventoryMetadataHistoryRef.current,
          before,
        ),
      ))
      if (workbookHistoryRef) workbookHistoryRef.current = after
      if (before.project.name !== after.project.name) {
        const updatedProject = {
          ...currentProject,
          metadata: { ...currentProject.metadata, name: after.project.name },
        }
        projectRef.current = updatedProject
        setProject(updatedProject)
      }
    },
  }
}
