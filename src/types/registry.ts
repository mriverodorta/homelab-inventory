import type { InventoryItemInput } from '@/lib/db'

export type RegistryMode = 'disabled' | 'offline' | 'connected'
export type InventorySourceTab = 'catalog' | 'manual' | 'private-templates' | 'global-inventory'

export type RegistrySettings = {
  mode: RegistryMode
  defaultInventorySource: InventorySourceTab
  automaticContributions: boolean
  automaticSafeUpdates: boolean
  showRegistryLinkIndicators: boolean
  updatedAt: string | null
}

export type RegistryPolicy = {
  modeLocked: boolean
  forcedMode: RegistryMode | null
  contributionsAllowed: boolean
  automaticSafeUpdatesForced?: boolean
}

export type PrivateTemplate = {
  id: number
  name: string
  description?: string
  checksum: string
  createdAt: string
  updatedAt: string
  item: InventoryItemInput
}

export type RegistryState = {
  policy?: RegistryPolicy
  settings: RegistrySettings
  sources: RegistrySource[]
  links: RegistryLink[]
  variantMatches?: CatalogVariantMatch[]
  privateTemplates: PrivateTemplate[]
  snapshot: RegistrySnapshot | null
  contributions: ContributionStatus
  database: {
    schemaVersion: number | null
    applicationOemContractVersion: number
    applicationCatalogContractVersion: number
    lastMigration: {
      from: number
      to: number
      completedAt: string
      backupId: string | null
      summary: Record<string, unknown> | null
    } | null
  }
}

export type ContributionStatus = {
  enabled: boolean
  queued: number
  retrying: number
  delivered: number
  accepted: number
  rejected: number
  suppressed: number
  enrollment: 'not-enrolled' | 'active' | 'recovery-pending' | 'rejected' | 'revoked'
  clientInstanceId: string | null
  recoveryKey: string | null
  tokenExpiresAt: string | null
  lastError: string | null
}

export type RegistrySource = {
  id: number
  kind: 'official-connected' | 'official-offline' | 'private'
  displayName: string
  activeRevision?: number
  lastCheckedAt?: string
  lastSuccessAt?: string
  lastErrorAt?: string | null
  lastError?: string | null
}

export type RegistrySnapshot = {
  sourceId: number
  revision: number
  generatedAt: string
  expiresAt: string | null
  activatedAt: string
  digest: string
  templateCount: number
  keyId: string
}

export type RegistryLink = {
  id: number
  itemType: string
  itemId: number
  sourceId: number
  templateKey: string
  importedRevision: number
  importedContentHash: string
  importedFingerprintVersion?: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
  productFamily?: CatalogProductFamily
  variantEvidence?: CatalogVariantEvidence
  identityAliases?: CatalogIdentityAlias[]
  state: 'linked' | 'update-available' | 'adoption-available' | 'detached' | 'contribution-pending'
  linkedAt: string
}

export type CatalogProductFamily = {
  manufacturer: string
  model: string
  physicalClass: string
}

export type CatalogVariantEvidence = {
  source: 'motherboard' | 'topology' | 'generic'
  completeness: 'complete' | 'partial' | 'conflicting'
  label?: string
  motherboardPartNumber?: string
  motherboardRevision?: string
  variantKey?: string
  topologySignature?: string
  structuralSummary?: string
}

export type CatalogIdentityAlias = {
  fingerprintVersion: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
  identityHash: string
}

export type CatalogSearchItem = {
  templateKey: string
  revision: number
  fingerprintVersion: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
  identityHash: string
  identityAliases: CatalogIdentityAlias[]
  contentHash: string
  type: string
  manufacturer: string | null
  name: string
  productFamily?: CatalogProductFamily
  variantEvidence?: CatalogVariantEvidence
  item: Omit<InventoryItemInput, 'type'> & { type: string }
}

export type CatalogSearchResult = {
  total: number
  limit: number
  offset: number
  hasMore: boolean
  nextOffset: number | null
  items: CatalogSearchItem[]
}

export type CatalogFacetTermValue = {
  value: string
  label: string
  count: number
}

export type CatalogFacetDefinition = {
  key: string
  label: string
} & ({
  kind: 'terms'
  values: CatalogFacetTermValue[]
} | {
  kind: 'range'
  minimum: number
  maximum: number
  step: number
  unit?: string | null
})

export type CatalogFacetCategory = {
  type: string
  label: string
  count: number
  facets: CatalogFacetDefinition[]
}

export type CatalogFacetResponse = {
  available: boolean
  schemaVersion?: 1
  catalogRevision?: number
  generatedAt?: string
  categories: CatalogFacetCategory[]
}

export type CatalogSearchFilters = {
  terms?: Record<string, string[]>
  ranges?: Record<string, { minimum?: number; maximum?: number }>
}

export type CatalogUpdateSummary = {
  linkId: number
  itemType: string
  itemId: number
  itemName: string
  templateKey: string
  importedRevision: number
  availableRevision: number
  state: 'update-available' | 'adoption-available'
}

export type CatalogVariantCandidate = {
  templateKey: string
  revision: number
  contentHash: string
  fingerprintVersion: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
  label: string
  structuralSummary?: string
}

export type CatalogVariantMatch = {
  id: number
  itemType: string
  itemId: number
  sourceId: number
  productFamily: CatalogProductFamily
  candidates: CatalogVariantCandidate[]
  localContentHash: string
  fingerprintVersion: 4 | 5 | 6 | 7 | 10
  createdAt: string
}

export type CatalogVariantUpdateSummary = {
  variantMatchId: number
  itemType: string
  itemId: number
  itemName: string
  state: 'variant-selection-required'
  productFamily: CatalogProductFamily
  candidates: CatalogVariantCandidate[]
}

export type CatalogReviewSummary = CatalogUpdateSummary | CatalogVariantUpdateSummary

export type CatalogUpdateGroup = {
  id: string
  status: 'review' | 'blocked' | 'applied' | 'declined'
  templateKey: string
  fromRevision: number
  toRevision: number
  targetContentHash?: string
  concurrencyToken: string
  reconsiderable: boolean
  classification: 'safe' | 'review-required' | 'blocked' | 'skipped'
  reasons: string[]
  evaluatedAt: string
  projects: Array<{ id: number; name: string }>
  items: Array<{
    linkId: number
    itemType: string
    itemId: number
    itemName: string
    projects: Array<{ id: number; name: string }>
    classification?: 'safe' | 'review-required' | 'blocked' | 'skipped'
    fromRevision?: number
  }>
}

export type CatalogUpdateResolution = {
  available: boolean
  reason: string | null
  reasonCode?: string | null
  operations: Array<Record<string, unknown>>
  affectedRelationships: {
    connectionIds: number[]
    assignmentIds: number[]
    inventoryItems?: Array<{ itemType: string; itemId: number }>
    projectIds?: number[]
  }
}

export type CatalogUpdateGroupDetail = CatalogUpdateGroup & {
  changes?: CatalogFieldChange[]
  proposed?: unknown
  members: Array<{
    linkId: number
    itemId: number
    itemType: string
    current: unknown
    proposed: unknown
    changes: CatalogFieldChange[]
    resolution: CatalogUpdateResolution
  }>
}

export type CatalogUpdateRunStatus = {
  id: number
  catalogRevision: number
  state: 'running' | 'completed' | 'failed'
  automatic: boolean
  appliedCount: number
  reviewCount: number
  blockedCount: number
  skippedCount: number
  attemptCount: number
  retryAfter: string | null
  error: string | null
  completedAt: string | null
}

export type CatalogUpdateGroupCounts = {
  review: number
  blocked: number
  applied: number
  declined: number
}

export type CatalogUpdateSummaryResponse = {
  run: CatalogUpdateRunStatus | null
  counts: CatalogUpdateGroupCounts
}

export type CatalogUpdateGroupsResponse = {
  groups: CatalogUpdateGroup[]
  run: CatalogUpdateRunStatus | null
  nextCursor: string | null
  total: number
}

export type CatalogUpdateDecisionResult = {
  decisions: Array<{
    groupId: string
    previousGroupId: string
    concurrencyToken: string | null
    templateKey: string
    toRevision: number
    status: 'review' | 'blocked' | 'applied' | 'declined'
  }>
  summary: CatalogUpdateSummaryResponse
  affectedProjectIds: number[]
  affectedProjectRevisions: Record<number, number>
  affectedLinkIds: number[]
}

export type CatalogFieldChange = {
  path: string
  kind: 'added' | 'removed' | 'changed'
  impact: 'metadata' | 'compatibility' | 'assignment' | 'cable' | 'topology'
  current?: unknown
  next?: unknown
}

export type CatalogUpdatePreview = CatalogUpdateSummary & {
  changes: CatalogFieldChange[]
  localFieldsPreserved: string[]
  dependencyConflicts: Array<{
    hostId: string
    assignmentId: number
    itemId: string
    findings: Array<{ code: string; message: string; resourceId?: number }>
  }>
}

export type PrivateTemplatePack = {
  format: 'homelab-inventory-private-templates'
  version: 1
  exportedAt: string
  templates: Array<Omit<PrivateTemplate, 'id' | 'createdAt' | 'updatedAt'>>
  checksum: string
}

export type PrivateTemplateImportPreview = {
  valid: boolean
  templates: Array<Omit<PrivateTemplate, 'id' | 'createdAt' | 'updatedAt'>>
  errors: string[]
}

export const DEFAULT_REGISTRY_STATE: RegistryState = {
  policy: {
    modeLocked: false,
    forcedMode: null,
    contributionsAllowed: true,
  },
  settings: {
    mode: 'disabled',
    defaultInventorySource: 'catalog',
    automaticContributions: false,
    automaticSafeUpdates: true,
    showRegistryLinkIndicators: false,
    updatedAt: null,
  },
  sources: [],
  links: [],
  variantMatches: [],
  privateTemplates: [],
  snapshot: null,
  contributions: {
    enabled: false,
    queued: 0,
    retrying: 0,
    delivered: 0,
    accepted: 0,
    rejected: 0,
    suppressed: 0,
    enrollment: 'not-enrolled',
    clientInstanceId: null,
    recoveryKey: null,
    tokenExpiresAt: null,
    lastError: null,
  },
  database: {
    schemaVersion: null,
    applicationOemContractVersion: 6,
    applicationCatalogContractVersion: 10,
    lastMigration: null,
  },
}
