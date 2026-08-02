import type { AuthSettingsInput, AuthStatus } from '@/types/auth'

export class AuthApiError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(message: string, status: number, code: string | null = null) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: options?.body ? { 'Content-Type': 'application/json', ...options.headers } : options?.headers,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new AuthApiError(payload.message ?? 'Authentication request failed.', response.status, payload.code ?? null)
  return payload as T
}

export const authApi = {
  status: () => request<AuthStatus>('/api/auth/status'),
  setup: (input: { bootstrapCode: string; username: string; displayName: string; password: string }) => (
    request<AuthStatus>('/api/auth/setup', { method: 'POST', body: JSON.stringify(input) })
  ),
  login: (input: { username: string; password: string; remember: boolean }) => (
    request<AuthStatus>('/api/auth/login', { method: 'POST', body: JSON.stringify(input) })
  ),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  updateSettings: (input: AuthSettingsInput) => request<AuthStatus>('/api/auth/settings', { method: 'PATCH', body: JSON.stringify(input) }),
  changePassword: (input: { currentPassword: string; newPassword: string }) => request<{ ok: true }>('/api/auth/password', { method: 'POST', body: JSON.stringify(input) }),
  recover: (input: { token: string; username: string; displayName: string; password: string }) => (
    request<AuthStatus>('/api/auth/recovery/reset', { method: 'POST', body: JSON.stringify(input) })
  ),
  sessions: () => request<{ sessions: AuthSession[] }>('/api/auth/sessions'),
  events: () => request<{ events: AuthSecurityEvent[] }>('/api/auth/events'),
  revokeSession: (id: number) => request<{ ok: true }>(`/api/auth/sessions/${String(id)}`, { method: 'DELETE' }),
}

export interface AuthSession {
  id: number
  remember: boolean
  createdAt: string
  lastSeenAt: string
  idleExpiresAt: string
  absoluteExpiresAt: string
  userAgent: string | null
  ip: string | null
  current: boolean
}

export interface AuthSecurityEvent {
  id: number
  type: string
  detail: string | null
  ip: string | null
  userAgent: string | null
  createdAt: string
}
