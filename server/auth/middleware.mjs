import { deriveAuthenticationMode } from './model.mjs'

const PUBLIC_AUTH_PATHS = new Set([
  '/api/auth/status',
  '/api/auth/setup',
  '/api/auth/login',
  '/api/auth/oidc/start',
  '/api/auth/oidc/callback',
  '/api/auth/recovery/reset',
])

const PUBLIC_INVITATION_PATH = /^\/api\/auth\/invitations\/[^/]+(?:\/activate-local)?\/?$/

const MACHINE_AGENT_PATH = /^\/api\/agent\/servers\/[1-9]\d*\/(?:register|heartbeat)\/?$/

export function createAuthenticationGuard({ service, demo = false }) {
  return function authenticationGuard(request, response, next) {
    if (demo || !service || !request.path.startsWith('/api/')) return next()
    if (request.path === '/api/health' || PUBLIC_AUTH_PATHS.has(request.path) || PUBLIC_INVITATION_PATH.test(request.path) || MACHINE_AGENT_PATH.test(request.path)) return next()
    const state = service.state()
    if (state.bootstrapState.setupRequired) {
      response.status(401).json({ message: 'First-run setup is required.', code: 'setup-required' })
      return
    }
    const mode = deriveAuthenticationMode(state)
    if (mode === 'disabled') return next()
    const authentication = service.sessions.authenticateRequest(request)
    if (!authentication) {
      response.status(401).json({ message: 'Authentication is required.', code: 'authentication-required' })
      return
    }
    request.authentication = authentication
    next()
  }
}
