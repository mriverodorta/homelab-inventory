import { describe, expect, it } from 'vitest'
import {
  BUILT_IN_ROLE_DEFINITIONS,
  PERMISSIONS,
  REQUIRED_WORKSPACE_PERMISSION_KEYS,
  permissionKeysForBuiltInRole,
} from './permission-catalog.mjs'

describe('permission catalog', () => {
  it('uses permanent unique numeric IDs and stable keys', () => {
    expect(PERMISSIONS.every((permission) => Number.isSafeInteger(permission.id) && permission.id > 0)).toBe(true)
    expect(new Set(PERMISSIONS.map((permission) => permission.id)).size).toBe(PERMISSIONS.length)
    expect(new Set(PERMISSIONS.map((permission) => permission.key)).size).toBe(PERMISSIONS.length)
  })

  it('defines conservative built-in role matrices', () => {
    expect(permissionKeysForBuiltInRole('owner')).toEqual(expect.arrayContaining(PERMISSIONS.map((permission) => permission.key)))
    expect(permissionKeysForBuiltInRole('viewer')).toContain('workspace.view')
    expect(permissionKeysForBuiltInRole('viewer')).not.toContain('workspace.edit')
    expect(permissionKeysForBuiltInRole('editor')).not.toContain('roles.manage')
    expect(permissionKeysForBuiltInRole('editor')).not.toContain('inventory.metadata.manage')
    expect(permissionKeysForBuiltInRole('owner')).toContain('inventory.metadata.manage')
    expect(permissionKeysForBuiltInRole('administrator')).toContain('inventory.metadata.manage')
    expect(permissionKeysForBuiltInRole('administrator')).toContain('users.manage')
    expect(new Set(BUILT_IN_ROLE_DEFINITIONS.map((role) => role.id)).size).toBe(BUILT_IN_ROLE_DEFINITIONS.length)
  })


  it('defines the immutable read baseline required to render the application shell', () => {
    expect(REQUIRED_WORKSPACE_PERMISSION_KEYS).toEqual([
      'workspace.view',
      'inventory.view',
      'canvas.view',
      'project.view',
      'authentication.view',
    ])
  })
})
