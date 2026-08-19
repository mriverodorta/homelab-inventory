import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { applyEngineResponsePatch } from '@/engine/project-patches'
import type { useDomainEngine } from '@/hooks/use-domain-engine'
import { createEmptyHistory, type HistoryState } from '@/lib/history'
import type {
  InventoryMetadataHistoryState,
  ProjectHistorySnapshot,
} from '@/app/project-history-snapshot'
import type { ProjectState } from '@/types/inventory'

type DomainEngine = ReturnType<typeof useDomainEngine>

type ProjectHydrationOptions = {
  loadedProject: ProjectState | undefined
  project: ProjectState | null
  projectRef: MutableRefObject<ProjectState | null>
  inventoryMetadataHistoryRef: MutableRefObject<InventoryMetadataHistoryState>
  lastPersistedProjectRef: MutableRefObject<ProjectState | null>
  hasHydratedProjectRef: MutableRefObject<boolean>
  domainEngine: DomainEngine
  queryClient: QueryClient
  setProject: Dispatch<SetStateAction<ProjectState | null>>
  setHistory: Dispatch<SetStateAction<HistoryState<ProjectHistorySnapshot>>>
  setSelectedItemId: Dispatch<SetStateAction<string | null>>
  setSelectedConnectionId: Dispatch<SetStateAction<string | number | null>>
  clearPendingConnection(): void
  clearNetworkTrace(): void
  setPersistenceWarning(message: string | null): void
  setSaveStatus(status: 'saved' | 'saving' | 'error'): void
  applyInventorySnapshot(project: ProjectState): Promise<ProjectState>
  reloadProject(): Promise<ProjectState>
  queryKey: readonly unknown[]
}

export function useProjectHydration({
  loadedProject,
  project,
  projectRef,
  inventoryMetadataHistoryRef,
  lastPersistedProjectRef,
  hasHydratedProjectRef,
  domainEngine,
  queryClient,
  setProject,
  setHistory,
  setSelectedItemId,
  setSelectedConnectionId,
  clearPendingConnection,
  clearNetworkTrace,
  setPersistenceWarning,
  setSaveStatus,
  applyInventorySnapshot,
  reloadProject,
  queryKey,
}: ProjectHydrationOptions) {
  const handledSyncSequenceRef = useRef(0)
  const callbacksRef = useRef({
    clearPendingConnection,
    clearNetworkTrace,
    applyInventorySnapshot,
    reloadProject,
  })
  callbacksRef.current = {
    clearPendingConnection,
    clearNetworkTrace,
    applyInventorySnapshot,
    reloadProject,
  }

  useEffect(() => {
    if (!loadedProject || hasHydratedProjectRef.current) return

    hasHydratedProjectRef.current = true
    projectRef.current = loadedProject
    lastPersistedProjectRef.current = loadedProject
    setProject(loadedProject)
    inventoryMetadataHistoryRef.current = new Map()
    setHistory(createEmptyHistory())
    setSelectedItemId((current) => (current && loadedProject.items[current] ? current : null))
    setSelectedConnectionId((current) => (
      current && loadedProject.connections.some((connection) => connection.id === current)
        ? current
        : null
    ))
    callbacksRef.current.clearPendingConnection()
    callbacksRef.current.clearNetworkTrace()
    setPersistenceWarning(null)
    setSaveStatus('saved')
  }, [
    hasHydratedProjectRef,
    inventoryMetadataHistoryRef,
    lastPersistedProjectRef,
    loadedProject,
    projectRef,
    setHistory,
    setPersistenceWarning,
    setProject,
    setSaveStatus,
    setSelectedConnectionId,
    setSelectedItemId,
  ])

  useEffect(() => {
    projectRef.current = project
  }, [project, projectRef])

  useEffect(() => {
    const event = domainEngine.syncEvent
    if (!domainEngine.enabled || !event || !hasHydratedProjectRef.current) return
    if (event.sequence <= handledSyncSequenceRef.current) return
    handledSyncSequenceRef.current = event.sequence

    if (event.kind === 'patch') {
      if (!event.external || !projectRef.current) return
      const nextProject = applyEngineResponsePatch(projectRef.current, event.response)
      projectRef.current = nextProject
      lastPersistedProjectRef.current = nextProject
      setProject(nextProject)
      inventoryMetadataHistoryRef.current = new Map()
      setHistory(createEmptyHistory())
      setPersistenceWarning(null)
      setSaveStatus('saved')
      return
    }

    void callbacksRef.current.reloadProject()
      .then(async (canonicalProject) => {
        const activeProject = projectRef.current
        const canonicalRevision = canonicalProject.revision
        const activeRevision = activeProject?.revision
        if (
          typeof canonicalRevision === 'number'
          && typeof activeRevision === 'number'
          && canonicalRevision < activeRevision
        ) return
        queryClient.setQueryData(queryKey, canonicalProject)
        await callbacksRef.current.applyInventorySnapshot(canonicalProject)
      })
      .catch((error) => {
        setPersistenceWarning(
          error instanceof Error ? error.message : 'Canonical project reload failed.',
        )
      })
  }, [
    domainEngine.enabled,
    domainEngine.syncEvent,
    hasHydratedProjectRef,
    inventoryMetadataHistoryRef,
    lastPersistedProjectRef,
    projectRef,
    queryClient,
    queryKey,
    setHistory,
    setPersistenceWarning,
    setProject,
    setSaveStatus,
  ])
}
