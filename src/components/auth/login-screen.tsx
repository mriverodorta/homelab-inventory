import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AlertCircle, KeyRound, RefreshCw } from 'lucide-react'
import { AuthShell } from './auth-shell'
import { PasswordField } from './password-field'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/hooks/use-auth'
import type { AuthStatus } from '@/types/auth'

export function LoginScreen({ status, loadError = null }: { status: AuthStatus | null; loadError?: string | null }) {
  const auth = useAuth()
  const recoveryToken = useMemo(() => new URLSearchParams(window.location.search).get('recovery'), [])
  const oidcError = useMemo(() => new URLSearchParams(window.location.search).get('authError') === 'oidc', [])
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState<string | null>(oidcError ? 'Identity provider sign-in failed. Try again or use local credentials.' : loadError)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (loadError) setError(loadError)
  }, [loadError])

  useEffect(() => {
    if (!oidcError) return
    const url = new URL(window.location.href)
    url.searchParams.delete('authError')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [oidcError])

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null)
    try {
      if (recoveryToken) await auth.recover({ token: recoveryToken, username, displayName, password })
      else await auth.login({ username, password, remember })
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Login failed.') }
    finally { setBusy(false) }
  }

  async function retryStatus() {
    setBusy(true); setError(null)
    try { await auth.refresh() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to check authentication status.') }
    finally { setBusy(false) }
  }

  const localAvailable = recoveryToken || status?.methods.local
  const oidcAvailable = !recoveryToken && status?.methods.oidc && status.oidc.loginReady !== false
  return (
    <AuthShell title={recoveryToken ? 'Recover owner access' : 'Sign in'} description={recoveryToken ? 'Set a new local owner identity and password. This recovery link can be used once.' : 'Authenticate to open your Homelab Inventory workspace.'}>
      <div className="grid gap-5">
        {!status && error ? <div role="alert" className="grid gap-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p className="flex gap-2"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</p><Button type="button" variant="outline" onClick={() => void retryStatus()} disabled={busy}><RefreshCw />{busy ? 'Checking…' : 'Retry'}</Button></div> : null}
        {localAvailable ? (
          <form className="grid gap-4" onSubmit={submit}>
            {error ? <p role="alert" className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</p> : null}
            <label className="grid gap-1.5 text-sm font-bold" htmlFor="login-username">Username<Input id="login-username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoFocus /></label>
            {recoveryToken ? <label className="grid gap-1.5 text-sm font-bold" htmlFor="recovery-display-name">Display name<Input id="recovery-display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" /></label> : null}
            <label className="grid gap-1.5 text-sm font-bold" htmlFor="login-password">Password<PasswordField id="login-password" value={password} onChange={setPassword} autoComplete={recoveryToken ? 'new-password' : 'current-password'} /></label>
            {!recoveryToken ? <label className="flex items-center gap-2 text-sm"><Checkbox checked={remember} onCheckedChange={(checked) => setRemember(checked === true)} />Keep me signed in for 7 days</label> : null}
            <Button type="submit" size="lg" disabled={busy}>{busy ? 'Please wait…' : recoveryToken ? 'Reset owner access' : 'Sign in'}</Button>
          </form>
        ) : null}
        {localAvailable && oidcAvailable ? <div className="flex items-center gap-3 text-xs uppercase text-[#8a8175] before:h-px before:flex-1 before:bg-[#ded7cc] after:h-px after:flex-1 after:bg-[#ded7cc]">or</div> : null}
        {oidcAvailable ? <Button variant="outline" size="lg" onClick={() => window.location.assign(`/api/auth/oidc/start?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`)}><KeyRound />Continue with identity provider</Button> : null}
      </div>
    </AuthShell>
  )
}
