import { useAuth } from '@/hooks/use-auth'
import type { AuthStatus } from '@/types/auth'

export function hasPermission(status: AuthStatus | null, permission: string): boolean {
  if (!status) return false
  if (status.mode === 'disabled') return true
  return status.authenticated && status.permissions.includes(permission)
}

export function usePermission(permission: string): boolean {
  const { status } = useAuth()
  return hasPermission(status, permission)
}
