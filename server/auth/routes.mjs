import { rateLimit } from 'express-rate-limit'
import { SESSION_COOKIE_NAME, sessionTokenFromRequest } from './session-service.mjs'
import { OIDC_TRANSACTION_COOKIE } from './oidc-service.mjs'

function authRateLimit(limit = 10) {
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV !== 'production',
    handler(_request, response) {
      response.status(429).json({ message: 'Too many authentication attempts. Please try again shortly.' })
    },
  })
}

function failure(response, error, status = 400) {
  response.status(status).json({ message: error instanceof Error ? error.message : 'Authentication request failed.' })
}

function setSessionCookie(request, response, sessionService, token, session) {
  const absoluteMs = Math.max(0, Date.parse(session.absoluteExpiresAt) - Date.now())
  const options = sessionService.cookieOptions()
  response.cookie(SESSION_COOKIE_NAME, token, {
    ...options,
    secure: options.secure || request.secure === true,
    maxAge: absoluteMs,
  })
}

export function registerAuthenticationRoutes(app, { service, oidcService, demo = false }) {
  app.get('/api/auth/status', (request, response) => {
    if (demo || !service) {
      response.json({
        mode: 'disabled',
        setupRequired: false,
        authenticated: true,
        account: null,
        canManage: false,
        localCredentialConfigured: false,
        methods: { local: false, oidc: false },
        oidcSecretReadOnly: false,
        oidc: {
          clientSecretConfigured: false,
          identityBound: false,
          loginReady: false,
        },
      })
      return
    }
    response.json(service.status(request))
  })

  app.post('/api/auth/setup', authRateLimit(5), async (request, response) => {
    if (demo || !service) return failure(response, new Error('Authentication is unavailable in demo mode.'), 404)
    try {
      const created = await service.bootstrap(request.body ?? {}, request)
      setSessionCookie(request, response, service.sessions, created.token, created.session)
      response.json(service.statusForAccount(created.session.accountId))
    } catch (error) { failure(response, error) }
  })

  app.post('/api/auth/login', authRateLimit(10), async (request, response) => {
    if (demo || !service) return failure(response, new Error('Authentication is unavailable.'), 404)
    try {
      const created = await service.loginLocal(request.body ?? {}, request)
      setSessionCookie(request, response, service.sessions, created.token, created.session)
      response.json(service.statusForAccount(created.session.accountId))
    } catch (error) { failure(response, error, 401) }
  })

  app.post('/api/auth/logout', async (request, response) => {
    if (service) await service.logout(request)
    response.clearCookie(SESSION_COOKIE_NAME, service?.sessions.cookieOptions() ?? { path: '/' })
    response.json({ ok: true })
  })

  app.get('/api/auth/oidc/start', authRateLimit(20), async (request, response) => {
    if (demo || !service || !oidcService) return failure(response, new Error('OIDC authentication is unavailable.'), 404)
    try {
      const authentication = service.sessions.authenticateRequest(request)
      const started = await oidcService.start({ returnTo: request.query.returnTo, bindAccountId: authentication?.account.id ?? null })
      response.cookie(OIDC_TRANSACTION_COOKIE, started.transactionToken, oidcService.cookieOptions())
      response.redirect(started.url)
    } catch (error) { failure(response, error) }
  })

  app.get('/api/auth/oidc/callback', authRateLimit(20), async (request, response) => {
    if (demo || !service || !oidcService) return failure(response, new Error('OIDC authentication is unavailable.'), 404)
    try {
      const token = String(request.get('cookie') ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${OIDC_TRANSACTION_COOKIE}=`))?.slice(OIDC_TRANSACTION_COOKIE.length + 1)
      const result = await oidcService.callback(`${oidcService.settings().externalUrl}${request.originalUrl}`, decodeURIComponent(token ?? ''))
      const created = await service.createSession(result.accountId, { remember: true, request })
      setSessionCookie(request, response, service.sessions, created.token, created.session)
      response.clearCookie(OIDC_TRANSACTION_COOKIE, { path: '/api/auth/oidc' })
      response.redirect(result.returnTo)
    } catch {
      response.clearCookie(OIDC_TRANSACTION_COOKIE, { path: '/api/auth/oidc' })
      response.redirect('/?authError=oidc')
    }
  })

  app.patch('/api/auth/settings', async (request, response) => {
    if (demo || !service) return failure(response, new Error('Authentication settings are unavailable in demo mode.'), 404)
    try { response.json(await service.updateMethods(request.body ?? {}, request)) } catch (error) { failure(response, error) }
  })

  app.post('/api/auth/password', authRateLimit(10), async (request, response) => {
    if (demo || !service) return failure(response, new Error('Authentication is unavailable.'), 404)
    try { await service.changePassword(request.body ?? {}, request); response.json({ ok: true }) } catch (error) { failure(response, error) }
  })

  app.post('/api/auth/recovery/reset', authRateLimit(5), async (request, response) => {
    if (demo || !service) return failure(response, new Error('Authentication is unavailable.'), 404)
    try {
      const created = await service.resetOwnerWithGrant(request.body ?? {}, request)
      setSessionCookie(request, response, service.sessions, created.token, created.session)
      response.json(service.statusForAccount(created.session.accountId))
    } catch (error) { failure(response, error) }
  })

  app.get('/api/auth/sessions', (request, response) => {
    if (demo || !service) return failure(response, new Error('Authentication is unavailable.'), 404)
    try { response.json({ sessions: service.sessionsFor(request) }) } catch (error) { failure(response, error, 401) }
  })
  app.delete('/api/auth/sessions/:id', async (request, response) => {
    if (demo || !service) return failure(response, new Error('Authentication is unavailable.'), 404)
    try {
      const authentication = service.requireAuthenticated(request)
      const id = Number(request.params.id)
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Session ID is invalid.')
      service.sessions.revokeById(id, authentication.account.id)
      await service.store.flush(['authentication'])
      if (sessionTokenFromRequest(request) && id === authentication.session.id) response.clearCookie(SESSION_COOKIE_NAME, service.sessions.cookieOptions())
      response.json({ ok: true })
    } catch (error) { failure(response, error) }
  })
  app.get('/api/auth/events', (request, response) => {
    if (demo || !service) return failure(response, new Error('Authentication is unavailable.'), 404)
    try { response.json({ events: service.eventsFor(request) }) } catch (error) { failure(response, error, 401) }
  })
}
