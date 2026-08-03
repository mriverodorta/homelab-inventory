import { expect, test } from 'bun:test'
import { AuthorizationService } from './authorization-service.mjs'

test('Casbin remains server-only and fast under Bun', async () => {
  const state = {
    accounts: [{ id: 1, protectedOwner: false, active: true }],
    roles: [{ id: 3, active: true }],
    accountRoles: [{ id: 1, accountId: 1, roleId: 3, scopeKind: 'global', scopeId: 0 }],
    rolePermissions: [{ id: 1, roleId: 3, permissionId: 201 }],
  }
  const service = await AuthorizationService.create({ readState: () => state })
  const startedAt = performance.now()
  for (let index = 0; index < 10_000; index += 1) {
    expect((await service.authorize(1, 'inventory.view')).allowed).toBe(true)
  }
  expect(performance.now() - startedAt).toBeLessThan(2_000)
})
