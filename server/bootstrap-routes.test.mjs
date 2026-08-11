import { describe, expect, it } from 'vitest'
import { registerBootstrapRoute } from './bootstrap-routes.mjs'

function responseRecorder() {
  return {
    body: null,
    headers: {},
    set(name, value) {
      this.headers[name] = value
      return this
    },
    json(value) {
      this.body = value
      return this
    },
  }
}

describe('application bootstrap route', () => {
  it('loads the workspace once and excludes optional domains without permission', async () => {
    let handler = null
    const app = {
      get(path, candidate) {
        if (path === '/api/bootstrap') handler = candidate
      },
    }
    const project = { id: 1, revision: 41 }
    const onboarding = { enabled: true, status: 'completed' }
    const releaseNotesStatus = { currentVersion: '0.11.1', entries: [] }
    const store = {
      getProject: () => project,
      getOnboardingStatus: () => onboarding,
      getReleaseNotesStatus: () => releaseNotesStatus,
    }
    const checkedPermissions = []
    let pending = Promise.resolve()
    registerBootstrapRoute(app, {
      withStore: (_request, _response, callback) => {
        pending = callback(store, null)
        return pending
      },
      authService: {
        state: () => ({ configuration: { enabled: true, localEnabled: true, oidcEnabled: false } }),
      },
      authorization: {
        authorize: async (_accountId, permission) => {
          checkedPermissions.push(permission)
          return { allowed: false }
        },
      },
      agentReleaseService: null,
      notificationStore: null,
      updateChecker: null,
      releaseNotes: [],
    })
    const response = responseRecorder()

    handler({ authentication: { account: { id: 1 } } }, response)
    await pending

    expect(checkedPermissions).toEqual([
      'agents.view',
      'registry.view',
      'notifications.view',
      'updates.view',
    ])
    expect(response.headers['Cache-Control']).toBe('no-store')
    expect(response.body).toEqual({
      project,
      agentStatus: null,
      registry: null,
      notifications: null,
      onboarding,
      releaseNotes: releaseNotesStatus,
      updateStatus: null,
      demoSession: { mode: 'production' },
    })
  })
})
