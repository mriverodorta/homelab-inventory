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
      listProjects: () => [{ id: 1, name: 'Default Project' }],
      getProjectWorkbook: () => ({
        project: { id: 1, name: 'Default Project' },
        defaultWorkspaceId: 2,
        workspaces: [{ id: 1, type: 'systems' }, { id: 2, type: 'canvas' }],
      }),
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
      projects: [{
        project: { id: 1, name: 'Default Project' },
        defaultWorkspaceId: 2,
        workspaces: [{ id: 1, type: 'systems' }, { id: 2, type: 'canvas' }],
      }],
      activeProjectPreference: { projectId: 1, workspaceId: 2 },
      agentStatus: null,
      registry: null,
      notifications: null,
      onboarding,
      releaseNotes: releaseNotesStatus,
      updateStatus: null,
      demoSession: { mode: 'production' },
    })
  })

  it('embeds only the compact agent projection when agent access is allowed', async () => {
    let handler = null
    const app = {
      get(path, candidate) {
        if (path === '/api/bootstrap') handler = candidate
      },
    }
    const status = {
      hostType: 'server', hostId: 1, state: 'online', connected: true, ageMs: 1_000,
      lastSeenAt: '2026-08-14T20:00:00.000Z', hostname: 'lab-node', agentVersion: '0.2.0',
      services: Array.from({ length: 512 }, (_, index) => ({ unit: `service-${index}.service` })),
      containers: Array.from({ length: 512 }, (_, index) => ({ name: `container-${index}` })),
      metrics: { cpu: { percent: 20 } },
    }
    const store = {
      getProject: () => ({ id: 1, revision: 41 }),
      listProjects: () => [{ id: 1, name: 'Default Project' }],
      getProjectWorkbook: () => ({
        project: { id: 1, name: 'Default Project' }, defaultWorkspaceId: 2,
        workspaces: [{ id: 1, type: 'systems' }, { id: 2, type: 'canvas' }],
      }),
      getAgentStatusSummary: () => ({
        hosts: { 'server:1': status }, servers: { 1: status },
        registeredHosts: [{ hostType: 'server', hostId: 1 }], registeredServerIds: [1],
      }),
      getOnboardingStatus: () => ({ enabled: true, status: 'completed' }),
      getReleaseNotesStatus: () => ({ currentVersion: '0.11.1', entries: [] }),
    }
    let pending = Promise.resolve()
    registerBootstrapRoute(app, {
      withStore: (_request, _response, callback) => {
        pending = callback(store, null)
        return pending
      },
      authService: { state: () => ({ configuration: { enabled: true, localEnabled: true, oidcEnabled: false } }) },
      authorization: { authorize: async (_accountId, permission) => ({ allowed: permission === 'agents.view' }) },
      agentReleaseService: null,
      notificationStore: null,
      updateChecker: null,
      releaseNotes: [],
    })
    const response = responseRecorder()

    handler({ authentication: { account: { id: 1 } } }, response)
    await pending

    expect(response.body.agentStatus.hosts['server:1']).toMatchObject({
      hostType: 'server', hostId: 1, state: 'online',
      details: { metrics: true, services: true, containers: true },
    })
    expect(response.body.agentStatus).not.toHaveProperty('servers')
    expect(response.body.agentStatus.hosts['server:1']).not.toHaveProperty('services')
    expect(response.body.agentStatus.hosts['server:1']).not.toHaveProperty('containers')
    expect(response.body.agentStatus.hosts['server:1']).not.toHaveProperty('metrics')
    expect(Buffer.byteLength(JSON.stringify(response.body.agentStatus))).toBeLessThan(2_048)
  })
})
