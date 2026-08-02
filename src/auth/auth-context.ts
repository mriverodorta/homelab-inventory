import { createContext } from 'react'
import type { AuthSettingsInput, AuthStatus } from '@/types/auth'

export const AUTH_QUERY_KEY = ['authentication', 'status'] as const

export interface AuthContextValue {
  status: AuthStatus | null
  loading: boolean
  error: Error | null
  setup(input: { bootstrapCode: string; username: string; displayName: string; password: string }): Promise<void>
  login(input: { username: string; password: string; remember: boolean }): Promise<void>
  logout(): Promise<void>
  recover(input: { token: string; username: string; displayName: string; password: string }): Promise<void>
  updateSettings(input: AuthSettingsInput): Promise<AuthStatus>
  refresh(): Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
