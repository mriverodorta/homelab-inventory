import { useCallback, useMemo, useState, type RefObject } from 'react'
import type { EngineResponse } from '../../shared/engine/protocol.mjs'
import { useDomainEngine } from '@/hooks/use-domain-engine'
import {
  resetAllTopologyConnectionBends,
  restoreAutomaticTopologyConnectionRoutes,
} from '@/engine/topology'
import { snapProjectItemsToGrid } from '@/engine/geometry'
import {
  clearAllManualConnectionBends,
  countConnectionsWithManualBends,
  countConnectionsWithManualRouteGeometry,
  restoreAllAutomaticConnectionRoutes,
} from '@/lib/connection-route-preferences'
import type { ProjectState } from '@/types/inventory'

type CommitEngineMutation = (
  createMutation: (canonicalProject: ProjectState) => Promise<EngineResponse>,
  options?: {
    recordHistory?: boolean
    optimisticProject?: (canonicalProject: ProjectState) => ProjectState
    acknowledgeOptimistic?: (
      canonicalProject: ProjectState,
      optimisticProject: ProjectState,
      response: EngineResponse,
    ) => ProjectState
  },
) => Promise<EngineResponse>

type CanvasMaintenanceControllerOptions = {
  project: ProjectState | null
  projectRef: RefObject<ProjectState | null>
  snapItemsToGrid: boolean
  commitEngineMutation: CommitEngineMutation
  recoverMutation(error: unknown, fallbackMessage: string): void
  setValidationMessage(message: string | null): void
  setCanvasOperationLabel(label: string | null): void
}

export function useCanvasMaintenanceController({
  project,
  projectRef,
  snapItemsToGrid,
  commitEngineMutation,
  recoverMutation,
  setValidationMessage,
  setCanvasOperationLabel,
}: CanvasMaintenanceControllerOptions) {
  const domainEngine = useDomainEngine()
  const [aligningItemsToGrid, setAligningItemsToGrid] = useState(false)
  const [resettingCableBends, setResettingCableBends] = useState(false)
  const [restoringAutomaticCableRoutes, setRestoringAutomaticCableRoutes] = useState(false)

  const manualCableBendCount = useMemo(
    () => project ? countConnectionsWithManualBends(project) : 0,
    [project],
  )
  const manualCableRouteCount = useMemo(
    () => project ? countConnectionsWithManualRouteGeometry(project) : 0,
    [project],
  )

  const resetAllConnectionBends = useCallback(async () => {
    const currentProject = projectRef.current
    if (!currentProject || countConnectionsWithManualBends(currentProject) === 0) return

    if (!domainEngine.enabled) {
      setValidationMessage('The WebAssembly workspace engine is not available.')
      return
    }

    setResettingCableBends(true)
    try {
      await commitEngineMutation(
        () => resetAllTopologyConnectionBends(domainEngine.client),
        {
          recordHistory: true,
          optimisticProject: clearAllManualConnectionBends,
        },
      )
      setValidationMessage(null)
    } catch (error) {
      recoverMutation(error, 'Saved cable bends could not be reset.')
    } finally {
      setResettingCableBends(false)
    }
  }, [commitEngineMutation, domainEngine, projectRef, recoverMutation, setValidationMessage])

  const alignAllEquipmentToGrid = useCallback(async () => {
    const currentProject = projectRef.current
    if (!currentProject || currentProject.placements.length === 0 || !snapItemsToGrid) return

    if (!domainEngine.enabled) {
      setValidationMessage('The WebAssembly workspace engine is not available.')
      return
    }

    setAligningItemsToGrid(true)
    setCanvasOperationLabel('Aligning equipment to grid')
    try {
      await commitEngineMutation(
        (canonicalProject) => snapProjectItemsToGrid(domainEngine.client, canonicalProject),
        { recordHistory: true },
      )
      setValidationMessage(null)
    } catch (error) {
      recoverMutation(error, 'Canvas equipment could not be aligned to the grid.')
    } finally {
      setAligningItemsToGrid(false)
      setCanvasOperationLabel(null)
    }
  }, [
    commitEngineMutation,
    domainEngine,
    projectRef,
    recoverMutation,
    setCanvasOperationLabel,
    setValidationMessage,
    snapItemsToGrid,
  ])

  const restoreAutomaticConnectionRoutes = useCallback(async () => {
    const currentProject = projectRef.current
    if (!currentProject || countConnectionsWithManualRouteGeometry(currentProject) === 0) return

    if (!domainEngine.enabled) {
      setValidationMessage('The WebAssembly workspace engine is not available.')
      return
    }

    setRestoringAutomaticCableRoutes(true)
    try {
      await commitEngineMutation(
        () => restoreAutomaticTopologyConnectionRoutes(domainEngine.client),
        {
          recordHistory: true,
          optimisticProject: restoreAllAutomaticConnectionRoutes,
        },
      )
      setValidationMessage(null)
    } catch (error) {
      recoverMutation(error, 'Automatic cable routes could not be restored.')
    } finally {
      setRestoringAutomaticCableRoutes(false)
    }
  }, [commitEngineMutation, domainEngine, projectRef, recoverMutation, setValidationMessage])

  return {
    aligningItemsToGrid,
    resettingCableBends,
    restoringAutomaticCableRoutes,
    manualCableBendCount,
    manualCableRouteCount,
    alignAllEquipmentToGrid,
    resetAllConnectionBends,
    restoreAutomaticConnectionRoutes,
  }
}
