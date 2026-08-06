import { describe, expect, it, vi } from 'vitest'
import { createAuthenticationStore } from './model.mjs'
import { createAuthenticationGuard } from './middleware.mjs'

function invoke({ state = createAuthenticationStore(), path = '/api/project', authentication = null, demo = false } = {}) {
  const next = vi.fn()
  const response = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
  }
  const service = {
    state: () => structuredClone(state),
    sessions: { authenticateRequest: () => authentication },
  }
  createAuthenticationGuard({ service, demo })({ path }, response, next)
  return { next, response }
}

describe('authentication API guard', () => {
  it('blocks workspace APIs until fresh-install setup is complete', () => {
    const state = createAuthenticationStore({ setupRequired: true })
    const result = invoke({ state })
    expect(result.next).not.toHaveBeenCalled()
    expect(result.response.statusCode).toBe(401)
    expect(result.response.payload.code).toBe('setup-required')
  })

  it('keeps setup, health, and bearer-token machine endpoints public', () => {
    const state = createAuthenticationStore({ setupRequired: true })
    for (const path of ['/api/auth/status', '/api/auth/setup', '/api/health', '/api/agent/install.sh', '/api/agent/releases/0.1.0/install-freebsd.sh', '/api/agent/servers/12/register', '/api/agent/servers/12/heartbeat']) {
      expect(invoke({ state, path }).next).toHaveBeenCalledOnce()
    }
  })

  it('protects agent management and workspace routes after authentication is enabled', () => {
    const state = createAuthenticationStore()
    state.configuration.enabled = true
    state.configuration.localEnabled = true
    for (const path of ['/api/project', '/api/agent/enrollments', '/api/agent/status', '/api/backups']) {
      const result = invoke({ state, path })
      expect(result.next).not.toHaveBeenCalled()
      expect(result.response.payload.code).toBe('authentication-required')
    }
    expect(invoke({ state, authentication: { account: { id: 1 } } }).next).toHaveBeenCalledOnce()
  })

  it('leaves upgraded installations and demo sessions accessible when protection is disabled', () => {
    expect(invoke().next).toHaveBeenCalledOnce()
    expect(invoke({ state: createAuthenticationStore({ setupRequired: true }), demo: true }).next).toHaveBeenCalledOnce()
  })
})
