import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { KeyRound, Laptop, LogOut, ShieldCheck, Trash2 } from 'lucide-react'
import { PasswordField } from '@/components/auth/password-field'
import { ConfirmSettingsAction, EnvironmentValue, SettingRow, SettingsSection } from '@/components/settings/settings-primitives'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { authApi } from '@/lib/auth-api'
import { useAuth } from '@/hooks/use-auth'

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Authentication settings could not be saved.'
}

function AuthenticationMethods() {
  const auth = useAuth()
  const status = auth.status!
  const [localEnabled, setLocalEnabled] = useState(status.methods.local || status.mode === 'disabled')
  const [oidcEnabled, setOidcEnabled] = useState(status.methods.oidc)
  const [username, setUsername] = useState(status.account?.username ?? 'owner')
  const [displayName, setDisplayName] = useState(status.account?.displayName ?? 'Homelab Owner')
  const [password, setPassword] = useState('')
  const [issuer, setIssuer] = useState(status.oidc.issuer ?? '')
  const [clientId, setClientId] = useState(status.oidc.clientId ?? '')
  const [clientSecret, setClientSecret] = useState('')
  const [externalUrl, setExternalUrl] = useState(status.oidc.externalUrl ?? window.location.origin)
  const [scopes, setScopes] = useState((status.oidc.scopes ?? ['openid', 'profile', 'email']).join(' '))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setLocalEnabled(status.methods.local || status.mode === 'disabled')
    setOidcEnabled(status.methods.oidc)
    setIssuer(status.oidc.issuer ?? '')
    setClientId(status.oidc.clientId ?? '')
    setExternalUrl(status.oidc.externalUrl ?? window.location.origin)
    setScopes((status.oidc.scopes ?? ['openid', 'profile', 'email']).join(' '))
  }, [status])

  async function save() {
    setBusy(true); setMessage(null)
    try {
      await auth.updateSettings({
        enabled: true,
        localEnabled,
        oidcEnabled,
        username,
        displayName,
        password: password || undefined,
        oidc: oidcEnabled ? {
          issuer,
          clientId,
          clientSecret: clientSecret || undefined,
          externalUrl,
          scopes: scopes.split(/\s+/).filter(Boolean),
        } : undefined,
      })
      setPassword(''); setClientSecret(''); setMessage('Authentication settings saved.')
    } catch (error) { setMessage(errorMessage(error)) }
    finally { setBusy(false) }
  }

  const enablingLocal = localEnabled && !status.localCredentialConfigured
  const oidcSecretMissing = oidcEnabled && !status.oidc.clientSecretConfigured && !clientSecret
  const oidcNeedsOwnerBinding = oidcEnabled && !localEnabled && Boolean(status.account) && !status.oidc.identityBound
  const invalid = (!localEnabled && !oidcEnabled) || (enablingLocal && password.length < 12) || oidcSecretMissing || oidcNeedsOwnerBinding

  return <SettingsSection title="Login methods" description="Enable local credentials, OIDC, or both. Existing installations remain open until authentication is explicitly enabled.">
    <SettingRow label="Local username and password" description="Uses Argon2id password hashing and server-side sessions."><Switch checked={localEnabled} onCheckedChange={setLocalEnabled} /></SettingRow>
    {enablingLocal ? <div className="grid gap-3 border-b border-[#e8e1d6] p-4 sm:grid-cols-2">
      <label className="grid gap-1.5 text-sm font-bold">Username<Input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></label>
      <label className="grid gap-1.5 text-sm font-bold">Display name<Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" /></label>
      <label htmlFor="authentication-initial-password" className="grid gap-1.5 text-sm font-bold sm:col-span-2">Initial password<PasswordField id="authentication-initial-password" value={password} onChange={setPassword} autoComplete="new-password" /></label>
    </div> : null}
    <SettingRow label="OpenID Connect" description="Authorization Code flow with PKCE. Exact issuer and subject identify the owner."><Switch checked={oidcEnabled} onCheckedChange={setOidcEnabled} /></SettingRow>
    {oidcEnabled ? <div className="grid gap-3 border-b border-[#e8e1d6] p-4 sm:grid-cols-2">
      <label className="grid gap-1.5 text-sm font-bold sm:col-span-2">Issuer URL<Input value={issuer} onChange={(event) => setIssuer(event.target.value)} placeholder="https://auth.example.com/application/o/homelab-inventory/" /></label>
      <label className="grid gap-1.5 text-sm font-bold">Client ID<Input value={clientId} onChange={(event) => setClientId(event.target.value)} /></label>
      <label className="grid gap-1.5 text-sm font-bold">Scopes<Input value={scopes} onChange={(event) => setScopes(event.target.value)} /></label>
      <label className="grid gap-1.5 text-sm font-bold sm:col-span-2">Public application URL<Input value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} placeholder="https://inventory.example.com" /></label>
      <div className="grid gap-1.5 text-sm font-bold sm:col-span-2"><label htmlFor="authentication-oidc-secret">Client secret</label>{status.oidcSecretReadOnly ? <EnvironmentValue label="OIDC client secret" value="Configured by Docker environment" /> : <PasswordField id="authentication-oidc-secret" value={clientSecret} onChange={setClientSecret} autoComplete="new-password" placeholder={status.oidc.clientSecretConfigured ? 'Configured; leave blank to keep it' : 'Required'} />}</div>
      <p className="text-xs leading-5 text-[#756d62] sm:col-span-2">Callback URL: <code>{externalUrl.replace(/\/$/, '')}/api/auth/oidc/callback</code></p>
      {oidcNeedsOwnerBinding ? <p role="alert" className="text-xs font-semibold leading-5 text-[#9b3f32] sm:col-span-2">Keep local login enabled, save these settings, then use Test OIDC login to bind the owner before disabling local login.</p> : null}
    </div> : null}
    <div className="flex flex-wrap items-center justify-end gap-3 p-4">
      {message ? <p role="status" className="mr-auto text-sm font-semibold text-[#665d52]">{message}</p> : null}
      {oidcEnabled && status.mode !== 'disabled' ? <Button variant="outline" onClick={() => window.location.assign(`/api/auth/oidc/start?returnTo=${encodeURIComponent(window.location.pathname)}`)}><KeyRound />Test OIDC login</Button> : null}
      <Button onClick={() => void save()} disabled={busy || invalid}><ShieldCheck />{busy ? 'Saving…' : status.mode === 'disabled' ? 'Enable authentication' : 'Save methods'}</Button>
    </div>
  </SettingsSection>
}

function AccountSecurity() {
  const auth = useAuth()
  const status = auth.status!
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const sessions = useQuery({ queryKey: ['authentication', 'sessions'], queryFn: authApi.sessions, enabled: status.authenticated })
  const events = useQuery({ queryKey: ['authentication', 'events'], queryFn: authApi.events, enabled: status.authenticated })

  async function changePassword() {
    setMessage(null)
    try { await authApi.changePassword({ currentPassword, newPassword }); setCurrentPassword(''); setNewPassword(''); setMessage('Password changed. Other sessions were revoked.') }
    catch (error) { setMessage(errorMessage(error)) }
  }

  return <div className="grid gap-4">
    {status.methods.local ? <SettingsSection title="Owner password" description="Changing the password revokes every other active session.">
      <div className="grid gap-3 p-4 sm:grid-cols-2"><label htmlFor="authentication-current-password" className="grid gap-1.5 text-sm font-bold">Current password<PasswordField id="authentication-current-password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" /></label><label htmlFor="authentication-new-password" className="grid gap-1.5 text-sm font-bold">New password<PasswordField id="authentication-new-password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" /></label></div>
      <div className="flex items-center justify-end gap-3 border-t border-[#e8e1d6] p-4">{message ? <p role="status" className="mr-auto text-sm font-semibold text-[#665d52]">{message}</p> : null}<Button disabled={!currentPassword || newPassword.length < 12} onClick={() => void changePassword()}>Change password</Button></div>
    </SettingsSection> : null}
    <SettingsSection title="Active sessions" description="Review browsers that currently have owner access.">
      {(sessions.data?.sessions ?? []).map((session) => <div key={session.id} className="flex flex-wrap items-center gap-3 border-b border-[#e8e1d6] p-4 last:border-b-0"><Laptop className="size-4" /><div className="min-w-0 flex-1"><p className="text-sm font-bold">{session.current ? 'This browser' : session.userAgent || 'Unknown browser'}</p><p className="text-xs text-[#756d62]">Last active {new Date(session.lastSeenAt).toLocaleString()} · expires {new Date(session.idleExpiresAt).toLocaleString()}</p></div>{!session.current ? <Button size="icon-sm" variant="ghost" title="Revoke session" onClick={() => void authApi.revokeSession(session.id).then(() => sessions.refetch())}><Trash2 /></Button> : null}</div>)}
      {!sessions.isPending && !sessions.data?.sessions.length ? <p className="p-4 text-sm text-[#756d62]">No active sessions.</p> : null}
    </SettingsSection>
    <SettingsSection title="Security activity" description="The latest owner authentication events are retained locally.">
      {(events.data?.events ?? []).slice(0, 12).map((event) => <div key={event.id} className="border-b border-[#e8e1d6] p-4 last:border-b-0"><p className="text-sm font-bold">{event.type.replaceAll('-', ' ')}</p><p className="text-xs text-[#756d62]">{new Date(event.createdAt).toLocaleString()}{event.detail ? ` · ${event.detail}` : ''}</p></div>)}
    </SettingsSection>
  </div>
}

export function AuthenticationSettings() {
  const auth = useAuth()
  const status = auth.status
  const modeLabel = useMemo(() => status?.mode === 'oidc' ? 'OIDC' : status?.mode === 'hybrid' ? 'Local + OIDC' : status?.mode === 'local' ? 'Local' : 'Disabled', [status?.mode])
  if (!status) return <p role="alert" className="text-sm font-semibold text-[#9b3f32]">Authentication status is unavailable.</p>
  return <div className="grid gap-4">
    <SettingsSection title="Authentication" description="Protect the inventory interface and API with local credentials, an identity provider, or both.">
      <SettingRow label="Current mode" description={status.mode === 'disabled' ? 'This existing installation remains open until you opt in.' : 'All browser API access requires an authenticated owner session.'}><span className="rounded-md border border-[#ded8ce] bg-[#f7f2e9] px-3 py-2 text-sm font-black">{modeLabel}</span></SettingRow>
    </SettingsSection>
    <Tabs defaultValue="methods"><TabsList variant="line"><TabsTrigger value="methods">Methods</TabsTrigger>{status.mode !== 'disabled' && status.authenticated ? <TabsTrigger value="account">Account & sessions</TabsTrigger> : null}</TabsList><TabsContent value="methods" className="pt-4"><AuthenticationMethods /></TabsContent>{status.mode !== 'disabled' && status.authenticated ? <TabsContent value="account" className="pt-4"><AccountSecurity /></TabsContent> : null}</Tabs>
    {status.mode !== 'disabled' ? <SettingsSection title="Disable protection" description="Disabling authentication revokes active sessions and makes the application open to every client that can reach it."><SettingRow label="Disable authentication" description="Use only on a trusted LAN or behind another authenticated proxy."><ConfirmSettingsAction destructive title="Disable authentication?" description="The application and API will become accessible without signing in. Active sessions will be revoked." actionLabel="Disable authentication" onConfirm={async () => { await auth.updateSettings({ enabled: false, localEnabled: false, oidcEnabled: false }); await auth.refresh() }} /></SettingRow></SettingsSection> : null}
    {status.mode !== 'disabled' ? <div className="flex justify-end"><Button variant="outline" onClick={() => void auth.logout()}><LogOut />Sign out</Button></div> : null}
  </div>
}
