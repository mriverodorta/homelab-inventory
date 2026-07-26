export type OnboardingStatus = 'available' | 'sample_active' | 'checklist_active' | 'completed' | 'dismissed'
export type OnboardingState = {
  version: number
  status: OnboardingStatus
  sampleBatchId: number | null
  sampleInventoryRefs: Array<{ type: string; id: number }>
  sampleAssignmentIds: number[]
  sampleConnectionIds: number[]
  walkthroughStep: number
  startedAt: string | null
  completedAt: string | null
}
export const ONBOARDING_VERSION: number
export const ONBOARDING_STATUSES: Set<OnboardingStatus>
export function createOnboardingState(status?: OnboardingStatus): OnboardingState
export function assertOnboardingState(value: unknown): OnboardingState
export function workspaceIsEmpty(inventory: any, project: any, agents?: any): boolean
export function deriveOnboardingMilestones(project: any): { created: boolean; placed: boolean; related: boolean; completed: boolean }
