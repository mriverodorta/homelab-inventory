import type { InventoryItemInput } from '@/lib/db'

export type RegistryMode = 'disabled' | 'offline' | 'connected'
export type InventorySourceTab = 'catalog' | 'manual' | 'private-templates'

export type RegistrySettings = {
  mode: RegistryMode
  defaultInventorySource: InventorySourceTab
  automaticContributions: boolean
  showRegistryLinkIndicators: boolean
  updatedAt: string | null
}

export type RegistryPolicy = {
  modeLocked: boolean
  forcedMode: RegistryMode | null
  contributionsAllowed: boolean
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
  enrollment: 'not-enrolled' | 'active' | 'revoked'
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
  importedFingerprintVersion?: 2 | 3 | 4
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
  fingerprintVersion: 2 | 3 | 4
  identityHash: string
}

export type CatalogSearchItem = {
  templateKey: string
  revision: number
  fingerprintVersion: 2 | 3 | 4
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
  items: CatalogSearchItem[]
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
  fingerprintVersion: 2 | 3 | 4
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
  fingerprintVersion: 4
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

export type CatalogFieldChange = {
  field: string
  current?: unknown
  next?: unknown
}

export type CatalogUpdatePreview = CatalogUpdateSummary & {
  changes: CatalogFieldChange[]
  localFieldsPreserved: string[]
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
    tokenExpiresAt: null,
    lastError: null,
  },
  database: { schemaVersion: null, lastMigration: null },
}
