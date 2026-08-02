import type { AuthStatus } from '@/types/auth'

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const response = await fetch('/api/auth/status')
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.message ?? 'Unable to check authentication status.')
  return payload as AuthStatus
}
