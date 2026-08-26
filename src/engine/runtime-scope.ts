export type CanvasRuntimeScope = {
  accountScope: string
  projectId: number
  workspaceId: number
  workspaceType: 'canvas'
}

export type EngineWorkspaceScope = Pick<CanvasRuntimeScope, 'projectId' | 'workspaceId'>

function assertPositiveSafeInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer.`)
  }
}

export function assertEngineWorkspaceScope(scope: EngineWorkspaceScope) {
  assertPositiveSafeInteger(scope.projectId, 'projectId')
  assertPositiveSafeInteger(scope.workspaceId, 'workspaceId')
}

export function canvasRuntimeKey(scope: CanvasRuntimeScope) {
  assertEngineWorkspaceScope(scope)
  const accountScope = scope.accountScope.trim()
  if (!accountScope) throw new Error('Canvas runtime account scope is required.')
  if (scope.workspaceType !== 'canvas') throw new Error('Canvas runtime workspace type is invalid.')
  return `${encodeURIComponent(accountScope)}:${scope.projectId}:${scope.workspaceId}:canvas`
}
