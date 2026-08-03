import { describe, expect, it } from 'vitest'
import { AuthorizationService } from './authorization-service.mjs'

function state() {
  return {
    accounts: [
      { id: 1, protectedOwner: true, active: true },
      { id: 2, protectedOwner: false, active: true },
      { id: 3, protectedOwner: false, active: false },
    ],
    roles: [
      { id: 3, active: true },
      { id: 4, active: true },
      { id: 5, active: false },
    ],
    accountRoles: [
      { id: 1, accountId: 2, roleId: 3, scopeKind: 'global', scopeId: 0 },
      { id: 2, accountId: 2, roleId: 4, scopeKind: 'global', scopeId: 0 },
      { id: 3, accountId: 3, roleId: 5, scopeKind: 'global', scopeId: 0 },
    ],
    rolePermissions: [
      { id: 1, roleId: 3, permissionId: 201 },
      { id: 2, roleId: 4, permissionId: 301 },
      { id: 3, roleId: 5, permissionId: 904 },
    ],
  }
}

describe('AuthorizationService', () => {
  it('combines roles and protects the owner', async () => {
    const data = state()
    const service = await AuthorizationService.create({ readState: () => data })
    await expect(service.authorize(2, 'inventory.view')).resolves.toEqual({ allowed: true })
    await expect(service.authorize(2, 'canvas.view')).resolves.toEqual({ allowed: true })
    await expect(service.authorize(2, 'roles.manage')).resolves.toEqual({ allowed: false })
    await expect(service.authorize(1, 'roles.manage')).resolves.toEqual({ allowed: true })
    await expect(service.authorize(3, 'roles.manage')).resolves.toEqual({ allowed: false })
  })

  it('keeps the active policy when a rebuild fails', async () => {
    const service = await AuthorizationService.create({ readState: state })
    const invalid = state()
    invalid.rolePermissions.push({ id: 4, roleId: 3, permissionId: 999999 })
    await expect(service.rebuild(invalid)).rejects.toThrow('unknown permission')
    await expect(service.authorize(2, 'inventory.view')).resolves.toEqual({ allowed: true })
  })
})
