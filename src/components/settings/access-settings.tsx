import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldAlert, UsersRound } from 'lucide-react'
import { InvitationsTab } from '@/components/settings/access/invitations-tab'
import { RolesTab } from '@/components/settings/access/roles-tab'
import { UsersTab } from '@/components/settings/access/users-tab'
import { SettingsSection } from '@/components/settings/settings-primitives'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/hooks/use-auth'
import { accessApi } from '@/lib/access-api'

const ACCESS_QUERY_KEY = ['access'] as const

export function AccessSettings() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const permissions = new Set(auth.status?.permissions ?? [])
  const canViewUsers = permissions.has('users.view')
  const canManageUsers = permissions.has('users.manage')
  const canViewRoles = permissions.has('roles.view')
  const canManageRoles = permissions.has('roles.manage')
  const roles = useQuery({ queryKey: [...ACCESS_QUERY_KEY, 'roles'], queryFn: accessApi.roles, enabled: canViewRoles })
  const permissionCatalog = useQuery({ queryKey: [...ACCESS_QUERY_KEY, 'permissions'], queryFn: accessApi.permissions, enabled: canViewRoles })
  const users = useQuery({ queryKey: [...ACCESS_QUERY_KEY, 'users'], queryFn: accessApi.users, enabled: canViewUsers })
  const invitations = useQuery({ queryKey: [...ACCESS_QUERY_KEY, 'invitations'], queryFn: accessApi.invitations, enabled: canViewUsers })

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ACCESS_QUERY_KEY })
  }

  if (!canViewUsers && !canViewRoles) {
    return <SettingsSection title="Access" description="User and role administration is restricted."><div className="flex items-start gap-3 p-4"><ShieldAlert className="mt-0.5 size-4" /><p className="text-sm leading-5 text-[#756d62]">Your roles do not include permission to view access administration.</p></div></SettingsSection>
  }

  const queryError = roles.error || permissionCatalog.error || users.error || invitations.error
  if (queryError) {
    return <SettingsSection title="Access" description="User and role administration."><div className="flex items-start gap-3 p-4 text-[#7a2c1d]"><ShieldAlert className="mt-0.5 size-4" /><p role="alert" className="text-sm font-semibold">{queryError.message}</p></div></SettingsSection>
  }

  const loading = (canViewRoles && (roles.isPending || permissionCatalog.isPending))
    || (canViewUsers && (users.isPending || invitations.isPending))
  if (loading) return <div className="grid min-h-52 place-items-center text-sm font-bold text-[#756d62]">Loading access policy…</div>

  const roleRows = roles.data?.roles ?? []
  const tabs = [canViewUsers ? 'users' : null, canViewUsers ? 'invitations' : null, canViewRoles ? 'roles' : null].filter(Boolean) as string[]

  return (
    <div className="grid gap-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-[#20242c] text-white"><UsersRound className="size-5" /></span>
        <div><h2 className="text-xl font-black text-[#20242c]">Access</h2><p className="mt-1 max-w-2xl text-sm leading-5 text-[#756d62]">Invite people, assign global roles, and compose custom permission sets. The original owner remains permanently protected.</p></div>
      </div>
      <Tabs defaultValue={tabs[0]}>
        <TabsList variant="line">
          {canViewUsers ? <TabsTrigger value="users">Users</TabsTrigger> : null}
          {canViewUsers ? <TabsTrigger value="invitations">Invitations</TabsTrigger> : null}
          {canViewRoles ? <TabsTrigger value="roles">Roles</TabsTrigger> : null}
        </TabsList>
        {canViewUsers ? <TabsContent value="users" className="pt-4"><UsersTab users={users.data?.users ?? []} roles={roleRows} canManage={canManageUsers} canViewRoles={canViewRoles} canAssignRoles={canManageUsers && canViewRoles} onChanged={refresh} /></TabsContent> : null}
        {canViewUsers ? <TabsContent value="invitations" className="pt-4"><InvitationsTab invitations={invitations.data?.invitations ?? []} roles={roleRows} canManage={canManageUsers} canViewRoles={canViewRoles} canAssignRoles={canManageUsers && canViewRoles} onChanged={refresh} /></TabsContent> : null}
        {canViewRoles ? <TabsContent value="roles" className="pt-4"><RolesTab roles={roleRows} permissions={permissionCatalog.data?.permissions ?? []} canManage={canManageRoles} onChanged={refresh} /></TabsContent> : null}
      </Tabs>
    </div>
  )
}
