export type AgentHostReference = {
  hostType: string
  hostId: number
}

export type AgentEnrollmentLookup = AgentHostReference & {
  protocolMajor?: number
  tokenHash: string
  nowMs?: number
}

export type AgentDeviceLookup = AgentHostReference & {
  deviceId?: number
  protocolMajor?: number
  tokenHash?: string
  revoked?: boolean
}

export interface HomelabInventoryPersistence {
  markAppOpened(): Promise<void>
  getReleaseNotesStatus(releaseNotes: unknown[]): unknown
  acknowledgeReleaseNotes(): Promise<unknown>
  getUpdateMetadata(): unknown
  isUpdateVersionSkipped(version: string): boolean
  saveUpdateCheck(result: unknown): Promise<void>
  skipUpdateVersion(version: string): Promise<void>
  clearSkippedUpdateVersion(): Promise<void>

  getProject(): unknown
  getEngineSnapshot(): unknown
  getEngineRevision(): number
  applyEnginePatch(input: {
    baseRevision: number
    patchSet: {
      revision: number
      forward: unknown
      inverse?: unknown
    }
    responseBytes: Uint8Array
  }): Promise<unknown>
  subscribeToProjectCommits(listener: (event: unknown) => void): () => void
  getRoutingCache(): unknown
  setRoutingCache(cache: unknown): unknown
  getDatabaseStatus(): {
    schemaVersion: number | null
    lastMigration: unknown
  }
  getPersistenceHealth(): unknown

  createInventoryItems(input: Record<string, unknown>, quantity?: number): unknown
  duplicateInventoryItem(reference: Record<string, unknown>, quantity?: number): unknown
  updateInventoryItem(reference: Record<string, unknown>, input: Record<string, unknown>): unknown
  updateInventoryItemAndReconcileCatalog(
    reference: Record<string, unknown>,
    input: Record<string, unknown>,
    contentHash: string,
  ): unknown
  updateInventoryItemProperties(reference: Record<string, unknown>, properties: unknown): unknown
  changeNasPowerConfiguration(reference: Record<string, unknown>, target: unknown, confirmed?: boolean): unknown
  getInventoryDependencies(reference: Record<string, unknown>): unknown
  getInventoryDependencyReports(references: Record<string, unknown>[]): unknown
  archiveInventoryItems(references: Record<string, unknown>[]): unknown
  restoreInventoryItems(references: Record<string, unknown>[]): unknown
  deleteInventoryItems(references: Record<string, unknown>[]): unknown

  getOnboardingStatus(options?: { enabled?: boolean }): unknown
  loadOnboardingExample(): Promise<unknown>
  startOnboardingEmpty(): unknown
  getOnboardingRemovalImpact(): unknown
  finishOnboardingExample(action: string): Promise<unknown>
  dismissOnboarding(): unknown
  restartOnboardingChecklist(): unknown
  setOnboardingWalkthroughStep(step: number): unknown

  listAgentEnrollments(): unknown[]
  findAgentEnrollment(input: AgentEnrollmentLookup): unknown | null
  findAgentDevice(input: AgentDeviceLookup): unknown | null
  createAgentEnrollment(input: Record<string, unknown>): unknown
  activateAgentEnrollment(input: {
    enrollmentId: number
    device: Record<string, unknown>
  }): { device: unknown; revokedDeviceIds: number[] }
  recordAgentHeartbeat(input: {
    deviceId: number
    host: AgentHostReference
    sequence?: number
    status: Record<string, unknown>
  }): unknown
  saveAgentHardwareSnapshot(input: Record<string, unknown>): Promise<unknown>
  getAgentHardwareContext(hostType: string, hostId: number): {
    snapshot: unknown | null
    inventory: unknown
    project: unknown
  }
  revokeAgentRegistration(hostType: string, hostId: number): {
    revoked: number
    revokedAt: string
    revokedDeviceIds: number[]
  }
  hasActiveAgentRegistration(
    hostType: string,
    hostId: number,
    options?: { pendingEnrollmentsOnly?: boolean },
  ): boolean
  clearAgentRuntimeData(hostType: string, hostId: number): unknown
  getAgentStatusSummary(options?: Record<string, unknown>): unknown

  getRegistryState(): unknown
  updateRegistrySettings(patch: unknown, expectedUpdatedAt?: string): unknown
  registryTransaction(mutator: (draft: unknown) => void): unknown
  createPrivateTemplate(input: Record<string, unknown>): Promise<unknown>
  duplicatePrivateTemplate(id: number): Promise<unknown>
  deletePrivateTemplate(id: number): unknown
  exportPrivateTemplates(ids?: number[]): Promise<unknown>
  previewPrivateTemplateImport(pack: unknown): Promise<unknown>
  importPrivateTemplates(pack: unknown): Promise<unknown>
  createCatalogInventoryItems(template: Record<string, unknown>, quantity?: number, options?: Record<string, unknown>): unknown
  reconcileCatalogLink(reference: Record<string, unknown>, contentHash: string): unknown
  getCatalogUpdates(): unknown[]
  selectCatalogVariant(variantMatchId: number, template: Record<string, unknown>): unknown
  getCatalogUpdatePreview(linkId: number, template: Record<string, unknown>): unknown
  applyCatalogUpdate(linkId: number, template: Record<string, unknown>): unknown
  evaluateCatalogUpdate(linkId: number, template: Record<string, unknown>): unknown
  evaluateCatalogUpdates(updates: Record<string, unknown>[], templates: Record<string, unknown>[]): unknown
  commitCatalogUpdateRun(input: Record<string, unknown>): unknown
  getRegistryUpdateGroups(): unknown[]
  getRegistryUpdateStatus(): unknown
  recordCatalogUpdateFailure(input: Record<string, unknown>): unknown
  decideRegistryUpdateGroup(input: Record<string, unknown>): unknown
  applyRegistryUpdateGroup(template: Record<string, unknown>, userId?: number | null): unknown
  applyRegistryUpdateGroups(templates: Record<string, unknown>[], userId?: number | null): unknown
  resolveAndApplyRegistryUpdateGroup(input: Record<string, unknown>, userId?: number | null): unknown
  decideRegistryUpdateGroups(input: Record<string, unknown>): unknown
  getAuthenticationState(): unknown
  updateAuthentication(mutator: (draft: unknown) => void): unknown
  getBackupManagementState(): unknown
  updateBackupManagement(mutator: (draft: unknown) => void): unknown
  snapshotStores(storeNames?: string[]): Promise<Record<string, unknown>>
  replaceStoresAtomically(replacements: Record<string, unknown>): Promise<Record<string, unknown>>
  flush(storeNames?: string[]): Promise<void>
  close?(): void
}
