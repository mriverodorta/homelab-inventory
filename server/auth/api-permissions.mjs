import { deriveAuthenticationMode } from './model.mjs'
import { permissionByKey } from './permission-catalog.mjs'

const PUBLIC_ROUTES = [
  ['GET', /^\/api\/health\/?$/],
  ['GET', /^\/api\/auth\/status\/?$/],
  ['POST', /^\/api\/auth\/(?:setup|login|recovery\/reset)\/?$/],
  ['GET', /^\/api\/auth\/oidc\/(?:start|callback)\/?$/],
  ['GET', /^\/api\/auth\/invitations\/[^/]+\/?$/],
  ['POST', /^\/api\/auth\/invitations\/[^/]+\/activate-local\/?$/],
  ['GET', /^\/api\/demo\/session\/?$/],
  ['GET', /^\/api\/agent\/contracts\/current\/?$/],
  ['GET', /^\/api\/agent\/install\.sh\/?$/],
  ['GET', /^\/api\/agent\/releases\/current\/?$/],
  ['GET', /^\/api\/agent\/releases\/[^/]+\/.+$/],
  ['POST', /^\/api\/demo\/session\/(?:extend|expire)\/?$/],
]

const MACHINE_ROUTES = [
  ['POST', /^\/api\/agent\/servers\/[1-9]\d*\/(?:register|heartbeat)\/?$/],
  ['POST', /^\/api\/agent\/hosts\/(?:server|nas|pcBuild)\/[1-9]\d*\/(?:activate|heartbeats|hardware-snapshots)\/?$/],
]

const PROTECTED_ROUTES = [
  ['POST', /^\/api\/auth\/logout\/?$/, 'workspace.view'],
  ['PATCH', /^\/api\/auth\/settings\/?$/, 'authentication.manage'],
  ['POST', /^\/api\/auth\/password\/?$/, 'authentication.view'],
  ['POST', /^\/api\/auth\/identities\/local\/?$/, 'authentication.view'],
  ['GET', /^\/api\/auth\/sessions\/?$/, 'authentication.view'],
  ['DELETE', /^\/api\/auth\/sessions\/[1-9]\d*\/?$/, 'authentication.view'],
  ['GET', /^\/api\/auth\/events\/?$/, 'authentication.view'],

  ['GET', /^\/api\/access\/permissions\/?$/, 'roles.view'],
  ['GET', /^\/api\/access\/roles\/?$/, 'roles.view'],
  ['POST', /^\/api\/access\/roles\/?$/, 'roles.manage'],
  ['POST', /^\/api\/access\/roles\/[1-9]\d*\/duplicate\/?$/, 'roles.manage'],
  ['PATCH', /^\/api\/access\/roles\/[1-9]\d*\/?$/, 'roles.manage'],
  ['PUT', /^\/api\/access\/roles\/[1-9]\d*\/permissions\/?$/, 'roles.manage'],
  ['DELETE', /^\/api\/access\/roles\/[1-9]\d*\/?$/, 'roles.manage'],
  ['GET', /^\/api\/access\/users\/?$/, 'users.view'],
  ['PATCH', /^\/api\/access\/users\/[1-9]\d*\/?$/, 'users.manage'],
  ['PUT', /^\/api\/access\/users\/[1-9]\d*\/roles\/?$/, 'users.manage'],
  ['POST', /^\/api\/access\/users\/[1-9]\d*\/revoke-sessions\/?$/, 'users.manage'],
  ['DELETE', /^\/api\/access\/users\/[1-9]\d*\/?$/, 'users.manage'],
  ['GET', /^\/api\/access\/invitations\/?$/, 'users.view'],
  ['POST', /^\/api\/access\/invitations\/?$/, 'users.manage'],
  ['POST', /^\/api\/access\/invitations\/[1-9]\d*\/resend\/?$/, 'users.manage'],
  ['DELETE', /^\/api\/access\/invitations\/[1-9]\d*\/?$/, 'users.manage'],

  ['GET', /^\/api\/inventory(?:\/.*)?$/, 'inventory.view'],
  ['POST', /^\/api\/inventory\/items\/?$/, 'inventory.create'],
  ['POST', /^\/api\/projects\/[1-9]\d*\/inventory\/items\/?$/, 'inventory.create'],
  ['POST', /^\/api\/inventory\/items\/[^/]+\/[1-9]\d*\/scope\/?$/, 'inventory.edit'],
  ['GET', /^\/api\/projects\/[1-9]\d*\/inventory\/global-available\/?$/, 'inventory.view'],
  ['POST', /^\/api\/projects\/[1-9]\d*\/inventory\/[^/]+\/[1-9]\d*\/membership\/?$/, 'inventory.edit'],
  ['DELETE', /^\/api\/projects\/[1-9]\d*\/inventory\/[^/]+\/[1-9]\d*\/membership\/?$/, 'inventory.edit'],
  ['POST', /^\/api\/projects\/[1-9]\d*\/inventory\/[^/]+\/[1-9]\d*\/duplicate\/?$/, 'inventory.create'],
  ['POST', /^\/api\/inventory\/items\/[^/]+\/[1-9]\d*\/duplicate\/?$/, 'inventory.create'],
  ['POST', /^\/api\/inventory\/(?:dependencies|items\/nas\/[1-9]\d*\/power-configuration)\/?$/, 'inventory.edit'],
  ['PUT', /^\/api\/inventory\/items\/[^/]+\/[1-9]\d*\/?$/, 'inventory.edit'],
  ['PATCH', /^\/api\/inventory\/items\/[^/]+\/[1-9]\d*\/properties\/?$/, 'inventory.edit'],
  ['POST', /^\/api\/inventory\/(?:items\/[^/]+\/[1-9]\d*\/(?:archive|restore)|batch\/(?:archive|restore))\/?$/, 'inventory.archive'],
  ['DELETE', /^\/api\/inventory\/items\/[^/]+\/[1-9]\d*\/?$/, 'inventory.delete'],
  ['POST', /^\/api\/inventory\/batch\/delete\/?$/, 'inventory.delete'],

  ['GET', /^\/api\/project\/?$/, 'project.view'],
  ['GET', /^\/api\/projects\/archived\/?$/, 'project.view'],
  ['GET', /^\/api\/projects\/[1-9]\d*\/deletion-impact\/?$/, 'project.settings.manage'],
  ['GET', /^\/api\/projects(?:\/[1-9]\d*(?:\/workbook)?)?\/?$/, 'project.view'],
  ['GET', /^\/api\/projects\/[1-9]\d*\/systems(?:\/live|\/views|\/(?:server|nas|pcBuild)\/[1-9]\d*\/attention)?\/?$/, 'project.view'],
  ['POST', /^\/api\/projects\/[1-9]\d*\/systems\/views(?:\/[1-9]\d*\/default)?\/?$/, 'project.view'],
  ['PATCH', /^\/api\/projects\/[1-9]\d*\/systems\/views\/[1-9]\d*\/?$/, 'project.view'],
  ['DELETE', /^\/api\/projects\/[1-9]\d*\/systems\/views\/[1-9]\d*\/?$/, 'project.view'],
  ['POST', /^\/api\/projects\/?$/, 'project.settings.manage'],
  ['PATCH', /^\/api\/projects\/[1-9]\d*\/?$/, 'project.settings.manage'],
  ['DELETE', /^\/api\/projects\/[1-9]\d*\/?$/, 'project.settings.manage'],
  ['DELETE', /^\/api\/projects\/[1-9]\d*\/permanent\/?$/, 'project.settings.manage'],
  ['POST', /^\/api\/projects\/[1-9]\d*\/restore\/?$/, 'project.settings.manage'],
  ['GET', /^\/api\/projects\/[1-9]\d*\/workspaces\/[1-9]\d*\/?$/, 'canvas.view'],
  ['PUT', /^\/api\/projects\/[1-9]\d*\/workspaces\/[1-9]\d*\/?$/, 'workspace.edit'],
  ['POST', /^\/api\/projects\/[1-9]\d*\/workspaces\/?$/, 'project.settings.manage'],
  ['PATCH', /^\/api\/projects\/[1-9]\d*\/workspaces\/[1-9]\d*\/?$/, 'project.settings.manage'],
  ['PATCH', /^\/api\/projects\/[1-9]\d*\/workspaces\/[1-9]\d*\/configuration\/?$/, 'workspace.edit'],
  ['DELETE', /^\/api\/projects\/[1-9]\d*\/workspaces\/[1-9]\d*\/?$/, 'project.settings.manage'],
  ['PUT', /^\/api\/projects\/[1-9]\d*\/(?:workspaces\/reorder|default-workspace)\/?$/, 'project.settings.manage'],
  ['GET', /^\/api\/bootstrap\/?$/, 'workspace.view'],
  ['GET', /^\/api\/events\/?$/, 'workspace.view'],
  ['PUT', /^\/api\/project\/?$/, 'project.settings.manage'],
  ['GET', /^\/api\/engine\/(?:snapshot|events)\/?$/, 'canvas.view'],
  // The command body receives operation-specific authorization in engine-routes.
  ['POST', /^\/api\/engine\/commands\/?$/, 'workspace.view'],
  ['GET', /^\/api\/routing-cache\/?$/, 'canvas.view'],
  ['PUT', /^\/api\/routing-cache\/?$/, 'connections.edit'],

  ['GET', /^\/api\/registry(?:\/.*)?$/, 'registry.view'],
  ['PATCH', /^\/api\/registry\/settings\/?$/, 'registry.manage'],
  ['POST', /^\/api\/registry\/contributions\/(?:deliver|revoke|rotate-key|resume-recovery|reset-recovery)\/?$/, 'registry.contribute'],
  ['POST', /^\/api\/registry(?:\/(?!contributions\/).*)?$/, 'registry.manage'],
  ['DELETE', /^\/api\/registry(?:\/.*)?$/, 'registry.manage'],

  ['GET', /^\/api\/backups\/?$/, 'backups.view'],
  ['POST', /^\/api\/backups\/?$/, 'backups.create'],
  ['POST', /^\/api\/backups\/[^/]+\/verify\/?$/, 'backups.view'],
  ['POST', /^\/api\/backups\/[^/]+\/download\/?$/, 'backups.download'],
  ['DELETE', /^\/api\/backups\/[^/]+\/?$/, 'backups.delete'],
  ['PATCH', /^\/api\/backups\/schedule\/?$/, 'backups.schedule'],
  ['POST', /^\/api\/backups\/(?:inspect|restore\/preflight|restore)\/?$/, 'backups.restore'],
  ['POST', /^\/api\/backups\/demo-export\/?$/, 'backups.download'],

  ['GET', /^\/api\/agent\/status\/?$/, 'agents.view'],
  ['POST', /^\/api\/agent\/enrollments\/?$/, 'agents.manage'],
  ['POST', /^\/api\/agent\/hosts\/(?:server|nas|pcBuild)\/[1-9]\d*\/enrollments\/?$/, 'agents.manage'],
  ['GET', /^\/api\/agent\/hosts\/(?:server|nas|pcBuild)\/[1-9]\d*\/hardware-(?:snapshot|suggestions)\/?$/, 'agents.view'],
  ['GET', /^\/api\/agent\/hosts\/(?:server|nas|pcBuild)\/[1-9]\d*\/telemetry\/?$/, 'agents.view'],
  ['DELETE', /^\/api\/agent\/servers\/[1-9]\d*\/(?:registration|status)\/?$/, 'agents.manage'],
  ['DELETE', /^\/api\/agent\/hosts\/(?:server|nas|pcBuild)\/[1-9]\d*\/(?:registration|status)\/?$/, 'agents.manage'],

  ['GET', /^\/api\/notifications(?:\/.*)?$/, 'notifications.view'],
  ['PATCH', /^\/api\/notifications\/settings\/?$/, 'notifications.manage'],
  ['POST', /^\/api\/notifications\/(?:contact-points|quiet-hours)\/?$/, 'notifications.manage'],
  ['PUT', /^\/api\/notifications\/(?:contact-points|rules|quiet-hours)\/[1-9]\d*\/?$/, 'notifications.manage'],
  ['DELETE', /^\/api\/notifications\/(?:contact-points|quiet-hours)\/[1-9]\d*\/?$/, 'notifications.manage'],
  ['PUT', /^\/api\/notifications\/hosts\/(?:server|nas|pcBuild)\/[1-9]\d*\/?$/, 'notifications.manage'],
  ['POST', /^\/api\/notifications\/(?:contact-points\/[1-9]\d*\/test|incidents\/[1-9]\d*\/acknowledge|deliveries\/[1-9]\d*\/retry)\/?$/, 'notifications.manage'],

  ['GET', /^\/api\/onboarding(?:\/.*)?$/, 'workspace.view'],
  ['POST', /^\/api\/onboarding(?:\/.*)?$/, 'workspace.edit'],
  ['GET', /^\/api\/release-notes\/status\/?$/, 'workspace.view'],
  ['POST', /^\/api\/release-notes\/acknowledge\/?$/, 'workspace.view'],
  ['POST', /^\/api\/flush\/?$/, 'workspace.edit'],
  ['GET', /^\/api\/update-status\/?$/, 'updates.view'],
  ['POST', /^\/api\/update-status\/check\/?$/, 'updates.view'],
  ['POST', /^\/api\/update-status\/skip\/?$/, 'updates.manage'],
  ['DELETE', /^\/api\/update-status\/skip\/?$/, 'updates.manage'],
]

function matches(routes, method, path) {
  return routes.find(([candidateMethod, pattern]) => candidateMethod === method && pattern.test(path))
}

export function classifyApiRequest(methodInput, pathInput) {
  const method = String(methodInput ?? '').toUpperCase()
  const path = String(pathInput ?? '').split('?')[0]
  if (!path.startsWith('/api/')) return { access: 'not-api' }
  if (matches(PUBLIC_ROUTES, method, path)) return { access: 'public' }
  if (matches(MACHINE_ROUTES, method, path)) return { access: 'machine' }
  const protectedRoute = matches(PROTECTED_ROUTES, method, path)
  if (!protectedRoute) return { access: 'denied' }
  permissionByKey(protectedRoute[2])
  return { access: 'protected', permission: protectedRoute[2] }
}

export function createAuthorizationGuard({ service, authorization, demo = false }) {
  return async function authorizationGuard(request, response, next) {
    try {
      const classification = classifyApiRequest(request.method, request.path)
      if (classification.access === 'not-api' || classification.access === 'public' || classification.access === 'machine') return next()
      if (classification.access === 'denied') {
        return response.status(403).json({ message: 'This API operation has no authorization policy.', code: 'authorization-policy-missing' })
      }
      if (demo || !service || deriveAuthenticationMode(service.state()) === 'disabled') return next()
      const accountId = request.authentication?.account?.id
      if (!accountId) return response.status(401).json({ message: 'Authentication is required.', code: 'authentication-required' })
      const decision = await authorization.authorize(accountId, classification.permission)
      if (!decision.allowed) {
        return response.status(403).json({
          message: 'You do not have permission to perform this action.',
          code: 'permission-denied',
          permission: classification.permission,
        })
      }
      next()
    } catch (error) {
      next(error)
    }
  }
}
