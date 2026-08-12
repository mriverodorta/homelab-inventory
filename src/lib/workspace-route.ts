export type WorkspaceRoute = Readonly<{
  projectId: number
  workspaceId: number
}>

function positiveId(value: string) {
  if (!/^[1-9]\d*$/u.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export function parseWorkspaceRoute(pathname: string): WorkspaceRoute | null {
  const match = /^\/projects\/([^/]+)\/workspaces\/([^/]+)\/?$/u.exec(pathname)
  if (!match) return null
  const projectId = positiveId(match[1])
  const workspaceId = positiveId(match[2])
  return projectId && workspaceId ? { projectId, workspaceId } : null
}

export function workspacePath(route: WorkspaceRoute) {
  return `/projects/${route.projectId}/workspaces/${route.workspaceId}`
}

export function navigateWorkspace(route: WorkspaceRoute, options: { replace?: boolean } = {}) {
  const method = options.replace ? 'replaceState' : 'pushState'
  window.history[method](null, '', workspacePath(route))
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function subscribeWorkspaceRoute(listener: (route: WorkspaceRoute | null) => void) {
  const handle = () => listener(parseWorkspaceRoute(window.location.pathname))
  window.addEventListener('popstate', handle)
  return () => window.removeEventListener('popstate', handle)
}

export function resolveWorkspaceRoute(
  candidate: WorkspaceRoute | null,
  workbooks: readonly { project: { id: number }; defaultWorkspaceId: number; workspaces: readonly { id: number; type: string }[] }[],
) {
  if (candidate) {
    const project = workbooks.find((workbook) => workbook.project.id === candidate.projectId)
    if (project?.workspaces.some((workspace) => workspace.id === candidate.workspaceId)) return candidate
  }
  const project = workbooks[0]
  if (!project) return null
  const workspaceId = project.workspaces.some((workspace) => workspace.id === project.defaultWorkspaceId)
    ? project.defaultWorkspaceId
    : project.workspaces.find((workspace) => workspace.type === 'canvas')?.id
      ?? project.workspaces[0]?.id
  return workspaceId ? { projectId: project.project.id, workspaceId } : null
}
