import { deriveAuthenticationMode } from './auth/model.mjs'
import { publicAgentStatus } from './agent-routes.mjs'
import { publicNotificationSnapshot } from './notifications/routes.mjs'
import { publicRegistryState } from './registry-routes.mjs'
import { publicUpdateStatus } from './update-routes.mjs'

const DEMO_REGISTRY_POLICY = Object.freeze({
  modeLocked: true,
  forcedMode: 'connected',
  contributionsAllowed: false,
})

function unavailableNotifications() {
  return {
    available: false,
    config: { enabled: false },
    summary: { active: 0, unacknowledged: 0, exhaustedDeliveries: 0 },
  }
}

export function registerBootstrapRoute(app, {
  withStore,
  authService,
  authorization,
  agentReleaseService,
  notificationStore,
  updateChecker,
  releaseNotes,
  demo = false,
  demoManager = null,
}) {
  app.get('/api/bootstrap', (request, response) => {
    void withStore(request, response, async (store, demoSession) => {
      const accountId = request.authentication?.account?.id ?? null
      const authenticationDisabled = demo || !authService || deriveAuthenticationMode(authService.state()) === 'disabled'
      const can = async (permission) => authenticationDisabled
        || (accountId !== null && (await authorization.authorize(accountId, permission)).allowed)
      const [agents, registry, notifications, updates] = await Promise.all([
        can('agents.view'),
        can('registry.view'),
        can('notifications.view'),
        can('updates.view'),
      ])
      const projects = store.listProjects().map((project) => store.getProjectWorkbook(project.id))
      const initialProject = projects[0]

      response.set('Cache-Control', 'no-store').json({
        project: store.getProject(),
        projects,
        activeProjectPreference: initialProject
          ? { projectId: initialProject.project.id, workspaceId: initialProject.defaultWorkspaceId }
          : null,
        agentStatus: agents ? publicAgentStatus(store, demo ? null : agentReleaseService) : null,
        registry: registry ? publicRegistryState(store, demo ? DEMO_REGISTRY_POLICY : undefined) : null,
        notifications: notifications
          ? (demo || !notificationStore ? unavailableNotifications() : publicNotificationSnapshot(notificationStore))
          : null,
        onboarding: demo ? { enabled: false, mode: 'demo' } : store.getOnboardingStatus(),
        releaseNotes: store.getReleaseNotesStatus(releaseNotes),
        updateStatus: updates
          ? await publicUpdateStatus({ checker: updateChecker, store, releaseNotes })
          : null,
        demoSession: demo && demoSession && demoManager
          ? demoManager.sessionStatus(demoSession)
          : { mode: 'production' },
      })
    }, { message: 'Unable to load the application bootstrap.' })
  })
}
