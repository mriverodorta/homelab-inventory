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
  getAuthenticationState(): unknown
  updateAuthentication(mutator: (draft: unknown) => void): unknown
  getBackupManagementState(): unknown
  updateBackupManagement(mutator: (draft: unknown) => void): unknown
  snapshotStores(storeNames?: string[]): Promise<Record<string, unknown>>
  replaceStoresAtomically(replacements: Record<string, unknown>): Promise<Record<string, unknown>>
  flush(storeNames?: string[]): Promise<void>
  close?(): void
}
