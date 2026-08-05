import { useEffect, useRef, useState, type RefObject } from 'react'
import type { EngineResponse } from '../../shared/engine/protocol.mjs'
import { useDomainEngine } from '@/hooks/use-domain-engine'
import {
  canonicalizeTopologyConnectionRoutes,
  createTopologyConnection,
  removeTopologyConnection,
  resolveTopologyConnectionRouteSides,
  updateTopologyConnectionLabel,
  updateTopologyConnectionRoute,
} from '@/engine/topology'
import type { CableRouteCanonicalRepair } from '@/lib/cable-routing-coordinator'
import { resolveCreatedConnectionSelection } from '@/lib/created-connection-selection'
import { endpointKey } from '@/lib/project'
import { addedConnectionId } from '@/app/project-drop-helpers'
import type { CanvasPortDragPoint } from '@/types/canvas'
import type {
  ConnectionEndpoint,
  ConnectionRoutePreferences,
  ConnectionRouteSide,
  ProjectState,
} from '@/types/inventory'
import type { PortConnectionPreview } from '@/app/port-connection-preview-overlay'

const SAVE_DEBOUNCE_MS = 500

type CommitEngineMutation = (
  createMutation: (canonicalProject: ProjectState) => Promise<EngineResponse>,
  options?: {
    recordHistory?: boolean
    optimisticProject?: (canonicalProject: ProjectState) => ProjectState
  },
) => Promise<EngineResponse>

type ConnectionControllerOptions = {
  projectRef: RefObject<ProjectState | null>
  selectedItemId: string | null
  selectedConnectionId: string | number | null
  activeNetworkTraceEndpoint: ConnectionEndpoint | null
  openCreatedConnectionInspector: boolean
  setSelectedItemId(value: string | null): void
  setSelectedConnectionId(value: string | number | null): void
  setActiveNetworkTraceEndpoint(value: ConnectionEndpoint | null): void
  setProject(project: ProjectState): void
  setSaveStatus(value: 'saved' | 'saving' | 'error'): void
  setValidationMessage(message: string | null, severity?: 'error' | 'unknown'): void
  commitEngineMutation: CommitEngineMutation
  recoverMutation(error: unknown, fallbackMessage: string): void
}

export function useConnectionController({
  projectRef,
  selectedItemId,
  selectedConnectionId,
  activeNetworkTraceEndpoint,
  openCreatedConnectionInspector,
  setSelectedItemId,
  setSelectedConnectionId,
  setActiveNetworkTraceEndpoint,
  setProject,
  setSaveStatus,
  setValidationMessage,
  commitEngineMutation,
  recoverMutation,
}: ConnectionControllerOptions) {
  const domainEngine = useDomainEngine()
  const [pendingConnectionEndpoint, setPendingConnectionEndpoint] = useState<ConnectionEndpoint | null>(null)
  const [portConnectionPreview, setPortConnectionPreview] = useState<PortConnectionPreview | null>(null)
  const connectionLabelTimerRef = useRef<number | null>(null)
  const routeSideResolutionInFlightRef = useRef(false)
  const routeCanonicalizationInFlightRef = useRef(false)

  useEffect(() => () => {
    if (connectionLabelTimerRef.current !== null) {
      window.clearTimeout(connectionLabelTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!portConnectionPreview) return

    const handlePointerUp = () => {
      setPortConnectionPreview((current) => {
        if (current?.mode === 'drag') {
          setPendingConnectionEndpoint(null)
          return null
        }

        return current
      })
    }

    window.addEventListener('pointerup', handlePointerUp)
    return () => window.removeEventListener('pointerup', handlePointerUp)
  }, [portConnectionPreview])

  function clearPendingConnection() {
    setPendingConnectionEndpoint(null)
    setPortConnectionPreview(null)
  }

  function applyCreatedConnectionSelection(connectionId: string | number) {
    const currentSelection = {
      selectedItemId,
      selectedConnectionId,
      activeNetworkTraceEndpoint,
    }
    const nextSelection = resolveCreatedConnectionSelection(
      currentSelection,
      connectionId,
      openCreatedConnectionInspector,
    )

    if (nextSelection === currentSelection) return

    setSelectedItemId(nextSelection.selectedItemId)
    setSelectedConnectionId(nextSelection.selectedConnectionId)
    setActiveNetworkTraceEndpoint(nextSelection.activeNetworkTraceEndpoint)
  }

  function createConnectionBetween(from: ConnectionEndpoint, to: ConnectionEndpoint) {
    if (!projectRef.current) return
    if (!domainEngine.enabled) {
      setValidationMessage('The WebAssembly workspace engine is not available.')
      return
    }

    void commitEngineMutation(
      (canonicalProject) => createTopologyConnection(domainEngine.client, canonicalProject, from, to),
      { recordHistory: true },
    ).then((response) => {
      if (response.result.kind !== 'patch') {
        throw new Error('The connection change returned an unexpected patch.')
      }
      const connectionId = addedConnectionId(response.result.payload.forward)
      if (connectionId === null) {
        throw new Error('The connection change did not include the created connection.')
      }
      applyCreatedConnectionSelection(connectionId)
      clearPendingConnection()
      setValidationMessage(null)
    }).catch((error) => {
      setSaveStatus('error')
      setValidationMessage(error instanceof Error ? error.message : 'The connection could not be created.')
    })
  }

  function updateConnectionRoute(
    connectionId: string | number,
    route: ConnectionRoutePreferences,
  ) {
    const currentProject = projectRef.current
    const numericConnectionId = Number(connectionId)
    if (!currentProject || !Number.isSafeInteger(numericConnectionId) || numericConnectionId <= 0) {
      setValidationMessage('The selected connection is no longer valid.')
      return
    }
    if (!domainEngine.enabled) {
      setValidationMessage('The WebAssembly workspace engine is not available.')
      return
    }

    void commitEngineMutation(
      () => updateTopologyConnectionRoute(domainEngine.client, numericConnectionId, route),
      {
        recordHistory: true,
        optimisticProject: (canonicalProject) => ({
          ...canonicalProject,
          connections: canonicalProject.connections.map((connection) =>
            connection.id === numericConnectionId ? { ...connection, route } : connection,
          ),
        }),
      },
    ).then(() => {
      setValidationMessage(null)
    }).catch((error) => {
      recoverMutation(error, 'The cable route could not be updated.')
    })
  }

  async function resolveConnectionRouteSides(changes: Array<{
    connectionId: number
    sourceSide: ConnectionRouteSide
    targetSide: ConnectionRouteSide
  }>) {
    const currentProject = projectRef.current
    if (!currentProject || routeSideResolutionInFlightRef.current) return
    if (!domainEngine.enabled) throw new Error('The WebAssembly workspace engine is not available.')

    const unresolved = changes.filter((change) => {
      const connection = currentProject.connections.find(
        (candidate) => candidate.id === change.connectionId,
      )
      return connection && (!connection.route?.sourceSide || !connection.route?.targetSide)
    })
    if (unresolved.length === 0) return

    routeSideResolutionInFlightRef.current = true
    try {
      await commitEngineMutation(
        () => resolveTopologyConnectionRouteSides(domainEngine.client, unresolved),
        {
          recordHistory: false,
          optimisticProject: (canonicalProject) => ({
            ...canonicalProject,
            connections: canonicalProject.connections.map((connection) => {
              const resolution = unresolved.find(
                (change) => change.connectionId === connection.id,
              )
              if (!resolution) return connection
              return {
                ...connection,
                route: {
                  ...connection.route,
                  sourceSide: connection.route?.sourceSide ?? resolution.sourceSide,
                  targetSide: connection.route?.targetSide ?? resolution.targetSide,
                },
              }
            }),
          }),
        },
      )
      setValidationMessage(null)
    } catch (error) {
      recoverMutation(error, 'Cable endpoint sides could not be saved.')
      throw error
    } finally {
      routeSideResolutionInFlightRef.current = false
    }
  }

  async function canonicalizeConnectionRoutes(changes: CableRouteCanonicalRepair[]) {
    const currentProject = projectRef.current
    if (!currentProject || routeCanonicalizationInFlightRef.current) return
    if (!domainEngine.enabled) throw new Error('The WebAssembly workspace engine is not available.')

    const currentRepairs = changes.filter((change) => {
      const connection = currentProject.connections.find(
        (candidate) => candidate.id === change.connectionId,
      )
      return connection && pointsEqual(
        connection.route?.bendPoints ?? [],
        change.originalBendPoints,
      )
    })
    if (currentRepairs.length === 0) return

    routeCanonicalizationInFlightRef.current = true
    try {
      await commitEngineMutation(
        () => canonicalizeTopologyConnectionRoutes(domainEngine.client, currentRepairs),
        { recordHistory: true },
      )
      setValidationMessage(
        `Corrected invalid terminal bends on ${currentRepairs.length} cable${currentRepairs.length === 1 ? '' : 's'}. Undo is available.`,
        'unknown',
      )
    } catch (error) {
      recoverMutation(error, 'Invalid cable bends could not be corrected.')
      throw error
    } finally {
      routeCanonicalizationInFlightRef.current = false
    }
  }

  function updateConnectionLabel(connectionId: string | number, label: string) {
    const currentProject = projectRef.current
    const numericConnectionId = Number(connectionId)
    if (!currentProject || !Number.isSafeInteger(numericConnectionId) || numericConnectionId <= 0) return
    if (!domainEngine.enabled) {
      setValidationMessage('The WebAssembly workspace engine is not available.')
      return
    }

    const optimisticProject: ProjectState = {
      ...currentProject,
      connections: currentProject.connections.map((connection) =>
        connection.id === numericConnectionId ? { ...connection, label } : connection,
      ),
    }
    projectRef.current = optimisticProject
    setProject(optimisticProject)
    setSaveStatus('saving')
    if (connectionLabelTimerRef.current !== null) {
      window.clearTimeout(connectionLabelTimerRef.current)
    }
    connectionLabelTimerRef.current = window.setTimeout(() => {
      connectionLabelTimerRef.current = null
      void commitEngineMutation(
        () => updateTopologyConnectionLabel(domainEngine.client, numericConnectionId, label),
        {
          optimisticProject: (canonicalProject) => ({
            ...canonicalProject,
            connections: canonicalProject.connections.map((connection) =>
              connection.id === numericConnectionId ? { ...connection, label } : connection,
            ),
          }),
        },
      ).then(() => {
        setValidationMessage(null)
      }).catch((error) => {
        recoverMutation(error, 'The cable label could not be updated.')
      })
    }, SAVE_DEBOUNCE_MS)
  }

  function removeConnection(connectionId: string | number) {
    const currentProject = projectRef.current
    const numericConnectionId = Number(connectionId)
    if (!currentProject || !Number.isSafeInteger(numericConnectionId) || numericConnectionId <= 0) {
      setValidationMessage('The selected connection is no longer valid.')
      return
    }
    if (!domainEngine.enabled) {
      setValidationMessage('The WebAssembly workspace engine is not available.')
      return
    }

    if (connectionLabelTimerRef.current !== null) {
      window.clearTimeout(connectionLabelTimerRef.current)
      connectionLabelTimerRef.current = null
    }
    void commitEngineMutation(
      () => removeTopologyConnection(domainEngine.client, numericConnectionId),
      { recordHistory: true },
    ).then(() => {
      if (Number(selectedConnectionId) === numericConnectionId) {
        setSelectedConnectionId(null)
      }
      setValidationMessage(null)
    }).catch((error) => {
      recoverMutation(error, 'The connection could not be removed.')
    })
  }

  function handleCanvasEndpointClick(endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) {
    void point

    if (pendingConnectionEndpoint && endpointKey(pendingConnectionEndpoint) === endpointKey(endpoint)) {
      clearPendingConnection()
      setValidationMessage(null)
      return
    }

    setPendingConnectionEndpoint(endpoint)
    setPortConnectionPreview(null)
    setSelectedConnectionId(null)
    setValidationMessage(null)
  }

  function handleCanvasEndpointDragStart(endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) {
    setPendingConnectionEndpoint(endpoint)
    setPortConnectionPreview({ from: endpoint, origin: point, pointer: point, mode: 'drag' })
    setSelectedConnectionId(null)
    setValidationMessage(null)
  }

  function handleCanvasEndpointDrop(endpoint: ConnectionEndpoint) {
    const sourceEndpoint = portConnectionPreview?.from ?? pendingConnectionEndpoint
    if (sourceEndpoint) createConnectionBetween(sourceEndpoint, endpoint)
  }

  function handleEndpointConnectionClick(endpoint: ConnectionEndpoint) {
    if (!projectRef.current) return

    if (!pendingConnectionEndpoint) {
      setPendingConnectionEndpoint(endpoint)
      setSelectedConnectionId(null)
      setValidationMessage(null)
      return
    }

    if (endpointKey(pendingConnectionEndpoint) === endpointKey(endpoint)) {
      clearPendingConnection()
      setValidationMessage(null)
      return
    }

    createConnectionBetween(pendingConnectionEndpoint, endpoint)
  }

  return {
    pendingConnectionEndpoint,
    portConnectionPreview,
    setPendingConnectionEndpoint,
    setPortConnectionPreview,
    clearPendingConnection,
    createConnectionBetween,
    updateConnectionRoute,
    resolveConnectionRouteSides,
    canonicalizeConnectionRoutes,
    updateConnectionLabel,
    removeConnection,
    handleCanvasEndpointClick,
    handleCanvasEndpointDragStart,
    handleCanvasEndpointDrop,
    handleEndpointConnectionClick,
  }
}

function pointsEqual(
  left: readonly { x: number; y: number }[],
  right: readonly { x: number; y: number }[],
) {
  return left.length === right.length && left.every(
    (point, index) => point.x === right[index]?.x && point.y === right[index]?.y,
  )
}
