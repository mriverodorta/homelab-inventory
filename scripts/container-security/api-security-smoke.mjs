// Executed only inside a disposable, network-isolated staging container.
export async function verifyApiSecurity() {
  const { default: assert } = await import('node:assert/strict')
  const base = 'http://127.0.0.1:8798'
  const request = (path, options = {}) => fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(10000) })
  const health = await (await request('/api/health')).json()
  assert.equal(health.mode, 'staging')
  const status = await (await request('/api/auth/status')).json()
  assert.equal(status.mode, 'disabled', 'Staging must not enable authentication integrations')
  const routes = [['POST', 'projects'], ['DELETE', 'inventory/items/cpu/1'], ['POST', 'backups/restore']]
  for (const prefix of ['api', 'API', 'Api', 'aPi', 'apI', 'APi', 'ApI', 'aPI']) {
    for (const [method, suffix] of routes) {
      const response = await request(`/${prefix}/${suffix}`, { method, headers: { origin: 'https://untrusted.example' } })
      assert.equal(response.status, 403, `${method} /${prefix}/${suffix}`)
      assert.equal((await response.json()).message, 'Cross-origin browser mutations are not allowed.')
    }
  }
  assert.equal((await request('/api/projects')).status, 200)
  assert.equal((await request('/api/health')).status, 200)
  console.log('Full application staging isolation and API origin-boundary smoke passed.')
}
