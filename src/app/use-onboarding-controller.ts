import { useEffect, useMemo, useState, type MutableRefObject } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CanvasController } from '@/components/workbench-canvas-contract'
import { isCanvasEquipmentType } from '@/lib/inventory-capabilities'
import {
  dismissOnboarding,
  finishOnboardingExample,
  loadOnboardingExample,
  loadOnboardingRemovalImpact,
  loadOnboardingStatus,
  ONBOARDING_QUERY_KEY,
  restartOnboarding,
  saveOnboardingWalkthroughStep,
  startOnboardingEmpty,
  type OnboardingStatus,
} from '@/lib/onboarding-api'
import type { ProjectState } from '@/types/inventory'

type EnabledOnboardingStatus = Extract<OnboardingStatus, { enabled: true }>

type UseOnboardingControllerOptions = {
  project: ProjectState | null
  selectedItemId: string | null
  selectedConnectionId: string | number | null
  demoSessionReady: boolean
  demoDialogState: string
  enginePhase: string
  settingsOpen: boolean
  whatsNewVisible: boolean
  canvasControllerRef: MutableRefObject<CanvasController | null>
  applyInventorySnapshot: (project: ProjectState) => Promise<ProjectState>
  setSettingsOpen: (open: boolean) => void
}

export function useOnboardingController({
  project,
  selectedItemId,
  selectedConnectionId,
  demoSessionReady,
  demoDialogState,
  enginePhase,
  settingsOpen,
  whatsNewVisible,
  canvasControllerRef,
  applyInventorySnapshot,
  setSettingsOpen,
}: UseOnboardingControllerOptions) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const query = useQuery({
    queryKey: ONBOARDING_QUERY_KEY,
    queryFn: loadOnboardingStatus,
    enabled: demoSessionReady,
    retry: false,
  })
  const active: EnabledOnboardingStatus | null = query.data?.enabled === true ? query.data : null
  const removalImpactQuery = useQuery({
    queryKey: [...ONBOARDING_QUERY_KEY, 'removal-impact'],
    queryFn: loadOnboardingRemovalImpact,
    enabled: active?.status === 'sample_active' && active.walkthroughStep >= 3,
    retry: false,
  })
  const loadExample = useMutation({
    mutationFn: loadOnboardingExample,
    onSuccess: async (result) => {
      await applyInventorySnapshot(result.project)
      queryClient.setQueryData(ONBOARDING_QUERY_KEY, result.status)
      setError(null)
      setSettingsOpen(false)
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => canvasControllerRef.current?.fitAll())
      })
    },
    onError: (caughtError) => setError(
      caughtError instanceof Error ? caughtError.message : 'The example workspace could not be loaded.',
    ),
  })
  const startEmpty = useMutation({
    mutationFn: startOnboardingEmpty,
    onSuccess: (status) => {
      queryClient.setQueryData(ONBOARDING_QUERY_KEY, status)
      setError(null)
      setSettingsOpen(false)
    },
    onError: (caughtError) => setError(
      caughtError instanceof Error ? caughtError.message : 'Getting started could not be opened.',
    ),
  })
  const finishExample = useMutation({
    mutationFn: finishOnboardingExample,
    onSuccess: async (result) => {
      await applyInventorySnapshot(result.project)
      queryClient.setQueryData(ONBOARDING_QUERY_KEY, result.status)
      queryClient.removeQueries({ queryKey: [...ONBOARDING_QUERY_KEY, 'removal-impact'] })
      setError(null)
    },
    onError: (caughtError) => setError(
      caughtError instanceof Error ? caughtError.message : 'The example workspace could not be updated.',
    ),
  })
  const saveWalkthroughStep = useMutation({
    mutationFn: saveOnboardingWalkthroughStep,
    onSuccess: (status) => {
      queryClient.setQueryData(ONBOARDING_QUERY_KEY, status)
      setError(null)
    },
    onError: (caughtError) => setError(
      caughtError instanceof Error ? caughtError.message : 'Walkthrough progress could not be saved.',
    ),
  })
  const dismiss = useMutation({
    mutationFn: dismissOnboarding,
    onSuccess: (status) => queryClient.setQueryData(ONBOARDING_QUERY_KEY, status),
  })
  const restart = useMutation({
    mutationFn: restartOnboarding,
    onSuccess: (status) => {
      queryClient.setQueryData(ONBOARDING_QUERY_KEY, status)
      setSettingsOpen(false)
    },
  })

  const milestones = useMemo(() => {
    const created = Object.values(project?.items ?? {}).some((item) =>
      isCanvasEquipmentType(item.type) && !item.archivedAt,
    )
    const placed = (project?.placements.length ?? 0) > 0
    const related = (project?.assignments.length ?? 0) > 0 || (project?.connections.length ?? 0) > 0
    return { created, placed, related, completed: created && placed && related }
  }, [project])
  const workspaceIsEmpty = Object.keys(project?.items ?? {}).length === 0
    && (project?.placements.length ?? 0) === 0
    && (project?.assignments.length ?? 0) === 0
    && (project?.connections.length ?? 0) === 0
  const current = active
    ? {
        ...active,
        milestones,
        eligibleForExample: active.eligibleForExample && workspaceIsEmpty,
      }
    : null
  const sampleRefByType = useMemo(() => new Map(
    (active?.sampleInventoryRefs ?? []).map((ref) => [ref.type, `${ref.type}:${ref.id}`]),
  ), [active?.sampleInventoryRefs])
  const sampleConnectionIds = useMemo(
    () => new Set((active?.sampleConnectionIds ?? []).map(String)),
    [active?.sampleConnectionIds],
  )
  const selectedConnection = project && selectedConnectionId !== null
    ? project.connections.find((connection) => String(connection.id) === String(selectedConnectionId)) ?? null
    : null
  const busy = loadExample.isPending
    || startEmpty.isPending
    || finishExample.isPending
    || saveWalkthroughStep.isPending
    || dismiss.isPending
    || restart.isPending
  const currentExampleTarget = useMemo(() => {
    if (!active || active.status !== 'sample_active' || !project) return null
    if (active.walkthroughStep === 0) {
      const itemId = sampleRefByType.get('server')
      return itemId ? { kind: 'item' as const, itemId } : null
    }

    const connectionType = active.walkthroughStep === 1 ? 'network' : 'power'
    const connection = project.connections.find((candidate) =>
      candidate.type === connectionType && sampleConnectionIds.has(String(candidate.id)),
    )
    return connection
      ? { kind: 'connection' as const, connectionId: connection.id, itemId: connection.from.itemId }
      : null
  }, [active, project, sampleConnectionIds, sampleRefByType])

  useEffect(() => {
    if (!active || active.status !== 'sample_active' || saveWalkthroughStep.isPending) return

    const selectedIsSampleConnection = selectedConnection
      && sampleConnectionIds.has(String(selectedConnection.id))
    if (active.walkthroughStep === 0 && selectedItemId === sampleRefByType.get('server')) {
      saveWalkthroughStep.mutate(1)
    } else if (
      active.walkthroughStep === 1
      && selectedIsSampleConnection
      && selectedConnection.type === 'network'
    ) {
      saveWalkthroughStep.mutate(2)
    } else if (
      active.walkthroughStep === 2
      && selectedIsSampleConnection
      && selectedConnection.type === 'power'
    ) {
      saveWalkthroughStep.mutate(3)
    }
  }, [
    active,
    sampleConnectionIds,
    sampleRefByType,
    saveWalkthroughStep,
    selectedConnection,
    selectedItemId,
  ])

  return {
    query,
    current,
    error,
    busy,
    removalImpactQuery,
    loadExample,
    startEmpty,
    finishExample,
    saveWalkthroughStep,
    dismiss,
    restart,
    currentExampleTarget,
    showFirstRun: active?.shouldInvite === true
      && workspaceIsEmpty
      && !whatsNewVisible
      && demoDialogState === 'closed'
      && enginePhase === 'ready',
    showExampleGuide: active?.status === 'sample_active' && active.walkthroughStep < 3,
    showExampleCompletion: active?.status === 'sample_active' && active.walkthroughStep >= 3,
    showGettingStarted: active?.status === 'checklist_active' && !settingsOpen,
  }
}
