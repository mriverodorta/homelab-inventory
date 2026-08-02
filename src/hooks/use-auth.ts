import { useContext } from 'react'
import { AuthContext } from '@/auth/auth-context'

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider.')
  return context
}
