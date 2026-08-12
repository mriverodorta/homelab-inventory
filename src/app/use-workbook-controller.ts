import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  archiveProject,
  archiveWorkspace,
  createProject,
  createWorkspace,
  loadProjectWorkbooks,
  reorderWorkspaces,
  setDefaultWorkspace,
  updateProject,
  updateCanvasWorkspaceConfiguration,
  updateWorkspace,
  type CanvasWorkspaceConfigurationInput,
  type ProjectInput,
  type ProjectWorkbook,
  type WorkspaceInput,
} from '@/lib/workbook-api'
import {
  readWorkbookPreference,
  resolveOpeningWorkspace,
  writeWorkbookPreference,
} from '@/lib/workspace-preference'
import {
  parseWorkspaceRoute,
  resolveWorkspaceRoute,
  workspacePath,
  type WorkspaceRoute,
} from '@/lib/workspace-route'

type WorkbookControllerOptions = {
  beforeNavigate(): Promise<void>
}

const EMPTY_WORKBOOKS: ProjectWorkbook[] = []

function sameRoute(left: WorkspaceRoute | null, right: WorkspaceRoute | null) {
  return left?.projectId === right?.projectId && left?.workspaceId === right?.workspaceId
}

function replaceWorkbook(workbooks: ProjectWorkbook[], workbook: ProjectWorkbook) {
  const existing = workbooks.findIndex((candidate) => candidate.project.id === workbook.project.id)
  if (existing < 0) return [...workbooks, workbook]
  const next = [...workbooks]
  next[existing] = workbook
  return next
}

export function useWorkbookController({ beforeNavigate }: WorkbookControllerOptions) {
  const queryClient = useQueryClient()
  const hasLegacyProjectSeed = queryClient.getQueryData(['project']) !== undefined
  const beforeNavigateRef = useRef(beforeNavigate)
  beforeNavigateRef.current = beforeNavigate
  const [route, setRoute] = useState<WorkspaceRoute | null>(() => parseWorkspaceRoute(window.location.pathname))
  const routeRef = useRef(route)
  routeRef.current = route
  const [error, setError] = useState<string | null>(null)
  const [browserPreference, setBrowserPreference] = useState(readWorkbookPreference)
  const workbooksQuery = useQuery({
    queryKey: ['project-workbooks'],
    queryFn: loadProjectWorkbooks,
    staleTime: 30_000,
    initialData: hasLegacyProjectSeed ? [{
      project: {
        id: 1,
        name: 'Default Project',
        description: null,
        iconKey: 'house',
        revision: 1,
        includesGlobalInventory: true,
      },
      defaultWorkspaceId: 2,
      workspaces: [
        { id: 1, projectId: 1, type: 'systems', name: 'Systems', iconKey: 'rows-3', colorKey: 'gray', sortOrder: 0, revision: 1, systemKey: 'systems' },
        { id: 2, projectId: 1, type: 'canvas', name: 'Canvas', iconKey: 'network', colorKey: 'blue', sortOrder: 1, revision: 1, systemKey: null },
      ],
    }] : undefined,
  })
  const workbooks = workbooksQuery.data ?? EMPTY_WORKBOOKS

  const writeWorkbook = useCallback((workbook: ProjectWorkbook) => {
    queryClient.setQueryData<ProjectWorkbook[]>(['project-workbooks'], (current = []) => replaceWorkbook(current, workbook))
  }, [queryClient])

  const commitRoute = useCallback((target: WorkspaceRoute, replace = false) => {
    window.history[replace ? 'replaceState' : 'pushState'](null, '', workspacePath(target))
    routeRef.current = target
    setRoute(target)
  }, [])

  const navigate = useCallback(async (target: WorkspaceRoute, replace = false) => {
    if (sameRoute(routeRef.current, target)) return
    setError(null)
    try {
      await beforeNavigateRef.current()
      commitRoute(target, replace)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'The current workspace could not be saved.'
      setError(message)
      const current = routeRef.current
      if (current) window.history.replaceState(null, '', workspacePath(current))
    }
  }, [commitRoute])

  useEffect(() => {
    if (!workbooks.length) return
    const currentRoute = routeRef.current
    const initialWorkbook = workbooks[0]
    const preferredWorkspaceId = !currentRoute && initialWorkbook
      ? resolveOpeningWorkspace({
          useLastActive: browserPreference.useLastActiveWorkspace,
          lastActive: browserPreference.lastWorkspaceByProject[String(initialWorkbook.project.id)],
          defaultId: initialWorkbook.defaultWorkspaceId,
          workspaces: initialWorkbook.workspaces,
        })
      : null
    const resolved = preferredWorkspaceId
      ? { projectId: initialWorkbook.project.id, workspaceId: preferredWorkspaceId }
      : resolveWorkspaceRoute(currentRoute, workbooks)
    if (!resolved) return
    if (!sameRoute(routeRef.current, resolved) || window.location.pathname !== workspacePath(resolved)) {
      routeRef.current = resolved
      setRoute(resolved)
      window.history.replaceState(null, '', workspacePath(resolved))
    }
  }, [browserPreference, workbooks])

  useEffect(() => {
    if (!workbooks.length) return
    let request = 0
    const handlePopState = () => {
      const requestId = ++request
      const target = resolveWorkspaceRoute(parseWorkspaceRoute(window.location.pathname), workbooks)
      if (!target) return
      if (sameRoute(routeRef.current, target)) return
      void beforeNavigateRef.current()
        .then(() => {
          if (requestId !== request) return
          routeRef.current = target
          setRoute(target)
          setError(null)
        })
        .catch((caught) => {
          if (requestId !== request) return
          setError(caught instanceof Error ? caught.message : 'The current workspace could not be saved.')
          const current = routeRef.current
          if (current) window.history.replaceState(null, '', workspacePath(current))
        })
    }
    window.addEventListener('popstate', handlePopState)
    return () => {
      request += 1
      window.removeEventListener('popstate', handlePopState)
    }
  }, [workbooks])

  const activeWorkbook = useMemo(
    () => workbooks.find((workbook) => workbook.project.id === route?.projectId) ?? null,
    [route?.projectId, workbooks],
  )
  const activeWorkspace = useMemo(
    () => activeWorkbook?.workspaces.find((workspace) => workspace.id === route?.workspaceId) ?? null,
    [activeWorkbook, route?.workspaceId],
  )
  const sourceCanvasWorkspace = activeWorkspace?.type === 'canvas'
    ? activeWorkspace
    : activeWorkbook?.workspaces.find((workspace) => workspace.id === activeWorkbook.defaultWorkspaceId && workspace.type === 'canvas')
      ?? activeWorkbook?.workspaces.find((workspace) => workspace.type === 'canvas')
      ?? null

  useEffect(() => {
    if (!route) return
    setBrowserPreference((current) => {
      if (current.lastWorkspaceByProject[String(route.projectId)] === route.workspaceId) return current
      const next = {
        ...current,
        lastWorkspaceByProject: {
          ...current.lastWorkspaceByProject,
          [String(route.projectId)]: route.workspaceId,
        },
      }
      writeWorkbookPreference(next)
      return next
    })
  }, [route])

  const createProjectMutation = useMutation({ mutationFn: createProject })
  const updateProjectMutation = useMutation({
    mutationFn: ({ projectId, input }: { projectId: number; input: ProjectInput }) => updateProject(projectId, input),
  })
  const archiveProjectMutation = useMutation({ mutationFn: archiveProject })
  const createWorkspaceMutation = useMutation({
    mutationFn: ({ projectId, input }: { projectId: number; input: WorkspaceInput }) => createWorkspace(projectId, input),
  })
  const updateWorkspaceMutation = useMutation({
    mutationFn: ({ projectId, workspaceId, input }: { projectId: number; workspaceId: number; input: Omit<WorkspaceInput, 'type'> }) => updateWorkspace(projectId, workspaceId, input),
  })
  const updateCanvasConfigurationMutation = useMutation({
    mutationFn: ({ projectId, workspaceId, input }: {
      projectId: number
      workspaceId: number
      input: CanvasWorkspaceConfigurationInput
    }) => updateCanvasWorkspaceConfiguration(projectId, workspaceId, input),
  })
  const archiveWorkspaceMutation = useMutation({
    mutationFn: ({ projectId, workspaceId }: { projectId: number; workspaceId: number }) => archiveWorkspace(projectId, workspaceId),
  })
  const reorderMutation = useMutation({
    mutationFn: ({ projectId, workspaceIds }: { projectId: number; workspaceIds: number[] }) => reorderWorkspaces(projectId, workspaceIds),
  })
  const defaultWorkspaceMutation = useMutation({
    mutationFn: ({ projectId, workspaceId }: { projectId: number; workspaceId: number }) => setDefaultWorkspace(projectId, workspaceId),
  })
  const busy = createProjectMutation.isPending
    || updateProjectMutation.isPending
    || archiveProjectMutation.isPending
    || createWorkspaceMutation.isPending
    || updateWorkspaceMutation.isPending
    || archiveWorkspaceMutation.isPending
    || reorderMutation.isPending
    || defaultWorkspaceMutation.isPending

  async function execute<T>(operation: () => Promise<T>) {
    setError(null)
    try {
      return await operation()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The workbook operation failed.')
      throw caught
    }
  }

  return {
    route,
    workbooks,
    activeWorkbook,
    activeWorkspace,
    sourceCanvasWorkspace,
    loading: workbooksQuery.isLoading,
    loadError: workbooksQuery.error,
    busy,
    error,
    useLastActiveWorkspace: browserPreference.useLastActiveWorkspace,
    setUseLastActiveWorkspace: (enabled: boolean) => {
      setBrowserPreference((current) => {
        const next = { ...current, useLastActiveWorkspace: enabled }
        writeWorkbookPreference(next)
        return next
      })
    },
    navigate,
    selectProject: async (projectId: number) => {
      const workbook = workbooks.find((candidate) => candidate.project.id === projectId)
      if (workbook) {
        const workspaceId = resolveOpeningWorkspace({
          useLastActive: browserPreference.useLastActiveWorkspace,
          lastActive: browserPreference.lastWorkspaceByProject[String(projectId)],
          defaultId: workbook.defaultWorkspaceId,
          workspaces: workbook.workspaces,
        })
        if (workspaceId) await navigate({ projectId, workspaceId })
      }
    },
    createProject: (input: ProjectInput) => execute(async () => {
      await beforeNavigateRef.current()
      const workbook = await createProjectMutation.mutateAsync(input)
      writeWorkbook(workbook)
      commitRoute({ projectId: workbook.project.id, workspaceId: workbook.defaultWorkspaceId })
    }),
    updateProject: (projectId: number, input: ProjectInput) => execute(async () => {
      const workbook = await updateProjectMutation.mutateAsync({ projectId, input })
      writeWorkbook(workbook)
    }),
    archiveProject: (projectId: number) => execute(async () => {
      if (projectId === 1) throw new Error('The default project cannot be archived.')
      await beforeNavigateRef.current()
      await archiveProjectMutation.mutateAsync(projectId)
      const remaining = workbooks.filter((workbook) => workbook.project.id !== projectId)
      queryClient.setQueryData<ProjectWorkbook[]>(['project-workbooks'], remaining)
      await queryClient.invalidateQueries({ queryKey: ['archived-projects'] })
      if (routeRef.current?.projectId === projectId) {
        const fallback = remaining[0]
        if (fallback) commitRoute({ projectId: fallback.project.id, workspaceId: fallback.defaultWorkspaceId }, true)
      }
    }),
    registerRestoredProject: (workbook: ProjectWorkbook) => {
      writeWorkbook(workbook)
    },
    forgetDeletedProject: (projectId: number) => {
      queryClient.setQueryData<ProjectWorkbook[]>(['project-workbooks'], (current = []) => (
        current.filter((workbook) => workbook.project.id !== projectId)
      ))
    },
    createWorkspace: (input: WorkspaceInput) => execute(async () => {
      if (!activeWorkbook) return
      const beforeIds = new Set(activeWorkbook.workspaces.map((workspace) => workspace.id))
      const workbook = await createWorkspaceMutation.mutateAsync({ projectId: activeWorkbook.project.id, input })
      writeWorkbook(workbook)
      const created = workbook.workspaces.find((workspace) => !beforeIds.has(workspace.id))
      if (created) await navigate({ projectId: workbook.project.id, workspaceId: created.id })
    }),
    updateWorkspace: (workspaceId: number, input: Omit<WorkspaceInput, 'type'>) => execute(async () => {
      if (!activeWorkbook) return
      const workbook = await updateWorkspaceMutation.mutateAsync({ projectId: activeWorkbook.project.id, workspaceId, input })
      writeWorkbook(workbook)
    }),
    updateCanvasConfiguration: (input: CanvasWorkspaceConfigurationInput) => execute(async () => {
      if (!activeWorkbook || !sourceCanvasWorkspace) return
      const workbook = await updateCanvasConfigurationMutation.mutateAsync({
        projectId: activeWorkbook.project.id,
        workspaceId: sourceCanvasWorkspace.id,
        input,
      })
      writeWorkbook(workbook)
    }),
    archiveWorkspace: (workspaceId: number) => execute(async () => {
      if (!activeWorkbook) return
      await beforeNavigateRef.current()
      const workbook = await archiveWorkspaceMutation.mutateAsync({ projectId: activeWorkbook.project.id, workspaceId })
      writeWorkbook(workbook)
      if (routeRef.current?.workspaceId === workspaceId) {
        const target = workbook.workspaces.find((workspace) => workspace.id === workbook.defaultWorkspaceId)
          ?? workbook.workspaces.find((workspace) => workspace.type === 'canvas')
          ?? workbook.workspaces[0]
        if (target) commitRoute({ projectId: workbook.project.id, workspaceId: target.id }, true)
      }
    }),
    reorderWorkspaces: (workspaceIds: number[]) => execute(async () => {
      if (!activeWorkbook) return
      const workbook = await reorderMutation.mutateAsync({ projectId: activeWorkbook.project.id, workspaceIds })
      writeWorkbook(workbook)
    }),
    setDefaultWorkspace: (workspaceId: number) => execute(async () => {
      if (!activeWorkbook) return
      const workbook = await defaultWorkspaceMutation.mutateAsync({ projectId: activeWorkbook.project.id, workspaceId })
      writeWorkbook(workbook)
    }),
  }
}
