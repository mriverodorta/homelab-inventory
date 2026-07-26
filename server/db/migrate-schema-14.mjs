import { createOnboardingState, workspaceIsEmpty } from '../onboarding/model.mjs'

export function migrateSchema13To14({ inventory, project, agents }) {
  return createOnboardingState(
    workspaceIsEmpty(inventory, project, agents) ? 'available' : 'dismissed',
  )
}
