import { describe, expect, it, vi } from 'vitest'
import { classifyApiRequest, createAuthorizationGuard } from './api-permissions.mjs'

describe('API permission classification', () => {
  it('classifies public, machine, and protected routes', () => {
    expect(classifyApiRequest('GET', '/api/health')).toEqual({ access: 'public' })
    expect(classifyApiRequest('GET', '/api/agent/install.sh')).toEqual({ access: 'public' })
    expect(classifyApiRequest('GET', '/api/agent/releases/current')).toEqual({ access: 'public' })
    expect(classifyApiRequest('GET', '/api/agent/releases/0.1.0/install-freebsd.sh')).toEqual({ access: 'public' })
    expect(classifyApiRequest('POST', '/api/agent/releases/current')).toEqual({ access: 'denied' })
    expect(classifyApiRequest('GET', '/api/agent/releases/0.1.0')).toEqual({ access: 'denied' })
    expect(classifyApiRequest('POST', '/api/agent/servers/1/heartbeat')).toEqual({ access: 'machine' })
    expect(classifyApiRequest('POST', '/api/agent/hosts/server/1/hardware-snapshots')).toEqual({ access: 'machine' })
    expect(classifyApiRequest('GET', '/api/agent/hosts/server/1/hardware-suggestions')).toEqual({ access: 'protected', permission: 'agents.view' })
    expect(classifyApiRequest('GET', '/api/agent/hosts/nas/1/telemetry')).toEqual({ access: 'protected', permission: 'agents.view' })
    expect(classifyApiRequest('GET', '/api/auth/events')).toEqual({ access: 'protected', permission: 'authentication.view' })
    expect(classifyApiRequest('DELETE', '/api/inventory/items/cpu/1')).toEqual({ access: 'protected', permission: 'inventory.delete' })
    expect(classifyApiRequest('GET', '/api/new-unclassified-route')).toEqual({ access: 'denied' })
  })

  it('denies insufficient permission and defaults unknown routes to deny', async () => {
    const service = { state: () => ({ configuration: { enabled: true, localEnabled: true, oidcEnabled: false } }) }
    const authorization = { authorize: vi.fn().mockResolvedValue({ allowed: false }) }
    const guard = createAuthorizationGuard({ service, authorization })
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    const next = vi.fn()
    await guard({ method: 'DELETE', path: '/api/inventory/items/cpu/1', authentication: { account: { id: 7 } } }, response, next)
    expect(response.status).toHaveBeenCalledWith(403)
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ permission: 'inventory.delete' }))
    expect(next).not.toHaveBeenCalled()
  })
})
