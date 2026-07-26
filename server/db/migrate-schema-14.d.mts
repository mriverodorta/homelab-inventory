import type { OnboardingState } from '../onboarding/model.mjs'
export function migrateSchema13To14(input: { inventory: any; project: any; agents: any }): OnboardingState
