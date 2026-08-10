import { BUILT_IN_ROLE_DEFINITIONS } from '../auth/permission-catalog.mjs'
import { assertAuthenticationStoreShape } from '../auth/model.mjs'

export function migrateSchema27To28(authentication) {
  const migrated = structuredClone(authentication)
  const existing = new Set(migrated.rolePermissions.map((relation) => `${relation.roleId}:${relation.permissionId}`))
  let createdRelationships = 0
  for (const role of BUILT_IN_ROLE_DEFINITIONS) {
    for (const permissionId of role.permissionIds) {
      const key = `${role.id}:${permissionId}`
      if (existing.has(key)) continue
      migrated.rolePermissions.push({
        id: migrated.nextRolePermissionId++,
        roleId: role.id,
        permissionId,
      })
      existing.add(key)
      createdRelationships += 1
    }
  }
  assertAuthenticationStoreShape(migrated)
  return {
    authentication: migrated,
    summary: {
      createdNotificationPermissionRelationships: createdRelationships,
      preservedCustomRoles: migrated.roles.filter((role) => !role.builtIn).length,
    },
  }
}
