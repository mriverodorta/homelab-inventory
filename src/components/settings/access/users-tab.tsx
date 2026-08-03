import { useEffect, useState } from 'react'
import { KeyRound, MoreHorizontal, Shield, UserRound, UserX } from 'lucide-react'
import { ConfirmSettingsAction, SettingsSection } from '@/components/settings/settings-primitives'
import { RolePicker } from '@/components/settings/access/role-picker'
import { accessErrorMessage, roleNames } from '@/components/settings/access/access-model'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { accessApi } from '@/lib/access-api'
import type { AccessRole, AccessUser } from '@/types/access'

function UserEditor({
  user,
  roles,
  canManage,
  canViewRoles,
  canAssignRoles,
  onChanged,
}: {
  user: AccessUser
  roles: AccessRole[]
  canManage: boolean
  canViewRoles: boolean
  canAssignRoles: boolean
  onChanged: () => Promise<unknown>
}) {
  const [displayName, setDisplayName] = useState(user.displayName)
  const [roleIds, setRoleIds] = useState(user.roleIds)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setDisplayName(user.displayName)
    setRoleIds(user.roleIds)
  }, [user])

  const rolesDirty = canAssignRoles && roleIds.join(',') !== [...user.roleIds].sort((a, b) => a - b).join(',')
  const dirty = displayName.trim() !== user.displayName || rolesDirty

  async function save() {
    setBusy(true); setMessage(null)
    try {
      if (displayName.trim() !== user.displayName) await accessApi.updateUser(user.id, { displayName: displayName.trim() })
      if (rolesDirty) await accessApi.assignRoles(user.id, roleIds)
      await onChanged()
      setMessage('User access saved.')
    } catch (error) { setMessage(accessErrorMessage(error)) }
    finally { setBusy(false) }
  }

  return (
    <div className="grid gap-4 border-t border-[#e8e1d6] bg-[#fbf9f5] p-4">
      <label className="grid gap-1.5 text-sm font-black text-[#20242c]">Display name
        <Input value={displayName} disabled={!canManage || user.protectedOwner} onChange={(event) => setDisplayName(event.target.value)} />
      </label>
      <div className="grid gap-1.5">
        <p className="text-sm font-black text-[#20242c]">Roles</p>
        {canAssignRoles
          ? <RolePicker roles={roles} selected={roleIds} onChange={setRoleIds} disabled={!canManage || user.protectedOwner} />
          : <p className="rounded-md border border-[#ded8ce] bg-white p-3 text-xs leading-5 text-[#665d52]">{canViewRoles ? roleNames(user.roleIds, roles) : `${user.roleIds.length} assigned role${user.roleIds.length === 1 ? '' : 's'}. Role visibility is required to inspect assignments.`}</p>}
      </div>
      {user.protectedOwner ? <p className="rounded-md border border-[#ded8ce] bg-white p-3 text-xs leading-5 text-[#665d52]">The original owner is permanently protected and always retains unrestricted access.</p> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {message ? <p role={message.endsWith('saved.') ? 'status' : 'alert'} className="mr-auto text-sm font-semibold text-[#665d52]">{message}</p> : null}
        {!user.protectedOwner && canManage ? <>
          <ConfirmSettingsAction
            title="Revoke active sessions?"
            description={`Every active session for ${user.displayName} will be signed out.`}
            actionLabel="Revoke sessions"
            onConfirm={async () => { await accessApi.revokeUserSessions(user.id); await onChanged() }}
          />
          <ConfirmSettingsAction
            destructive
            title="Delete user?"
            description={`Delete ${user.displayName}, their identities, role assignments, and active sessions. This cannot be undone.`}
            actionLabel="Delete user"
            onConfirm={async () => { await accessApi.deleteUser(user.id); await onChanged() }}
          />
        </> : null}
        <Button disabled={!canManage || user.protectedOwner || !dirty || busy || !displayName.trim()} onClick={() => void save()}><Shield />{busy ? 'Saving…' : 'Save access'}</Button>
      </div>
    </div>
  )
}

export function UsersTab({
  users,
  roles,
  canManage,
  canViewRoles,
  canAssignRoles,
  onChanged,
}: {
  users: AccessUser[]
  roles: AccessRole[]
  canManage: boolean
  canViewRoles: boolean
  canAssignRoles: boolean
  onChanged: () => Promise<unknown>
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null)

  return (
    <SettingsSection title="Users" description="Active accounts, login identities, and their effective global roles.">
      {users.map((user) => {
        const expanded = expandedId === user.id
        return (
          <div key={user.id} className="border-b border-[#e8e1d6] last:border-b-0">
            <button type="button" onClick={() => setExpandedId(expanded ? null : user.id)} className="grid w-full gap-3 p-4 text-left hover:bg-[#fbf9f5] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <span className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-[#eef1f2] text-[#38434d]"><UserRound className="size-4" /></span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-black text-[#20242c]">{user.displayName}</span>
                    {user.protectedOwner ? <Badge variant="secondary"><Shield />Owner</Badge> : null}
                    {!user.active ? <Badge variant="destructive"><UserX />Inactive</Badge> : null}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-[#756d62]">@{user.username}{user.email ? ` · ${user.email}` : ''}</span>
                  <span className="mt-1 block text-xs font-semibold text-[#554b40]">{canViewRoles ? roleNames(user.roleIds, roles) : `${user.roleIds.length} assigned role${user.roleIds.length === 1 ? '' : 's'}`}</span>
                </span>
              </span>
              <span className="flex items-center gap-2 sm:justify-end">
                {user.identityMethods.local ? <Badge variant="outline"><KeyRound />Local</Badge> : null}
                {user.identityMethods.oidc ? <Badge variant="outline">OIDC</Badge> : null}
                <MoreHorizontal className="size-4 text-[#756d62]" />
              </span>
            </button>
            {expanded ? <UserEditor user={user} roles={roles} canManage={canManage} canViewRoles={canViewRoles} canAssignRoles={canAssignRoles} onChanged={onChanged} /> : null}
          </div>
        )
      })}
      {!users.length ? <p className="p-4 text-sm text-[#756d62]">No users are configured.</p> : null}
    </SettingsSection>
  )
}
