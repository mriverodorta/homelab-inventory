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

function requestedWorkspace(request, projects) {
  const projectId = Number(request.query?.projectId)
  const workspaceId = Number(request.query?.workspaceId)
  if (!Number.isSafeInteger(projectId) || projectId <= 0) return null
  if (!Number.isSafeInteger(workspaceId) || workspaceId <= 0) return null
  const workbook = projects.find((candidate) => candidate.project.id === projectId)
  const workspace = workbook?.workspaces.find((candidate) => candidate.id === workspaceId)
  return workspace ? { projectId, workspaceId, workspace } : null
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
      const requested = requestedWorkspace(request, projects)
      const systemsBootstrap = requested?.workspace.type === 'systems'
      const includeLegacyProject = requested === null
        || (requested.projectId === 1 && requested.workspaceId === 2)

      response.set('Cache-Control', 'no-store').json({
        project: includeLegacyProject ? store.getProject() : null,
        projects,
        activeProjectPreference: initialProject
          ? { projectId: initialProject.project.id, workspaceId: initialProject.defaultWorkspaceId }
          : null,
        agentStatus: agents && !systemsBootstrap ? publicAgentStatus(store, demo ? null : agentReleaseService) : null,
        registry: registry && !systemsBootstrap
          ? publicRegistryState(store, demo ? DEMO_REGISTRY_POLICY : undefined)
          : null,
        notifications: notifications && !systemsBootstrap
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
