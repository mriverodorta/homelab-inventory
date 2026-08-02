import type { ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AUTH_QUERY_KEY, AuthContext, type AuthContextValue } from '@/auth/auth-context'
import { fetchAuthStatus } from '@/lib/auth-status-api'
import type { AuthStatus } from '@/types/auth'

const loadAuthApi = () => import('@/lib/auth-api').then((module) => module.authApi)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: fetchAuthStatus,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })
  const commitStatus = (status: AuthStatus) => queryClient.setQueryData(AUTH_QUERY_KEY, status)

  const value: AuthContextValue = {
    status: query.data ?? null,
    loading: query.isLoading,
    error: query.error,
    setup: async (input) => { commitStatus(await (await loadAuthApi()).setup(input)) },
    login: async (input) => { commitStatus(await (await loadAuthApi()).login(input)) },
    logout: async () => {
      await (await loadAuthApi()).logout()
      await queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY })
    },
    recover: async (input) => { commitStatus(await (await loadAuthApi()).recover(input)) },
    updateSettings: async (input) => {
      const status = await (await loadAuthApi()).updateSettings(input)
      commitStatus(status)
      return status
    },
    refresh: async () => { await query.refetch() },
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
