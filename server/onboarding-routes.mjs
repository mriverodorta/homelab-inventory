import { InventoryLifecycleError } from './db/inventory-lifecycle.mjs'

function lifecycleErrorResponse(response, error) {
  if (!(error instanceof InventoryLifecycleError)) throw error
  response.status(error.status).json({
    message: error.message,
    code: error.code,
    ...(error.details === undefined ? {} : { details: error.details }),
  })
}
function disabledResponse(response) {
  response.status(404).json({ message: 'Onboarding is disabled in demo mode.', code: 'onboarding-disabled' })
}

function mutationRoute(app, path, { withStore, disabled }, handler) {
  app.post(path, (request, response) => {
    if (disabled) return disabledResponse(response)
    void withStore(request, response, async (store) => {
      try {
        response.json(await handler(store, request))
      } catch (error) {
        lifecycleErrorResponse(response, error)
      }
    }, { message: 'Unable to update onboarding.' })
  })
}

export function registerOnboardingRoutes(app, { withStore, disabled = false }) {
  app.get('/api/onboarding/status', (request, response) => {
    if (disabled) {
      response.json({ enabled: false, mode: 'demo' })
      return
    }
    void withStore(request, response, async (store) => {
      response.json(store.getOnboardingStatus())
    }, { message: 'Unable to load onboarding status.' })
  })

  app.get('/api/onboarding/removal-impact', (request, response) => {
    if (disabled) return disabledResponse(response)
    void withStore(request, response, async (store) => {
      response.json(store.getOnboardingRemovalImpact())
    }, { message: 'Unable to inspect example workspace removal.' })
  })

  mutationRoute(app, '/api/onboarding/load-example', { withStore, disabled }, (store) =>
    store.loadOnboardingExample())
  mutationRoute(app, '/api/onboarding/start-empty', { withStore, disabled }, (store) =>
    store.startOnboardingEmpty())
  mutationRoute(app, '/api/onboarding/finish-example', { withStore, disabled }, (store, request) =>
    store.finishOnboardingExample(request.body?.action))
  mutationRoute(app, '/api/onboarding/dismiss', { withStore, disabled }, (store) =>
    store.dismissOnboarding())
  mutationRoute(app, '/api/onboarding/restart', { withStore, disabled }, (store) =>
    store.restartOnboardingChecklist())
  mutationRoute(app, '/api/onboarding/walkthrough-step', { withStore, disabled }, (store, request) =>
    store.setOnboardingWalkthroughStep(request.body?.step))
}
