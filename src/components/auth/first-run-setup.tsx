import { useState, type FormEvent } from 'react'
import { AlertCircle } from 'lucide-react'
import { AuthShell } from './auth-shell'
import { PasswordField } from './password-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/hooks/use-auth'

export function FirstRunSetup({ bootstrapSource }: { bootstrapSource: string | null }) {
  const auth = useAuth()
  const [bootstrapCode, setBootstrapCode] = useState('')
  const [username, setUsername] = useState('owner')
  const [displayName, setDisplayName] = useState('Homelab Owner')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (password !== confirmPassword) return setError('Passwords do not match.')
    setBusy(true); setError(null)
    try { await auth.setup({ bootstrapCode, username, displayName, password }) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Setup failed.') }
    finally { setBusy(false) }
  }

  return (
    <AuthShell title="Set up your owner account" description="Use the one-time bootstrap code from the container logs or configured secret, then create the local owner account.">
      <form className="grid gap-4" onSubmit={submit}>
        {error ? <p role="alert" className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</p> : null}
        <label className="grid gap-1.5 text-sm font-bold" htmlFor="bootstrap-code">Bootstrap code<Input id="bootstrap-code" value={bootstrapCode} onChange={(event) => setBootstrapCode(event.target.value)} autoComplete="one-time-code" /></label>
        <p className="-mt-2 text-xs text-[#81786e]">Source: {bootstrapSource ?? 'container configuration'}</p>
        <label className="grid gap-1.5 text-sm font-bold" htmlFor="owner-username">Username<Input id="owner-username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></label>
        <label className="grid gap-1.5 text-sm font-bold" htmlFor="owner-name">Display name<Input id="owner-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" /></label>
        <label className="grid gap-1.5 text-sm font-bold" htmlFor="owner-password">Password<PasswordField id="owner-password" value={password} onChange={setPassword} autoComplete="new-password" /></label>
        <label className="grid gap-1.5 text-sm font-bold" htmlFor="owner-password-confirm">Confirm password<PasswordField id="owner-password-confirm" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" /></label>
        <p className="text-xs leading-5 text-[#81786e]">Use at least 12 characters. Common passwords are rejected.</p>
        <Button type="submit" size="lg" disabled={busy}>{busy ? 'Creating owner…' : 'Create owner account'}</Button>
      </form>
    </AuthShell>
  )
}
