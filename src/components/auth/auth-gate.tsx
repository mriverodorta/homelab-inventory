import { LogOut, ShieldX } from 'lucide-react'
import { lazy, Suspense, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/use-auth'

const FirstRunSetup = lazy(() =>
  import('@/components/auth/first-run-setup').then((module) => ({ default: module.FirstRunSetup })),
)
const LoginScreen = lazy(() =>
  import('@/components/auth/login-screen').then((module) => ({ default: module.LoginScreen })),
)
const InvitationActivation = lazy(() =>
  import('@/components/auth/invitation-activation').then((module) => ({ default: module.InvitationActivation })),
)

function AuthLoading() {
  return <div className="grid min-h-dvh place-items-center bg-[#f5f1ea] font-bold text-[#6f665c]">Checking access…</div>
}

export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const invitationMatch = window.location.pathname.match(/^\/invite\/([^/]+)\/?$/)
  if (invitationMatch) {
    return <Suspense fallback={<AuthLoading />}><InvitationActivation token={decodeURIComponent(invitationMatch[1])} /></Suspense>
  }
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
  if (auth.status.mode !== 'disabled' && !auth.status.permissions.includes('workspace.view')) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#f5f1ea] p-4">
        <section className="w-full max-w-md rounded-lg border border-[#d6ccbd] bg-[#fffdf8] p-6 shadow-[0_18px_48px_rgba(32,36,44,0.14)]">
          <div className="flex size-12 items-center justify-center rounded-md bg-[#fff2c7] text-[#6b4a10]">
            <ShieldX className="size-6" aria-hidden="true" />
          </div>
          <h1 className="mt-5 text-2xl font-black text-[#20242c]">Workspace access unavailable</h1>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#75695d]">
            Your account is signed in but has no role that can open this workspace. Ask an administrator to assign a role, then sign in again.
          </p>
          <Button type="button" className="mt-6 w-full gap-2" onClick={() => void auth.logout()}>
            <LogOut data-icon="inline-start" />
            Sign out
          </Button>
        </section>
      </main>
    )
  }
  return children
}
