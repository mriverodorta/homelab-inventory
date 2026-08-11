import { apiRequest } from '@/lib/db'
import { consumeInitialBootstrap } from '@/lib/bootstrap-api'
import type { InventoryType, ProjectState } from '@/types/inventory'

export const ONBOARDING_QUERY_KEY = ['onboarding'] as const

export type OnboardingStatusName =
  | 'available'
  | 'sample_active'
  | 'checklist_active'
  | 'completed'
  | 'dismissed'

export type OnboardingMilestones = {
  created: boolean
  placed: boolean
  related: boolean
  completed: boolean
}
export type OnboardingStatus =
  | { enabled: false; mode: 'demo' }
  | {
      enabled: true
      version: number
      status: OnboardingStatusName
      sampleBatchId: number | null
      sampleInventoryRefs: Array<{ type: InventoryType; id: number }>
      sampleAssignmentIds: number[]
      sampleConnectionIds: number[]
      walkthroughStep: number
      startedAt: string | null
      completedAt: string | null
      eligibleForExample: boolean
      shouldInvite: boolean
      milestones: OnboardingMilestones
      projectRevision: number
    }

export type OnboardingMutationResult = {
  status: OnboardingStatus
  project: ProjectState
}

export type OnboardingRemovalImpact = {
  inventoryRecords: number
  assignments: number
  connections: number
  placements: number
  additionalRelationships: number
}

export function loadOnboardingStatus(): Promise<OnboardingStatus> {
  return consumeInitialBootstrap('onboarding', () => apiRequest<OnboardingStatus>('/api/onboarding/status'))
}

export function loadOnboardingExample(): Promise<OnboardingMutationResult> {
  return apiRequest<OnboardingMutationResult>('/api/onboarding/load-example', { method: 'POST' })
}

export function startOnboardingEmpty(): Promise<OnboardingStatus> {
  return apiRequest<OnboardingStatus>('/api/onboarding/start-empty', { method: 'POST' })
}

export function loadOnboardingRemovalImpact(): Promise<OnboardingRemovalImpact> {
  return apiRequest<OnboardingRemovalImpact>('/api/onboarding/removal-impact')
}

export function finishOnboardingExample(action: 'keep' | 'remove'): Promise<OnboardingMutationResult> {
  return apiRequest<OnboardingMutationResult>('/api/onboarding/finish-example', {
    method: 'POST', body: JSON.stringify({ action }),
  })
}

export function dismissOnboarding(): Promise<OnboardingStatus> {
  return apiRequest<OnboardingStatus>('/api/onboarding/dismiss', { method: 'POST' })
}

export function restartOnboarding(): Promise<OnboardingStatus> {
  return apiRequest<OnboardingStatus>('/api/onboarding/restart', { method: 'POST' })
}

export function saveOnboardingWalkthroughStep(step: number): Promise<OnboardingStatus> {
  return apiRequest<OnboardingStatus>('/api/onboarding/walkthrough-step', {
    method: 'POST', body: JSON.stringify({ step }),
  })
}
