import { and, asc, eq, isNull } from 'drizzle-orm'
import { permissions, rolePermissions, roles, sessions, userRoles, users } from '../schema/index.ts'
import { assertPositiveId, type RepositoryContext } from './repository-context.ts'

export function createAuthRepository({ db, now }: RepositoryContext) {
  function getUser(userId: number) {
    return db.select().from(users).where(eq(users.id, assertPositiveId(userId, 'User ID'))).get() ?? null
  }

  function listUserPermissions(userId: number, scopeKind = 'global', scopeId = 0) {
    assertPositiveId(userId, 'User ID')
    return db.selectDistinct({ key: permissions.permissionKey })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(and(
        eq(userRoles.userId, userId),
        eq(userRoles.scopeKind, scopeKind),
        eq(userRoles.scopeId, scopeId),
        eq(roles.active, true),
      )).orderBy(asc(permissions.permissionKey)).all().map((row) => row.key)
  }

  function revokeSession(sessionId: number) {
    const result = db.update(sessions).set({ revokedAtMs: now() })
      .where(and(eq(sessions.id, assertPositiveId(sessionId, 'Session ID')), isNull(sessions.revokedAtMs))).run()
    if (result.changes !== 1) throw new Error(`Active session ${sessionId} was not found.`)
  }

  return { getUser, listUserPermissions, revokeSession }
}

export type AuthRepository = ReturnType<typeof createAuthRepository>
