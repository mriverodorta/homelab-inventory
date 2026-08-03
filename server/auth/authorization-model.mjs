import { newModel } from 'casbin'

export const GLOBAL_AUTHORIZATION_DOMAIN = 'global:0'

export function createAuthorizationModel() {
  const model = newModel()
  model.addDef('r', 'r', 'sub, dom, obj, act')
  model.addDef('p', 'p', 'sub, dom, obj, act')
  model.addDef('g', 'g', '_, _, _')
  model.addDef('e', 'e', 'some(where (p.eft == allow))')
  model.addDef('m', 'm', 'g(r.sub, p.sub, r.dom) && r.dom == p.dom && (p.obj == "*" || r.obj == p.obj) && (p.act == "*" || r.act == p.act)')
  return model
}

export function permissionTarget(permissionKey) {
  const separator = permissionKey.lastIndexOf('.')
  if (separator <= 0 || separator === permissionKey.length - 1) throw new Error(`Invalid permission key: ${permissionKey}`)
  return { object: permissionKey.slice(0, separator), action: permissionKey.slice(separator + 1) }
}

export function accountSubject(accountId) {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new Error('Account ID must be a positive safe integer.')
  return `account:${accountId}`
}

export function roleSubject(roleId) {
  if (!Number.isSafeInteger(roleId) || roleId <= 0) throw new Error('Role ID must be a positive safe integer.')
  return `role:${roleId}`
}

export function authorizationDomain(scope = null) {
  if (scope == null || (scope.kind === 'global' && scope.id === 0)) return GLOBAL_AUTHORIZATION_DOMAIN
  throw new Error('Unsupported authorization scope.')
}
