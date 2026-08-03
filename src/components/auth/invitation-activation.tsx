import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { PasswordField } from '@/components/auth/password-field'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/hooks/use-auth'
import { accessApi } from '@/lib/access-api'

export function InvitationActivation({ token }: { token: string }) {
  const auth = useAuth()
  const invitation = useQuery({ queryKey: ['invitation', token], queryFn: () => accessApi.inspectInvitation(token), retry: false })
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function activateLocal() {
    setBusy(true); setError(null)
    try {
      await accessApi.activateLocalInvitation(token, { username, displayName, password, remember })
      await auth.refresh()
      window.history.replaceState(null, '', '/')
      window.location.reload()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The invitation could not be activated.') }
    finally { setBusy(false) }
  }

  if (invitation.isPending) return <div className="grid min-h-dvh place-items-center bg-[#f5f1ea] font-bold text-[#6f665c]">Checking invitation…</div>

  if (invitation.error || !invitation.data) {
    return <main className="grid min-h-dvh place-items-center bg-[#f5f1ea] p-4"><Card className="w-full max-w-md"><CardHeader><CardTitle>Invitation unavailable</CardTitle><CardDescription>{invitation.error?.message ?? 'This invitation is invalid or has expired.'}</CardDescription></CardHeader><CardFooter><Button asChild className="w-full"><a href="/">Return to sign in</a></Button></CardFooter></Card></main>
  }

  const record = invitation.data.invitation
  return (
    <main className="grid min-h-dvh place-items-center bg-[#f5f1ea] p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <span className="mb-2 flex size-11 items-center justify-center rounded-md bg-[#20242c] text-white"><ShieldCheck className="size-5" /></span>
          <CardTitle>Join Homelab Inventory</CardTitle>
          <CardDescription>{record.email} was invited to use this installation. The invitation expires {new Date(record.expiresAt).toLocaleString()}.</CardDescription>
        </CardHeader>
        {record.identityType === 'local' ? <>
          <CardContent className="grid gap-4">
            <label className="grid gap-1.5 text-sm font-black">Username<Input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></label>
            <label className="grid gap-1.5 text-sm font-black">Display name<Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" /></label>
            <label htmlFor="invitation-password" className="grid gap-1.5 text-sm font-black">Password<PasswordField id="invitation-password" value={password} onChange={setPassword} autoComplete="new-password" /></label>
            <label className="flex items-center gap-3 text-sm font-semibold"><Checkbox checked={remember} onCheckedChange={(checked) => setRemember(checked === true)} />Keep me signed in</label>
            {error ? <p role="alert" className="rounded-md border border-[#dfb3a5] bg-[#fff4ee] p-3 text-sm font-semibold text-[#7a2c1d]">{error}</p> : null}
          </CardContent>
          <CardFooter><Button className="w-full" disabled={busy || !username.trim() || !displayName.trim() || password.length < 12} onClick={() => void activateLocal()}><KeyRound />{busy ? 'Activating…' : 'Create local account'}</Button></CardFooter>
        </> : <>
          <CardContent><p className="rounded-md border border-[#ded8ce] bg-[#f7f2e9] p-3 text-sm leading-6 text-[#665d52]">Continue with the configured identity provider. Its verified email must exactly match this invitation.</p></CardContent>
          <CardFooter><Button asChild className="w-full"><a href={`/api/auth/oidc/start?invitation=${encodeURIComponent(token)}&returnTo=${encodeURIComponent('/')}`}><KeyRound />Continue with OIDC</a></Button></CardFooter>
        </>}
      </Card>
    </main>
  )
}
