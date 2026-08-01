export const CATALOG_SCHEMA_VERSION = 1
export const LEGACY_FINGERPRINT_VERSION = 2
export const FINGERPRINT_VERSION = 3
export const SUPPORTED_FINGERPRINT_VERSIONS = [LEGACY_FINGERPRINT_VERSION, FINGERPRINT_VERSION] as const
export const MANUFACTURER_ALIAS_VERSION = 1

export type FingerprintVersion = typeof SUPPORTED_FINGERPRINT_VERSIONS[number]
export type TopologyCompleteness = 'complete' | 'partial' | 'conflicting'

export type CatalogProductFamily = {
  manufacturer: string
  model: string
  physicalClass: string
}

export type CatalogVariantEvidence = {
  source: 'motherboard' | 'topology' | 'generic'
  completeness: TopologyCompleteness
  label?: string
  motherboardPartNumber?: string
  motherboardRevision?: string
  variantKey?: string
  topologySignature?: string
  structuralSummary?: string
}

export type CatalogIdentityAlias = {
  fingerprintVersion: FingerprintVersion
  identityHash: string
}

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type CatalogPortEndpoint = {
  id: number
  side: 'front' | 'back'
}

export type CatalogPort = {
  id: number
  key?: string
  kind: string
  type: string
  slotNumber: number
  role?: string
  speed?: string
  poe?: boolean
  endpoints?: CatalogPortEndpoint[]
}

export type CatalogTemplateItem = {
  type: string
  name: string
  subtype?: string
  manufacturer?: string
  secondaryManufacturer?: string
  family?: string
  model?: string
  number?: string
  specs?: Record<string, JsonPrimitive>
  ports?: CatalogPort[]
  compatibility?: Record<string, JsonValue>
}

export type CatalogSourceRef = {
  itemType: string
  itemId: number
}

export type CatalogEligibilityReason =
  | 'unsupported-type'
  | 'insufficient-identity'
  | 'custom-build'
  | 'legacy-ram-kit'

export type EligibleCatalogProjection = {
  status: 'eligible'
  source: CatalogSourceRef
  item: CatalogTemplateItem
  fingerprintVersion: FingerprintVersion
  productFamily?: CatalogProductFamily
  variantEvidence?: CatalogVariantEvidence
  identityPayload: Record<string, JsonValue>
  identityHash: string
  contentHash: string
}

export type IneligibleCatalogProjection = {
  status: 'ineligible'
  source: CatalogSourceRef
  reason: CatalogEligibilityReason
}

export type CatalogProjection = EligibleCatalogProjection | IneligibleCatalogProjection

export type CatalogProjectionGroup = CatalogDigests & {
  item: CatalogTemplateItem
  fingerprintVersion: FingerprintVersion
  productFamily?: CatalogProductFamily
  variantEvidence?: CatalogVariantEvidence
  sources: CatalogSourceRef[]
}

export type WithheldCatalogProjectionGroup = {
  status: 'withheld-conflict'
  identityHash: string
  sources: CatalogSourceRef[]
  reason: string
}

export type CatalogDigests = {
  identityHash: string
  contentHash: string
}

export type CatalogTemplateRevision = CatalogDigests & {
  templateKey: string
  revision: number
  fingerprintVersion?: FingerprintVersion
  identityAliases?: CatalogIdentityAlias[]
  productFamily?: CatalogProductFamily
  variantEvidence?: CatalogVariantEvidence
  item: CatalogTemplateItem
}

export type CatalogSnapshot = {
  schemaVersion: number
  catalogRevision: number
  generatedAt: string
  expiresAt?: string
  manufacturerAliases: Record<string, string>
  templates: CatalogTemplateRevision[]
}

export type CatalogArtifactDescriptor = {
  url: string
  sha256: string
  sizeBytes: number
  expandedSizeBytes: number
}

export type CatalogManifest = {
  schemaVersion: number
  catalogRevision: number
  generatedAt: string
  expiresAt: string
  snapshot: CatalogArtifactDescriptor
  digests: CatalogArtifactDescriptor
}

export type CatalogDigestObservation = {
  hash: string
  state: 'published' | 'pending' | 'suppressed'
  revision?: number
  retryAfter?: string | null
}

export type CatalogDigestEntry = {
  identityHash: string
  fingerprintVersion?: FingerprintVersion
  identityAliases?: CatalogIdentityAlias[]
  templateKey?: string
  contentHashes: CatalogDigestObservation[]
}

export type CatalogDigestIndex = {
  schemaVersion: number
  fingerprintVersion: number
  manufacturerAliasVersion: number
  catalogRevision: number
  generatedAt: string
  entries: CatalogDigestEntry[]
}

export type CatalogSignature = {
  algorithm: 'Ed25519'
  keyId: string
  value: string
}

export type SignedCatalogArtifact<T> = {
  payload: T
  signature: CatalogSignature
}

export type CatalogVerificationKey = {
  keyId: string
  publicKey: string
  notBefore?: string
  notAfter?: string
}
