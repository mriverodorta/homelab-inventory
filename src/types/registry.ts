import type { InventoryItemInput } from '@/lib/db'

export type RegistryMode = 'disabled' | 'offline' | 'connected'
export type InventorySourceTab = 'catalog' | 'manual' | 'private-templates'

export type RegistrySettings = {
  mode: RegistryMode
  defaultInventorySource: InventorySourceTab
  automaticContributions: boolean
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
  state: 'linked' | 'update-available' | 'detached' | 'contribution-pending'
  linkedAt: string
}

export type CatalogSearchItem = {
  templateKey: string
  revision: number
  identityHash: string
  contentHash: string
  type: string
  manufacturer: string | null
  name: string
  item: InventoryItemInput
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
}

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
    updatedAt: null,
  },
  sources: [],
  links: [],
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
