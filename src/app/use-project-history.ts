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
import { updateInventoryItem, updateInventoryItemProperties } from '@/lib/db'
import {
  createProjectHistorySnapshot,
  inventoryItemHistoryChanges,
  inventoryItemsOnlyChanged,
  inventoryPropertiesOnlyChanged,
  inventoryPropertyHistoryChanges,
  metadataHistoryChanges,
  projectHistoryContentEqual,
  type InventoryMetadataHistoryState,
  type ProjectHistorySnapshot,
} from '@/app/project-history-snapshot'
import type { ProjectState } from '@/types/inventory'
import type { DomainMutationResult } from '@/types/domain-mutation'
import type { InventoryItemMetadata, InventoryMetadataItemRef } from '@/types/inventory-metadata'

type ProjectHistoryOptions = {
  projectRef: MutableRefObject<ProjectState | null>
  inventoryMetadataHistoryRef: MutableRefObject<InventoryMetadataHistoryState>
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
  applyDomainMutationResult,
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
        await refreshInventoryMetadata?.(
          restored.affectedProjectIds,
          metadataChanges.map((change, index) => ({
            ref: change.ref,
            metadata: restored.items[index].metadata,
          })),
        )
      }

      const projectChanged = !projectHistoryContentEqual(target.project, currentProject)
      const policyOnlyChanged = projectChanged
        && compatibilityPolicyOnlyChanged(currentProject, target.project)
      const propertiesOnlyChanged = projectChanged
        && inventoryPropertiesOnlyChanged(currentProject, target.project)
      const inventoryOnlyChanged = projectChanged
        && inventoryItemsOnlyChanged(currentProject, target.project)
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
      const rebasedProject = policyResult
        ? { ...currentProject, compatibilityPolicy: policyResult.policy }
        : propertyProject
          ? propertyProject
          : inventoryProject
            ? inventoryProject
        : projectChanged
          ? target.project
          : currentProject
      projectRef.current = rebasedProject
      setProject(rebasedProject)
      historyRef.current = result.history
      setHistoryState(result.history)

      if (
        projectChanged
        && !policyOnlyChanged
        && !propertiesOnlyChanged
        && !inventoryOnlyChanged
      ) {
        scheduleLegacyProjectSave(rebasedProject)
      }
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
