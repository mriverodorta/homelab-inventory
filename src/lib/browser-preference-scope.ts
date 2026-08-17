export function browserPreferenceScope(
  accountId: number | null,
  projectId: number,
  workspaceId?: number,
): string {
  const actor = accountId && Number.isSafeInteger(accountId) && accountId > 0
    ? `account:${accountId}`
    : 'device:anonymous'
  const project = Number.isSafeInteger(projectId) && projectId > 0 ? projectId : 1
  const workspace = workspaceId && Number.isSafeInteger(workspaceId) && workspaceId > 0
    ? `:workspace:${workspaceId}`
    : ''

  return `${actor}:project:${project}${workspace}`
}
