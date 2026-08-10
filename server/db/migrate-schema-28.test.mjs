import { describe, expect, it } from 'vitest'
import { createAuthenticationStore } from '../auth/model.mjs'
import { permissionByKey } from '../auth/permission-catalog.mjs'
import { migrateSchema27To28 } from './migrate-schema-28.mjs'

describe('schema 27 to 28 migration', () => {
  it('adds notification permissions to built-in roles idempotently', () => {
    const authentication = createAuthenticationStore()
    authentication.rolePermissions = authentication.rolePermissions.filter((relation) => (
      ![permissionByKey('notifications.view').id, permissionByKey('notifications.manage').id].includes(relation.permissionId)
    ))
    const first = migrateSchema27To28(authentication)
    const second = migrateSchema27To28(first.authentication)
    expect(first.summary.createdNotificationPermissionRelationships).toBeGreaterThan(0)
    expect(second.summary.createdNotificationPermissionRelationships).toBe(0)
  })
})
