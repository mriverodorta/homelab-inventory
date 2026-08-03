import { useEffect, useState, type ReactNode } from 'react'
import { Copy, LockKeyhole, Plus, Save, Shield, Trash2 } from 'lucide-react'
import { accessErrorMessage, groupPermissions } from '@/components/settings/access/access-model'
import { ConfirmSettingsAction, SettingsSection } from '@/components/settings/settings-primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { accessApi } from '@/lib/access-api'
import type { AccessPermission, AccessRole } from '@/types/access'

function PermissionMatrix({ permissions, selected, onChange, disabled }: { permissions: AccessPermission[]; selected: number[]; onChange: (ids: number[]) => void; disabled: boolean }) {
  return (
    <div className="grid gap-3">
      {groupPermissions(permissions).map(([group, entries]) => (
        <section key={group} className="overflow-hidden rounded-lg border border-[#ded8ce] bg-white">
          <h3 className="border-b border-[#e8e1d6] bg-[#f7f2e9] px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-[#665d52]">{group}</h3>
          {entries.map((permission) => {
            const checked = permission.requiredForWorkspace || selected.includes(permission.id)
            const permissionDisabled = disabled || permission.requiredForWorkspace
            return (
              <label key={permission.id} className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 border-b border-[#eee8df] p-3 last:border-b-0 hover:bg-[#fbf9f5]">
                <Checkbox checked={checked} disabled={permissionDisabled} onCheckedChange={(next) => onChange(next === true ? [...selected, permission.id].sort((a, b) => a - b) : selected.filter((id) => id !== permission.id))} />
                <span className="min-w-0"><span className="block font-mono text-xs font-bold text-[#20242c]">{permission.key}</span><span className="mt-1 block text-xs leading-4 text-[#756d62]">{permission.description}</span></span>
                {permission.requiredForWorkspace ? <Badge variant="secondary">Required</Badge> : permission.risk !== 'standard' ? <Badge variant={permission.risk === 'destructive' ? 'destructive' : 'secondary'}>{permission.risk}</Badge> : null}
              </label>
            )
          })}
        </section>
      ))}
    </div>
  )
}

function RoleDialog({ role, permissions, canManage, onSaved, trigger }: { role?: AccessRole; permissions: AccessPermission[]; canManage: boolean; onSaved: () => Promise<unknown>; trigger: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(role?.name ?? '')
  const [description, setDescription] = useState(role?.description ?? '')
  const [permissionIds, setPermissionIds] = useState(role?.permissionIds ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const readOnly = role?.builtIn === true || !canManage

  useEffect(() => {
    if (!open) return
    setName(role?.name ?? '')
    setDescription(role?.description ?? '')
    setPermissionIds(role?.permissionIds ?? [])
    setError(null)
  }, [open, role])

  async function save() {
    setBusy(true); setError(null)
    try {
      if (role) {
        await accessApi.updateRole(role.id, { name: name.trim(), description: description.trim() })
        await accessApi.setRolePermissions(role.id, permissionIds)
      } else {
        await accessApi.createRole({ name: name.trim(), description: description.trim(), permissionIds })
      }
      await onSaved(); setOpen(false)
    } catch (caught) { setError(accessErrorMessage(caught)) }
    finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="grid max-h-[min(880px,calc(100dvh-2rem))] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-3xl">
        <DialogHeader><DialogTitle>{role ? role.name : 'Create custom role'}</DialogTitle><DialogDescription>{role?.builtIn ? 'Built-in roles are defined by the application and cannot be changed.' : 'Roles combine code-defined permissions into a reusable access policy.'}</DialogDescription></DialogHeader>
        <div className="min-h-0 overflow-y-auto overscroll-contain pr-1">
          <div className="grid gap-4 pb-2">
            <label className="grid gap-1.5 text-sm font-black">Role name<Input value={name} disabled={readOnly} onChange={(event) => setName(event.target.value)} /></label>
            <label className="grid gap-1.5 text-sm font-black">Description<textarea className="min-h-20 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50" value={description} disabled={readOnly} onChange={(event) => setDescription(event.target.value)} /></label>
            <PermissionMatrix permissions={permissions} selected={permissionIds} onChange={setPermissionIds} disabled={readOnly} />
            {error ? <p role="alert" className="rounded-md border border-[#dfb3a5] bg-[#fff4ee] p-3 text-sm font-semibold text-[#7a2c1d]">{error}</p> : null}
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{readOnly ? 'Close' : 'Cancel'}</Button>{!readOnly ? <Button onClick={() => void save()} disabled={busy || !name.trim()}><Save />{busy ? 'Saving…' : 'Save role'}</Button> : null}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RolesTab({ roles, permissions, canManage, onChanged }: { roles: AccessRole[]; permissions: AccessPermission[]; canManage: boolean; onChanged: () => Promise<unknown> }) {
  const [message, setMessage] = useState<string | null>(null)

  async function duplicate(role: AccessRole) {
    setMessage(null)
    try { await accessApi.duplicateRole(role.id, { name: `${role.name} copy` }); await onChanged(); setMessage(`${role.name} duplicated.`) }
    catch (error) { setMessage(accessErrorMessage(error)) }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-lg font-black text-[#20242c]">Roles</h2><p className="mt-1 max-w-2xl text-sm leading-5 text-[#756d62]">Permissions are fixed by the application. Custom roles let you combine them without changing code.</p></div>
        {canManage ? <RoleDialog permissions={permissions} canManage onSaved={onChanged} trigger={<Button><Plus />Create role</Button>} /> : null}
      </div>
      {message ? <p role="status" className="rounded-md border border-[#ded8ce] bg-white p-3 text-sm font-semibold text-[#665d52]">{message}</p> : null}
      <SettingsSection title="Global roles">
        {roles.map((role) => (
          <div key={role.id} className="grid gap-3 border-b border-[#e8e1d6] p-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[#eef1f2] text-[#38434d]">{role.builtIn ? <LockKeyhole className="size-4" /> : <Shield className="size-4" />}</span>
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-black text-[#20242c]">{role.name}</p>{role.builtIn ? <Badge variant="secondary">Built in</Badge> : <Badge variant="outline">Custom</Badge>}{!role.active ? <Badge variant="destructive">Inactive</Badge> : null}</div><p className="mt-1 text-xs leading-5 text-[#756d62]">{role.description}</p><p className="mt-1 text-xs font-semibold text-[#554b40]">{role.permissionIds.length} permissions</p></div>
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <RoleDialog role={role} permissions={permissions} canManage={canManage} onSaved={onChanged} trigger={<Button variant="outline">{role.builtIn || !canManage ? 'View' : 'Edit'}</Button>} />
              {canManage ? <Button variant="outline" onClick={() => void duplicate(role)}><Copy />Duplicate</Button> : null}
              {canManage && !role.builtIn ? <ConfirmSettingsAction destructive title="Delete role?" description={`${role.name} can be deleted only when no users or pending invitations depend on it.`} actionLabel="Delete" onConfirm={async () => { await accessApi.deleteRole(role.id); await onChanged() }} /> : null}
            </div>
          </div>
        ))}
        {!roles.length ? <div className="grid place-items-center gap-2 p-8 text-center"><Trash2 className="size-5 text-[#8a8175]" /><p className="text-sm text-[#756d62]">No roles are available.</p></div> : null}
      </SettingsSection>
    </div>
  )
}
