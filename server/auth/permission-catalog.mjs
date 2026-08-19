const definePermission = (id, key, group, description, risk = 'standard') => Object.freeze({
  id,
  key,
  group,
  description,
  risk,
})

export const PERMISSIONS = Object.freeze([
  definePermission(101, 'workspace.view', 'workspace', 'Open the workspace and read shared equipment state.'),
  definePermission(102, 'workspace.edit', 'workspace', 'Modify general workspace state.'),
  definePermission(201, 'inventory.view', 'inventory', 'Read inventory records.'),
  definePermission(202, 'inventory.create', 'inventory', 'Create inventory records.'),
  definePermission(203, 'inventory.edit', 'inventory', 'Modify inventory records.'),
  definePermission(204, 'inventory.archive', 'inventory', 'Archive and restore eligible inventory records.', 'elevated'),
  definePermission(205, 'inventory.delete', 'inventory', 'Permanently remove eligible inventory records.', 'destructive'),
  definePermission(206, 'inventory.metadata.manage', 'inventory', 'Configure installation-wide custom fields and tags.', 'elevated'),
  definePermission(301, 'canvas.view', 'canvas', 'View the project canvas.'),
  definePermission(302, 'canvas.edit', 'canvas', 'Place, move, and remove canvas equipment.'),
  definePermission(303, 'connections.edit', 'canvas', 'Create, route, modify, and remove connections.'),
  definePermission(401, 'project.view', 'project', 'Read project configuration and audit state.'),
  definePermission(402, 'project.settings.manage', 'project', 'Modify shared project settings and policies.', 'elevated'),
  definePermission(501, 'registry.view', 'registry', 'Read registry catalog and link state.'),
  definePermission(502, 'registry.manage', 'registry', 'Configure registry sources, links, and catalog updates.', 'elevated'),
  definePermission(503, 'registry.contribute', 'registry', 'Enroll and send sanitized catalog contributions.', 'elevated'),
  definePermission(601, 'backups.view', 'backups', 'View backup status and history.'),
  definePermission(602, 'backups.create', 'backups', 'Create backups.'),
  definePermission(603, 'backups.download', 'backups', 'Download backup archives.', 'elevated'),
  definePermission(604, 'backups.delete', 'backups', 'Delete backup archives.', 'destructive'),
  definePermission(605, 'backups.schedule', 'backups', 'Configure scheduled backup retention.', 'elevated'),
  definePermission(606, 'backups.restore', 'backups', 'Replace application data from a backup.', 'destructive'),
  definePermission(701, 'agents.view', 'agents', 'View agent status and enrollment details.'),
  definePermission(702, 'agents.manage', 'agents', 'Create, revoke, and configure agent enrollment.', 'elevated'),
  definePermission(801, 'audit.view', 'audit', 'View compatibility and security audit information.'),
  definePermission(802, 'audit.manage', 'audit', 'Acknowledge and manage audit findings.'),
  definePermission(901, 'users.view', 'access', 'View users and invitations.', 'elevated'),
  definePermission(902, 'users.manage', 'access', 'Manage non-owner users and invitations.', 'elevated'),
  definePermission(903, 'roles.view', 'access', 'View roles and permission assignments.', 'elevated'),
  definePermission(904, 'roles.manage', 'access', 'Manage custom roles and assignments.', 'elevated'),
  definePermission(1001, 'authentication.view', 'security', 'View authentication configuration and identity methods.', 'elevated'),
  definePermission(1002, 'authentication.manage', 'security', 'Configure local and OIDC authentication.', 'elevated'),
  definePermission(1003, 'security.events.view', 'security', 'View authentication and authorization security events.', 'elevated'),
  definePermission(1101, 'updates.view', 'updates', 'View application update status.'),
  definePermission(1102, 'updates.manage', 'updates', 'Change update channel and update preferences.', 'elevated'),
  definePermission(1201, 'notifications.view', 'notifications', 'View notification configuration, incidents, and delivery history.'),
  definePermission(1202, 'notifications.manage', 'notifications', 'Configure notification policies, destinations, acknowledgements, and retries.', 'elevated'),
])

export const PERMISSION_BY_ID = new Map(PERMISSIONS.map((permission) => [permission.id, permission]))
export const PERMISSION_BY_KEY = new Map(PERMISSIONS.map((permission) => [permission.key, permission]))

export const REQUIRED_WORKSPACE_PERMISSION_KEYS = Object.freeze([
  'workspace.view',
  'inventory.view',
  'canvas.view',
  'project.view',
  'authentication.view',
])

export const REQUIRED_WORKSPACE_PERMISSION_IDS = Object.freeze(
  REQUIRED_WORKSPACE_PERMISSION_KEYS.map((key) => PERMISSION_BY_KEY.get(key).id),
)

const READ_PERMISSIONS = PERMISSIONS.filter((permission) => permission.key.endsWith('.view')).map((permission) => permission.id)
const EDITOR_KEYS = new Set([
  'workspace.view', 'workspace.edit',
  'inventory.view', 'inventory.create', 'inventory.edit', 'inventory.archive',
  'canvas.view', 'canvas.edit', 'connections.edit',
  'project.view',
  'registry.view', 'registry.contribute',
  'backups.view', 'backups.create', 'backups.download',
  'agents.view', 'agents.manage',
  'audit.view', 'audit.manage',
  'updates.view',
  'notifications.view',
])

export const BUILT_IN_ROLE_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 1, key: 'owner', name: 'Owner', description: 'Protected installation owner with unrestricted access.', permissionIds: PERMISSIONS.map((permission) => permission.id) }),
  Object.freeze({ id: 2, key: 'administrator', name: 'Administrator', description: 'Full day-to-day administration without owner recovery authority.', permissionIds: PERMISSIONS.map((permission) => permission.id) }),
  Object.freeze({ id: 3, key: 'editor', name: 'Editor', description: 'Operate inventory, canvas, connections, agents, and contributions.', permissionIds: PERMISSIONS.filter((permission) => EDITOR_KEYS.has(permission.key)).map((permission) => permission.id) }),
  Object.freeze({ id: 4, key: 'viewer', name: 'Viewer', description: 'Read-only access to workspace information.', permissionIds: READ_PERMISSIONS }),
])

const BUILT_IN_ROLE_BY_KEY = new Map(BUILT_IN_ROLE_DEFINITIONS.map((role) => [role.key, role]))

export function permissionByKey(key) {
  const permission = PERMISSION_BY_KEY.get(key)
  if (!permission) throw new Error(`Unknown permission: ${key}`)
  return permission
}

export function permissionKeysForBuiltInRole(key) {
  const role = BUILT_IN_ROLE_BY_KEY.get(key)
  if (!role) throw new Error(`Unknown built-in role: ${key}`)
  return role.permissionIds.map((id) => PERMISSION_BY_ID.get(id).key)
}

export function createBuiltInAuthorizationRecords(timestamp = new Date().toISOString()) {
  const roles = BUILT_IN_ROLE_DEFINITIONS.map((role) => ({
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    builtIn: true,
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  }))
  let nextId = 1
  const rolePermissions = BUILT_IN_ROLE_DEFINITIONS.flatMap((role) => role.permissionIds.map((permissionId) => ({
    id: nextId++,
    roleId: role.id,
    permissionId,
  })))
  return { roles, rolePermissions, nextRoleId: 5, nextRolePermissionId: nextId }
}
