import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useDomainEngine } from '@/hooks/use-domain-engine'
import { saveProject } from '@/lib/db'
import { ProjectPersistenceCoordinator } from '@/lib/project-persistence-coordinator'
import type { ProjectState } from '@/types/inventory'

const SAVE_DEBOUNCE_MS = 500

type SaveStatus = 'saved' | 'saving' | 'error'

type ProjectSaveQueueOptions = {
  projectRef: RefObject<ProjectState | null>
  setProject(project: ProjectState): void
  setSaveStatus(status: SaveStatus): void
  setPersistenceWarning(message: string | null): void
  setCanonicalMutationBusy(busy: boolean): void
}

export function useProjectSaveQueue({
  projectRef,
  setProject,
  setSaveStatus,
  setPersistenceWarning,
  setCanonicalMutationBusy,
}: ProjectSaveQueueOptions) {
  const queryClient = useQueryClient()
  const domainEngine = useDomainEngine()
  const lastPersistedProjectRef = useRef<ProjectState | null>(null)
  const queuedSaveProjectRef = useRef<{ generation: number; project: ProjectState } | null>(null)
  const pendingAutosaveProjectRef = useRef<ProjectState | null>(null)
  const saveDrainWaitersRef = useRef<Array<{
    resolve: () => void
    reject: (error: Error) => void
  }>>([])
  const saveInFlightRef = useRef(false)
  const saveGenerationRef = useRef(0)
  const saveTimerRef = useRef<number | null>(null)
  const coordinatorRef = useRef<ProjectPersistenceCoordinator | null>(null)
  if (!coordinatorRef.current) {
    coordinatorRef.current = new ProjectPersistenceCoordinator(setCanonicalMutationBusy)
  }

  const { mutateAsync: persistProject } = useMutation({ mutationFn: saveProject })

  const waitForQueuedProjectSaves = useCallback(() => {
    if (!saveInFlightRef.current && !queuedSaveProjectRef.current) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      saveDrainWaitersRef.current.push({ resolve, reject })
    })
  }, [])

  const processQueuedProjectSaves = useCallback(() => {
    if (saveInFlightRef.current) return

    saveInFlightRef.current = true
    void (async () => {
      let drainError: Error | null = null
      try {
        while (queuedSaveProjectRef.current) {
          const queuedSave = queuedSaveProjectRef.current
          queuedSaveProjectRef.current = null

          try {
            const savedProject = await persistProject(queuedSave.project)
            if (queuedSave.generation !== saveGenerationRef.current) continue

            lastPersistedProjectRef.current = savedProject
            if (!queuedSaveProjectRef.current && projectRef.current === queuedSave.project) {
              projectRef.current = savedProject
              queryClient.setQueryData(['project'], savedProject)
              setProject(savedProject)
              setPersistenceWarning(null)
              setSaveStatus('saved')
            }
          } catch (error) {
            if (
              queuedSave.generation !== saveGenerationRef.current
              || queuedSaveProjectRef.current
              || projectRef.current !== queuedSave.project
            ) continue

            const lastPersistedProject = lastPersistedProjectRef.current
            if (lastPersistedProject) {
              projectRef.current = lastPersistedProject
              setProject(lastPersistedProject)
            }

            setSaveStatus('error')
            setPersistenceWarning(
              error instanceof Error ? error.message : 'Project could not be saved to the JSON database.',
            )
            drainError = error instanceof Error
              ? error
              : new Error('Project could not be saved to the JSON database.')
          }
        }
      } finally {
        saveInFlightRef.current = false
        const waiters = saveDrainWaitersRef.current.splice(0)
        for (const waiter of waiters) {
          if (drainError) waiter.reject(drainError)
          else waiter.resolve()
        }
      }
    })()
  }, [persistProject, projectRef, queryClient, setPersistenceWarning, setProject, setSaveStatus])

  const enqueueProjectSave = useCallback((projectToSave: ProjectState) => {
    queuedSaveProjectRef.current = {
      generation: saveGenerationRef.current,
      project: projectToSave,
    }
    processQueuedProjectSaves()
    return waitForQueuedProjectSaves()
  }, [processQueuedProjectSaves, waitForQueuedProjectSaves])

  const settleLegacyProjectPersistence = useCallback(async () => {
    const hadPendingPersistence = Boolean(
      pendingAutosaveProjectRef.current
      || queuedSaveProjectRef.current
      || saveInFlightRef.current,
    )

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }

    const pendingProject = pendingAutosaveProjectRef.current
    pendingAutosaveProjectRef.current = null
    if (pendingProject) await enqueueProjectSave(pendingProject)
    else await waitForQueuedProjectSaves()

    if (!hadPendingPersistence || !domainEngine.enabled) return
    const canonicalProject = lastPersistedProjectRef.current
    if (
      canonicalProject
      && (
        domainEngine.client.status().phase !== 'ready'
        || domainEngine.client.status().revision !== canonicalProject.revision
      )
    ) {
      await domainEngine.client.rebuild('Synchronizing saved project changes.')
    }
  }, [domainEngine, enqueueProjectSave, waitForQueuedProjectSaves])

  const scheduleProjectSave = useCallback((projectToSave: ProjectState) => {
    pendingAutosaveProjectRef.current = projectToSave
    setSaveStatus('saving')
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void coordinatorRef.current!
        .run(settleLegacyProjectPersistence, async () => {})
        .catch(() => {})
    }, SAVE_DEBOUNCE_MS)
  }, [setSaveStatus, settleLegacyProjectPersistence])

  const resetPendingSaves = useCallback(() => {
    saveGenerationRef.current += 1
    queuedSaveProjectRef.current = null
    pendingAutosaveProjectRef.current = null
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
  }, [])

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
  }, [])

  return {
    lastPersistedProjectRef,
    coordinator: coordinatorRef.current,
    scheduleProjectSave,
    settleLegacyProjectPersistence,
    resetPendingSaves,
  }
}
