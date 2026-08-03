import type {
  AccessInvitation,
  AccessPermission,
  AccessRole,
  AccessUser,
  InvitationActivation,
  InvitationIdentityType,
} from '@/types/access'

export class AccessApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: options?.body ? { 'Content-Type': 'application/json', ...options.headers } : options?.headers,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new AccessApiError(payload.message ?? 'Access request failed.', response.status)
  return payload as T
}

export const accessApi = {
  permissions: () => request<{ permissions: AccessPermission[] }>('/api/access/permissions'),
  roles: () => request<{ roles: AccessRole[] }>('/api/access/roles'),
  createRole: (input: { name: string; key?: string; description?: string; permissionIds: number[] }) =>
    request<{ role: AccessRole }>('/api/access/roles', { method: 'POST', body: JSON.stringify(input) }),
  duplicateRole: (id: number, input: { name: string; key?: string; description?: string }) =>
    request<{ role: AccessRole }>(`/api/access/roles/${id}/duplicate`, { method: 'POST', body: JSON.stringify(input) }),
  updateRole: (id: number, input: { name?: string; description?: string; active?: boolean }) =>
    request<{ role: AccessRole }>(`/api/access/roles/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  setRolePermissions: (id: number, permissionIds: number[]) =>
    request<{ role: AccessRole }>(`/api/access/roles/${id}/permissions`, { method: 'PUT', body: JSON.stringify({ permissionIds }) }),
  deleteRole: (id: number) => request<{ id: number }>(`/api/access/roles/${id}`, { method: 'DELETE' }),
  users: () => request<{ users: AccessUser[] }>('/api/access/users'),
  updateUser: (id: number, input: { displayName?: string; active?: boolean }) =>
    request<{ user: AccessUser }>(`/api/access/users/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  assignRoles: (id: number, roleIds: number[]) =>
    request<{ user: AccessUser }>(`/api/access/users/${id}/roles`, { method: 'PUT', body: JSON.stringify({ roleIds }) }),
  revokeUserSessions: (id: number) => request<{ id: number }>(`/api/access/users/${id}/revoke-sessions`, { method: 'POST' }),
  deleteUser: (id: number) => request<{ id: number }>(`/api/access/users/${id}`, { method: 'DELETE' }),
  invitations: () => request<{ invitations: AccessInvitation[] }>('/api/access/invitations'),
  createInvitation: (input: { email: string; identityType: InvitationIdentityType; roleIds: number[] }) =>
    request<{ invitation: AccessInvitation; token: string }>('/api/access/invitations', { method: 'POST', body: JSON.stringify(input) }),
  resendInvitation: (id: number) =>
    request<{ invitation: AccessInvitation; token: string }>(`/api/access/invitations/${id}/resend`, { method: 'POST' }),
  revokeInvitation: (id: number) => request<{ id: number }>(`/api/access/invitations/${id}`, { method: 'DELETE' }),
  inspectInvitation: (token: string) => request<InvitationActivation>(`/api/auth/invitations/${encodeURIComponent(token)}`),
  activateLocalInvitation: (token: string, input: { username: string; displayName: string; password: string; remember: boolean }) =>
    request<{ ok: true }>(`/api/auth/invitations/${encodeURIComponent(token)}/activate-local`, { method: 'POST', body: JSON.stringify(input) }),
}
