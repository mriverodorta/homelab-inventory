import { lazy, Suspense, type ReactNode } from 'react'
import { useAuth } from '@/hooks/use-auth'

const FirstRunSetup = lazy(() =>
  import('@/components/auth/first-run-setup').then((module) => ({ default: module.FirstRunSetup })),
)
const LoginScreen = lazy(() =>
  import('@/components/auth/login-screen').then((module) => ({ default: module.LoginScreen })),
)

function AuthLoading() {
  return <div className="grid min-h-dvh place-items-center bg-[#f5f1ea] font-bold text-[#6f665c]">Checking access…</div>
}

export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth()
  if (auth.loading) return <AuthLoading />
  if (auth.error || !auth.status) {
    return (
      <Suspense fallback={<AuthLoading />}>
        <LoginScreen status={null} loadError={auth.error?.message ?? 'Unable to check authentication status.'} />
      </Suspense>
    )
  }
  if (auth.status.setupRequired) {
    return (
      <Suspense fallback={<AuthLoading />}>
        <FirstRunSetup bootstrapSource={auth.status.bootstrapSource ?? null} />
      </Suspense>
    )
  }
  if (auth.status.mode !== 'disabled' && !auth.status.authenticated) {
    return (
      <Suspense fallback={<AuthLoading />}>
        <LoginScreen status={auth.status} />
      </Suspense>
    )
  }
  return children
}
