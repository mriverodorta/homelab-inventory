import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import type { EngineResponse } from '../../shared/engine/protocol.mjs'
import {
  acknowledgeOptimisticAssignments,
  applyAssignmentTransition,
  updateProjectAssignments,
} from '@/engine/assignments'
import { checkProjectGroupMove, checkProjectPlacement } from '@/engine/geometry'
import { updateProjectPlacements } from '@/engine/placements'
import { applyEngineResponsePatch } from '@/engine/project-patches'
import type { useDomainEngine } from '@/hooks/use-domain-engine'
import { loadProject } from '@/lib/db'
import { loadWorkspace } from '@/lib/workbook-api'
import { createEmptyHistory, pushHistory, type HistoryState } from '@/lib/history'
import {
  backfillProjectHistoryMetadata,
  createProjectHistorySnapshot,
  setInventoryMetadataHistoryItem,
  type InventoryMetadataHistoryState,
  type ProjectHistorySnapshot,
} from '@/app/project-history-snapshot'
import type { ProjectPersistenceCoordinator } from '@/lib/project-persistence-coordinator'
import { upsertPlacements } from '@/lib/project'
import { cacheProjectState } from '@/lib/project-query-key'
import type { ProjectState } from '@/types/inventory'
import type { InventoryItemMetadataInput, InventoryMetadataItemRef } from '@/types/inventory-metadata'

const SAVE_DEBOUNCE_MS = 500

type DomainEngine = ReturnType<typeof useDomainEngine>
type SaveStatus = 'saved' | 'saving' | 'error'
type ValidationSeverity = 'error' | 'unknown'

type ProjectCommandsOptions = {
  domainEngine: DomainEngine
  queryClient: QueryClient
  projectRef: MutableRefObject<ProjectState | null>
  inventoryMetadataHistoryRef: MutableRefObject<InventoryMetadataHistoryState>
  lastPersistedProjectRef: MutableRefObject<ProjectState | null>
  persistenceCoordinator: ProjectPersistenceCoordinator
  settleLegacyProjectPersistence(): Promise<void>
  resetPendingSaves(): void
  scheduleProjectSave(project: ProjectState): void
  setProject: Dispatch<SetStateAction<ProjectState | null>>
  setHistory: Dispatch<SetStateAction<HistoryState<ProjectHistorySnapshot>>>
  setSelectedConnectionId: Dispatch<SetStateAction<string | number | null>>
  clearNetworkTrace(): void
  setSaveStatus(status: SaveStatus): void
  setPersistenceWarning(message: string | null): void
  setValidationMessage(message: string | null, severity?: ValidationSeverity): void
}

export function useProjectCommands({
  domainEngine,
  queryClient,
  projectRef,
  inventoryMetadataHistoryRef,
  lastPersistedProjectRef,
  persistenceCoordinator,
  settleLegacyProjectPersistence,
  resetPendingSaves,
  scheduleProjectSave,
  setProject,
  setHistory,
  setSelectedConnectionId,
  clearNetworkTrace,
  setSaveStatus,
  setPersistenceWarning,
  setValidationMessage,
}: ProjectCommandsOptions) {
  const projectNameTimerRef = useRef<number | null>(null)

  async function reloadCurrentProject() {
    const current = projectRef.current
    const projectId = current?.metadata.projectId
    const workspaceId = current?.metadata.workspaceId
    return projectId && workspaceId
      ? loadWorkspace(projectId, workspaceId)
      : loadProject()
  }

  useEffect(() => () => {
    if (projectNameTimerRef.current !== null) {
      window.clearTimeout(projectNameTimerRef.current)
    }
  }, [])

  function updateProject(nextProject: ProjectState, options: { recordHistory?: boolean } = {}) {
    const shouldRecordHistory = options.recordHistory ?? true
    const currentProject = projectRef.current

    if (shouldRecordHistory && currentProject) {
      setHistory((currentHistory) => pushHistory(
        currentHistory,
        createProjectHistorySnapshot(currentProject, inventoryMetadataHistoryRef.current),
      ))
    }

    projectRef.current = nextProject
    setProject(nextProject)

    if (nextProject !== currentProject) scheduleProjectSave(nextProject)
  }

  async function validateCanvasPlacement(
    candidateProject: ProjectState,
    placement: ProjectState['placements'][number],
  ) {
    try {
      return await checkProjectPlacement(domainEngine.client, candidateProject, placement)
    } catch (error) {
      setValidationMessage(
        error instanceof Error ? error.message : 'Canvas placement validation failed.',
      )
      return null
    }
  }

  async function validateCanvasGroupMove(
    candidateProject: ProjectState,
    placements: ProjectState['placements'],
  ) {
    try {
      return await checkProjectGroupMove(domainEngine.client, candidateProject, placements)
    } catch (error) {
      setValidationMessage(
        error instanceof Error ? error.message : 'Canvas placement validation failed.',
      )
      return null
    }
  }

  function updateProjectName(name: string) {
    const currentProject = projectRef.current
    if (!currentProject) return
    if (!domainEngine.enabled) {
      updateProject({
        ...currentProject,
        metadata: { ...currentProject.metadata, name },
      }, { recordHistory: false })
      return
    }

    const optimisticProject = {
      ...currentProject,
      metadata: { ...currentProject.metadata, name },
    }
    projectRef.current = optimisticProject
    setProject(optimisticProject)
    setSaveStatus('saving')
    setPersistenceWarning(null)

    if (projectNameTimerRef.current !== null) {
      window.clearTimeout(projectNameTimerRef.current)
    }
    projectNameTimerRef.current = window.setTimeout(() => {
      projectNameTimerRef.current = null
      void commitEngineMutation(
        () => domainEngine.client.mutate({
          operation: { kind: 'update-project-metadata', payload: { name } },
        }),
        {
          optimisticProject: (canonicalProject) => ({
            ...canonicalProject,
            metadata: { ...canonicalProject.metadata, name },
          }),
        },
      ).catch((error) => {
        const persistedProject = lastPersistedProjectRef.current
        if (persistedProject) {
          projectRef.current = persistedProject
          setProject(persistedProject)
        }
        setSaveStatus('error')
        setPersistenceWarning(
          error instanceof Error ? error.message : 'Project name could not be saved.',
        )
      })
    }, SAVE_DEBOUNCE_MS)
  }

  async function applyInventoryCommandSnapshot(
    nextProject: ProjectState,
    options: {
      historySnapshot?: ProjectState
      metadataChange?: {
        ref: InventoryMetadataItemRef
        before: InventoryItemMetadataInput
        after: InventoryItemMetadataInput
      }
    } = {},
  ) {
    let synchronizedProject = nextProject
    const expectedRevision = nextProject.revision

    if (
      domainEngine.enabled
      && typeof expectedRevision === 'number'
      && Number.isSafeInteger(expectedRevision)
    ) {
      const synchronizedRevision = await domainEngine.client.synchronizeCanonicalRevision(
        expectedRevision,
        'Synchronizing inventory changes.',
      )

      if (synchronizedRevision !== expectedRevision) {
        synchronizedProject = await reloadCurrentProject()
        const latestRevision = synchronizedProject.revision
        if (typeof latestRevision === 'number' && latestRevision !== synchronizedRevision) {
          await domainEngine.client.synchronizeCanonicalRevision(
            latestRevision,
            'Synchronizing concurrent inventory changes.',
          )
        }
      }
    }

    resetPendingSaves()
    projectRef.current = synchronizedProject
    lastPersistedProjectRef.current = synchronizedProject
    cacheProjectState(queryClient, synchronizedProject)
    setProject(synchronizedProject)
    if (options.historySnapshot) {
      const historySnapshot = options.historySnapshot
      const metadataChange = options.metadataChange
      setHistory((currentHistory) => {
        const beforeState = metadataChange
          ? setInventoryMetadataHistoryItem(
              inventoryMetadataHistoryRef.current,
              metadataChange.ref,
              metadataChange.before,
            )
          : inventoryMetadataHistoryRef.current
        const backfilledHistory = metadataChange
          ? backfillProjectHistoryMetadata(
              currentHistory,
              metadataChange.ref,
              metadataChange.before,
            )
          : currentHistory
        return pushHistory(
          backfilledHistory,
          createProjectHistorySnapshot(historySnapshot, beforeState),
        )
      })
      if (metadataChange) {
        inventoryMetadataHistoryRef.current = setInventoryMetadataHistoryItem(
          inventoryMetadataHistoryRef.current,
          metadataChange.ref,
          metadataChange.after,
        )
      }
    } else {
      inventoryMetadataHistoryRef.current = new Map()
      setHistory(createEmptyHistory())
    }
    setSelectedConnectionId(null)
    clearNetworkTrace()
    setValidationMessage(null)
    setPersistenceWarning(null)
    setSaveStatus('saved')
    return synchronizedProject
  }

  function recordInventoryMetadataChange(metadataChange: {
    ref: InventoryMetadataItemRef
    before: InventoryItemMetadataInput
    after: InventoryItemMetadataInput
  }) {
    const currentProject = projectRef.current
    if (!currentProject) return
    setHistory((currentHistory) => {
      const beforeState = setInventoryMetadataHistoryItem(
        inventoryMetadataHistoryRef.current,
        metadataChange.ref,
        metadataChange.before,
      )
      return pushHistory(
        backfillProjectHistoryMetadata(
          currentHistory,
          metadataChange.ref,
          metadataChange.before,
        ),
        createProjectHistorySnapshot(currentProject, beforeState),
      )
    })
    inventoryMetadataHistoryRef.current = setInventoryMetadataHistoryItem(
      inventoryMetadataHistoryRef.current,
      metadataChange.ref,
      metadataChange.after,
    )
    setSaveStatus('saved')
    setPersistenceWarning(null)
  }

  function showCompatibilityUnknownMessage(
    action: 'Assigned' | 'Moved',
    itemName: string,
    unknownFindings: { message: string }[],
  ) {
    const unknownMessage = unknownFindings[0]?.message
    setValidationMessage(
      unknownMessage
        ? `${action} ${itemName}. Compatibility could not be fully verified: ${unknownMessage}`
        : null,
      'unknown',
    )
  }

  async function commitEngineMutation(
    createMutation: (canonicalProject: ProjectState) => Promise<EngineResponse>,
    options: {
      recordHistory?: boolean
      optimisticProject?: (canonicalProject: ProjectState) => ProjectState
      acknowledgeOptimistic?: (
        canonicalProject: ProjectState,
        optimisticProject: ProjectState,
        response: EngineResponse,
      ) => ProjectState
    } = {},
  ): Promise<EngineResponse> {
    if (!domainEngine.enabled) {
      throw new Error('The WebAssembly workspace engine is not available.')
    }

    return persistenceCoordinator.run(settleLegacyProjectPersistence, async () => {
      const canonicalProject = projectRef.current
      if (!canonicalProject) throw new Error('The canonical project is unavailable.')
      const historySnapshot = options.recordHistory ? canonicalProject : null
      const optimisticProject = options.optimisticProject?.(canonicalProject)
      if (optimisticProject) {
        projectRef.current = optimisticProject
        setProject(optimisticProject)
      }

      setSaveStatus('saving')
      setPersistenceWarning(null)
      const response = await createMutation(canonicalProject)
      const activeProject = projectRef.current
      if (!activeProject || response.result.kind !== 'patch') {
        throw new Error(
          response.result.kind === 'error'
            ? response.result.payload.message
            : 'The workspace change was not committed.',
        )
      }

      const committedProject = optimisticProject && options.acknowledgeOptimistic
        ? options.acknowledgeOptimistic(canonicalProject, optimisticProject, response)
        : applyEngineResponsePatch(activeProject, response)
      projectRef.current = committedProject
      lastPersistedProjectRef.current = committedProject
      cacheProjectState(queryClient, committedProject)
      setProject(committedProject)
      if (historySnapshot) {
        setHistory((currentHistory) => pushHistory(
          currentHistory,
          createProjectHistorySnapshot(historySnapshot, inventoryMetadataHistoryRef.current),
        ))
      }
      setSaveStatus('saved')
      setPersistenceWarning(null)
      return response
    })
  }

  async function commitAssignmentUpdate(
    previousProject: ProjectState,
    nextProject: ProjectState,
    fallbackMessage = 'The component assignment could not be saved.',
    options: { recordHistory?: boolean } = {},
  ): Promise<boolean> {
    if (!domainEngine.enabled) {
      setValidationMessage('The WebAssembly workspace engine is not available.')
      return false
    }

    try {
      await commitEngineMutation(
        (canonicalProject) => {
          const transitionedProject = applyAssignmentTransition(
            canonicalProject,
            previousProject,
            nextProject,
          )
          return updateProjectAssignments(
            domainEngine.client,
            canonicalProject,
            transitionedProject,
          ).then((response) => {
            if (!response) throw new Error('Component assignments did not change.')
            return response
          })
        },
        {
          recordHistory: options.recordHistory ?? true,
          optimisticProject: (canonicalProject) => applyAssignmentTransition(
            canonicalProject,
            previousProject,
            nextProject,
          ),
          acknowledgeOptimistic: acknowledgeOptimisticAssignments,
        },
      )
      setValidationMessage(null)
      return true
    } catch (error) {
      recoverConnectionMutation(error, fallbackMessage)
      return false
    }
  }

  function recoverConnectionMutation(error: unknown, fallbackMessage: string) {
    setSaveStatus('error')
    setValidationMessage(error instanceof Error ? error.message : fallbackMessage)
    void loadProject().then(async (canonicalProject) => {
      cacheProjectState(queryClient, canonicalProject)
      await applyInventoryCommandSnapshot(canonicalProject)
    }).catch((reloadError) => {
      setPersistenceWarning(
        reloadError instanceof Error
          ? reloadError.message
          : 'The canonical project could not be reloaded.',
      )
    })
  }

  async function commitPlacementUpdates(
    placements: ProjectState['placements'],
    fallbackMessage = 'Canvas positions could not be saved.',
  ): Promise<boolean> {
    const currentProject = projectRef.current
    if (!currentProject || !domainEngine.enabled) {
      setValidationMessage('The WebAssembly workspace engine is not available.')
      return false
    }

    const currentPlacements = new Map(
      currentProject.placements.map((placement) => [placement.serverId, placement]),
    )
    const changedPlacements = placements.filter((placement) => {
      const current = currentPlacements.get(placement.serverId)
      return !current || current.x !== placement.x || current.y !== placement.y
    })
    if (changedPlacements.length === 0) return true

    try {
      await commitEngineMutation(
        (canonicalProject) => updateProjectPlacements(
          domainEngine.client,
          canonicalProject,
          changedPlacements,
        ).then((response) => {
          if (!response) throw new Error('Canvas positions did not change.')
          return response
        }),
        {
          recordHistory: true,
          optimisticProject: (canonicalProject) => upsertPlacements(
            canonicalProject,
            changedPlacements,
          ),
        },
      )
      setValidationMessage(null)
      return true
    } catch (error) {
      recoverConnectionMutation(error, fallbackMessage)
      return false
    }
  }

  return {
    updateProject,
    validateCanvasPlacement,
    validateCanvasGroupMove,
    updateProjectName,
    applyInventoryCommandSnapshot,
    recordInventoryMetadataChange,
    showCompatibilityUnknownMessage,
    commitEngineMutation,
    commitAssignmentUpdate,
    recoverConnectionMutation,
    commitPlacementUpdates,
  }
}
