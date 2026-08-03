import { newEnforcer } from 'casbin'
import { PERMISSION_BY_ID, permissionByKey } from './permission-catalog.mjs'
import {
  accountSubject,
  authorizationDomain,
  createAuthorizationModel,
  permissionTarget,
  roleSubject,
} from './authorization-model.mjs'

function activeRecord(record) {
  return record.active !== false
}

export class AuthorizationService {
  constructor({ readState, log = console }) {
    this.readState = readState
    this.log = log
    this.activeEnforcer = null
    this.permissionCache = new Map()
  }

  static async create(options) {
    const service = new AuthorizationService(options)
    await service.rebuild()
    return service
  }

  async compile(state) {
    const enforcer = await newEnforcer(createAuthorizationModel())
    const accounts = new Map(state.accounts.filter(activeRecord).map((account) => [account.id, account]))
    const roles = new Map(state.roles.filter(activeRecord).map((role) => [role.id, role]))

    for (const assignment of state.accountRoles) {
      if (!accounts.has(assignment.accountId) || !roles.has(assignment.roleId)) continue
      const domain = authorizationDomain({ kind: assignment.scopeKind, id: assignment.scopeId })
      await enforcer.addGroupingPolicy(accountSubject(assignment.accountId), roleSubject(assignment.roleId), domain)
    }

    for (const relation of state.rolePermissions) {
      if (!roles.has(relation.roleId)) continue
      const permission = PERMISSION_BY_ID.get(relation.permissionId)
      if (!permission) throw new Error(`Role permission ${relation.id} references unknown permission ${relation.permissionId}.`)
      const { object, action } = permissionTarget(permission.key)
      await enforcer.addPolicy(roleSubject(relation.roleId), authorizationDomain(), object, action)
    }

    const owner = state.accounts.find((account) => account.protectedOwner === true && activeRecord(account))
    if (owner) await enforcer.addPolicy(accountSubject(owner.id), authorizationDomain(), '*', '*')
    const permissionCache = new Map()
    for (const account of accounts.values()) {
      const keys = []
      for (const permission of PERMISSION_BY_ID.values()) {
        const { object, action } = permissionTarget(permission.key)
        if (await enforcer.enforce(accountSubject(account.id), authorizationDomain(), object, action)) keys.push(permission.key)
      }
      permissionCache.set(account.id, Object.freeze(keys))
    }
    return { enforcer, permissionCache }
  }

  async rebuild(nextState = null) {
    const state = structuredClone(nextState ?? this.readState())
    const candidate = await this.compile(state)
    this.activeEnforcer = candidate.enforcer
    this.permissionCache = candidate.permissionCache
  }

  async authorize(accountId, permissionKey, scope = null) {
    permissionByKey(permissionKey)
    if (!this.activeEnforcer) return { allowed: false }
    const { object, action } = permissionTarget(permissionKey)
    const allowed = await this.activeEnforcer.enforce(accountSubject(accountId), authorizationDomain(scope), object, action)
    return { allowed }
  }

  async permissionsFor(accountId, scope = null) {
    if (scope === null) return [...(this.permissionCache.get(accountId) ?? [])]
    const checks = await Promise.all([...PERMISSION_BY_ID.values()].map(async (permission) => ({
      key: permission.key,
      allowed: (await this.authorize(accountId, permission.key, scope)).allowed,
    })))
    return checks.filter((check) => check.allowed).map((check) => check.key)
  }

  permissionsForSync(accountId) {
    return [...(this.permissionCache.get(accountId) ?? [])]
  }

  requirePermission(permissionKey) {
    permissionByKey(permissionKey)
    return async (request, response, next) => {
      try {
        const accountId = request.authentication?.account?.id
        if (!accountId) return response.status(401).json({ message: 'Authentication is required.', code: 'authentication-required' })
        const { allowed } = await this.authorize(accountId, permissionKey)
        if (!allowed) {
          return response.status(403).json({
            message: 'You do not have permission to perform this action.',
            code: 'permission-denied',
            permission: permissionKey,
          })
        }
        next()
      } catch (error) {
        next(error)
      }
    }
  }
}
