import type { AccessPermission, AccessRole } from '@/types/access'

export function accessErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The access change could not be completed.'
}

export function roleNames(roleIds: number[], roles: AccessRole[]): string {
  const names = roleIds.map((id) => roles.find((role) => role.id === id)?.name).filter(Boolean)
  return names.length ? names.join(', ') : 'No roles'
}

export function groupPermissions(permissions: AccessPermission[]): Array<[string, AccessPermission[]]> {
  const groups = new Map<string, AccessPermission[]>()
  for (const permission of permissions) {
    const group = groups.get(permission.group) ?? []
    group.push(permission)
    groups.set(permission.group, group)
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
}

export function inviteUrl(token: string): string {
  return `${window.location.origin}/invite/${encodeURIComponent(token)}`
}
