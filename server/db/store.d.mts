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
  databases: Record<string, any>
  getRegistryState(): any
  updateRegistrySettings(patch: any, expectedUpdatedAt?: string | null): any
  createPrivateTemplate(input: any): Promise<any>
  duplicatePrivateTemplate(id: number): Promise<any>
  deletePrivateTemplate(id: number): any
  exportPrivateTemplates(ids?: number[]): Promise<any>
  previewPrivateTemplateImport(pack: any): Promise<any>
  importPrivateTemplates(pack: any): Promise<any>
  registryTransaction(mutator: (draft: any) => void): any
  createCatalogInventoryItems(template: any, quantity?: number, options?: { usageRole?: string }): any
  reconcileCatalogLink(ref: any, contentHash: string): any
  getCatalogUpdates(): any[]
  getCatalogUpdatePreview(linkId: number, template: any): any
  applyCatalogUpdate(linkId: number, template: any): any
}
