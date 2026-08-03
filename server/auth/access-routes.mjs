import { rateLimit } from 'express-rate-limit'
import { deriveAuthenticationMode } from './model.mjs'
import { SESSION_COOKIE_NAME } from './session-service.mjs'

function invitationRateLimit() {
  return rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV !== 'production',
    handler(_request, response) {
      response.status(429).json({ message: 'Too many invitation attempts. Please try again shortly.' })
    },
  })
}

function actor(request) {
  const id = request.authentication?.account?.id
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Authentication is required.')
  return id
}

function failure(response, error, status = 400) {
  const message = error instanceof Error ? error.message : 'Access request failed.'
  const notFound = /not found/i.test(message)
  response.status(notFound ? 404 : status).json({ message })
}

function setSessionCookie(request, response, sessions, token, session) {
  const options = sessions.cookieOptions()
  const absoluteMs = Math.max(0, Date.parse(session.absoluteExpiresAt) - Date.now())
  response.cookie(SESSION_COOKIE_NAME, token, {
    ...options,
    secure: options.secure || request.secure === true,
    maxAge: absoluteMs,
  })
}

export function createAccessAvailabilityGuard(access) {
  return (_request, response, next) => {
    if (!access || deriveAuthenticationMode(access.state()) === 'disabled') {
      return response.status(404).json({ message: 'Access administration is unavailable while authentication is disabled.' })
    }
    next()
  }
}

export function registerAccessRoutes(app, { access, invitations, sessions, demo = false }) {
  if (demo || !access || !invitations) return

  app.use('/api/access', createAccessAvailabilityGuard(access))

  app.get('/api/access/permissions', (_request, response) => response.json({ permissions: access.listPermissions() }))
  app.get('/api/access/roles', (_request, response) => response.json({ roles: access.listRoles() }))
  app.post('/api/access/roles', async (request, response) => {
    try { response.status(201).json({ role: await access.createRole(actor(request), request.body ?? {}) }) } catch (error) { failure(response, error) }
  })
  app.post('/api/access/roles/:id/duplicate', async (request, response) => {
    try { response.status(201).json({ role: await access.duplicateRole(actor(request), request.params.id, request.body ?? {}) }) } catch (error) { failure(response, error) }
  })
  app.patch('/api/access/roles/:id', async (request, response) => {
    try { response.json({ role: await access.updateRole(actor(request), request.params.id, request.body ?? {}) }) } catch (error) { failure(response, error) }
  })
  app.put('/api/access/roles/:id/permissions', async (request, response) => {
    try { response.json({ role: await access.setRolePermissions(actor(request), request.params.id, request.body?.permissionIds) }) } catch (error) { failure(response, error) }
  })
  app.delete('/api/access/roles/:id', async (request, response) => {
    try { response.json(await access.deleteRole(actor(request), request.params.id)) } catch (error) { failure(response, error) }
  })

  app.get('/api/access/users', (_request, response) => response.json({ users: access.listUsers() }))
  app.patch('/api/access/users/:id', async (request, response) => {
    try { response.json({ user: await access.updateUser(actor(request), request.params.id, request.body ?? {}) }) } catch (error) { failure(response, error) }
  })
  app.put('/api/access/users/:id/roles', async (request, response) => {
    try { response.json({ user: await access.assignRoles(actor(request), request.params.id, request.body?.roleIds) }) } catch (error) { failure(response, error) }
  })
  app.post('/api/access/users/:id/revoke-sessions', async (request, response) => {
    try { response.json(await access.revokeUserSessions(actor(request), request.params.id)) } catch (error) { failure(response, error) }
  })
  app.delete('/api/access/users/:id', async (request, response) => {
    try { response.json(await access.deleteUser(actor(request), request.params.id)) } catch (error) { failure(response, error) }
  })

  app.get('/api/access/invitations', (_request, response) => response.json({ invitations: invitations.list() }))
  app.post('/api/access/invitations', async (request, response) => {
    try { response.status(201).json(await invitations.create(actor(request), request.body ?? {})) } catch (error) { failure(response, error) }
  })
  app.post('/api/access/invitations/:id/resend', async (request, response) => {
    try { response.json(await invitations.resend(actor(request), request.params.id)) } catch (error) { failure(response, error) }
  })
  app.delete('/api/access/invitations/:id', async (request, response) => {
    try { response.json(await invitations.revoke(actor(request), request.params.id)) } catch (error) { failure(response, error) }
  })

  app.get('/api/auth/invitations/:token', invitationRateLimit(), (request, response) => {
    try { response.json({ invitation: invitations.inspect(request.params.token) }) } catch (error) { failure(response, error, 410) }
  })
  app.post('/api/auth/invitations/:token/activate-local', invitationRateLimit(), async (request, response) => {
    try {
      const created = await invitations.activateLocal(request.params.token, request.body ?? {}, request)
      await access.store.flush(['authentication'])
      setSessionCookie(request, response, sessions, created.token, created.session)
      response.json({ ok: true })
    } catch (error) { failure(response, error) }
  })
}
