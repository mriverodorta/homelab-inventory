import { useState } from 'react'
import { Clock3, MailPlus, RotateCw, Send, Trash2 } from 'lucide-react'
import { InviteLinkDialog } from '@/components/settings/access/invite-link-dialog'
import { RolePicker } from '@/components/settings/access/role-picker'
import { accessErrorMessage, inviteUrl, roleNames } from '@/components/settings/access/access-model'
import { ConfirmSettingsAction, SettingsSection } from '@/components/settings/settings-primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { accessApi } from '@/lib/access-api'
import type { AccessInvitation, AccessRole, InvitationIdentityType } from '@/types/access'

function statusVariant(status: AccessInvitation['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'pending') return 'default'
  if (status === 'accepted') return 'secondary'
  if (status === 'expired') return 'destructive'
  return 'outline'
}

function CreateInvitation({ roles, onCreated }: { roles: AccessRole[]; onCreated: (link: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [identityType, setIdentityType] = useState<InvitationIdentityType>('local')
  const [roleIds, setRoleIds] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true); setError(null)
    try {
      const result = await accessApi.createInvitation({ email, identityType, roleIds })
      setOpen(false); setEmail(''); setRoleIds([])
      await onCreated(inviteUrl(result.token))
    } catch (caught) { setError(accessErrorMessage(caught)) }
    finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><MailPlus />Invite user</Button></DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>Invite a user</DialogTitle><DialogDescription>Choose one login method and the roles this account receives after activation.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <label className="grid gap-1.5 text-sm font-black">Email address<Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
          <label className="grid gap-1.5 text-sm font-black">Login method
            <Select value={identityType} onValueChange={(value) => setIdentityType(value as InvitationIdentityType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="local">Local username and password</SelectItem><SelectItem value="oidc">OpenID Connect</SelectItem></SelectContent>
            </Select>
          </label>
          <div className="grid gap-1.5"><p className="text-sm font-black">Roles</p><RolePicker roles={roles} selected={roleIds} onChange={setRoleIds} /></div>
          {error ? <p role="alert" className="rounded-md border border-[#dfb3a5] bg-[#fff4ee] p-3 text-sm font-semibold text-[#7a2c1d]">{error}</p> : null}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button><Button onClick={() => void submit()} disabled={busy || !email.trim() || !roleIds.length}><Send />{busy ? 'Creating…' : 'Create invitation'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function InvitationsTab({ invitations, roles, canManage, canViewRoles, canAssignRoles, onChanged }: { invitations: AccessInvitation[]; roles: AccessRole[]; canManage: boolean; canViewRoles: boolean; canAssignRoles: boolean; onChanged: () => Promise<unknown> }) {
  const [link, setLink] = useState<string | null>(null)

  async function reveal(nextLink: string) {
    setLink(nextLink)
    await onChanged()
  }

  async function resend(invitation: AccessInvitation) {
    const result = await accessApi.resendInvitation(invitation.id)
    await reveal(inviteUrl(result.token))
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-lg font-black text-[#20242c]">Invitations</h2><p className="mt-1 max-w-2xl text-sm leading-5 text-[#756d62]">Invitation links expire after 24 hours and are shown only when created or renewed.</p></div>
        {canManage && canAssignRoles ? <CreateInvitation roles={roles} onCreated={reveal} /> : null}
      </div>
      <SettingsSection title="Invitation queue">
        {invitations.map((invitation) => (
          <div key={invitation.id} className="grid gap-3 border-b border-[#e8e1d6] p-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><p className="break-all text-sm font-black text-[#20242c]">{invitation.email}</p><Badge variant={statusVariant(invitation.status)}>{invitation.status}</Badge><Badge variant="outline">{invitation.identityType === 'oidc' ? 'OIDC' : 'Local'}</Badge></div>
              <p className="mt-1 text-xs leading-5 text-[#756d62]">{canViewRoles ? roleNames(invitation.roleIds, roles) : `${invitation.roleIds.length} assigned role${invitation.roleIds.length === 1 ? '' : 's'}`}</p>
              <p className="mt-1 flex items-center gap-1 text-xs text-[#756d62]"><Clock3 className="size-3" />Expires {new Date(invitation.expiresAt).toLocaleString()}</p>
            </div>
            {canManage && ['pending', 'expired'].includes(invitation.status) ? <div className="flex flex-wrap gap-2 sm:justify-end">
              <Button variant="outline" onClick={() => void resend(invitation)}><RotateCw />Resend</Button>
              {invitation.status === 'pending' ? <ConfirmSettingsAction destructive title="Revoke invitation?" description={`The current link for ${invitation.email} will stop working immediately.`} actionLabel="Revoke" onConfirm={async () => { await accessApi.revokeInvitation(invitation.id); await onChanged() }} /> : null}
            </div> : null}
          </div>
        ))}
        {!invitations.length ? <div className="grid place-items-center gap-2 p-8 text-center"><Trash2 className="size-5 text-[#8a8175]" /><p className="text-sm text-[#756d62]">No invitations have been created.</p></div> : null}
      </SettingsSection>
      <InviteLinkDialog link={link} open={Boolean(link)} onOpenChange={(open) => { if (!open) setLink(null) }} />
    </div>
  )
}
