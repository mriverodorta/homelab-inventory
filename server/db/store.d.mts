export const CURRENT_SCHEMA_VERSION: number
export class HomelabInventoryStore {
  constructor(options: Record<string, unknown>)
  init(): Promise<void>
  flush(stores?: string[]): Promise<void>
  getOnboardingStatus(options?: { enabled?: boolean }): any
  loadOnboardingExample(): Promise<any>
  finishOnboardingExample(action: 'keep' | 'remove'): Promise<any>
  setOnboardingWalkthroughStep(step: number): any
  getEngineRevision(): number
}
