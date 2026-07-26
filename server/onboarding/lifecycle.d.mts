export function publicOnboardingStatus(input: any): any
export function loadExampleIntoDraft(draft: any, now?: string): boolean
export function sampleRemovalImpact(draft: any): { inventoryRecords: number; assignments: number; connections: number; placements: number; additionalRelationships: number }
export function finishExampleInDraft(draft: any, action: 'keep' | 'remove', now?: string): void
export function setOnboardingStatusInDraft(draft: any, status: string, now?: string): void
export function setWalkthroughStepInDraft(draft: any, step: number): void
export function onboardingNeedsReconciliation(draft: any): boolean
export function reconcileOnboardingDraft(draft: any): boolean
