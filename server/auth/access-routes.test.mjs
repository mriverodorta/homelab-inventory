import { describe, expect, it, vi } from 'vitest'
import { createAccessAvailabilityGuard } from './access-routes.mjs'
import { createAuthenticationStore } from './model.mjs'

function invoke(state) {
  const next = vi.fn()
  const response = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
  }
  createAccessAvailabilityGuard({ state: () => structuredClone(state) })({}, response, next)
  return { next, response }
}

describe('Access route availability', () => {
  it('hides account and role administration while authentication is disabled', () => {
    const result = invoke(createAuthenticationStore())
    expect(result.next).not.toHaveBeenCalled()
    expect(result.response.statusCode).toBe(404)
    expect(result.response.payload.message).toMatch(/authentication is disabled/i)
  })

  it('allows the authorization layer to handle Access APIs after authentication is enabled', () => {
    const state = createAuthenticationStore()
    state.configuration.enabled = true
    state.configuration.localEnabled = true
    expect(invoke(state).next).toHaveBeenCalledOnce()
  })
})
