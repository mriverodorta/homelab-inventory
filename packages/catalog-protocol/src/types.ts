export const CATALOG_SCHEMA_VERSION = 1
export const LEGACY_FINGERPRINT_VERSION = 2
export const FINGERPRINT_VERSION = 3
export const OEM_FINGERPRINT_VERSION = 4
export const WORKSTATION_FINGERPRINT_VERSION = 5
export const SERVER_FINGERPRINT_VERSION = 6
export const MOTHERBOARD_FINGERPRINT_VERSION = 7
export const RAM_FINGERPRINT_VERSION = 8
export const CANONICAL_UNITS_FINGERPRINT_VERSION = 9
export const NAS_FINGERPRINT_VERSION = 10
export const NETWORK_FINGERPRINT_VERSION = 11
export const M2_AE_FINGERPRINT_VERSION = 12
export const SUPPORTED_FINGERPRINT_VERSIONS = [
  LEGACY_FINGERPRINT_VERSION,
  FINGERPRINT_VERSION,
  OEM_FINGERPRINT_VERSION,
  WORKSTATION_FINGERPRINT_VERSION,
  SERVER_FINGERPRINT_VERSION,
  MOTHERBOARD_FINGERPRINT_VERSION,
  RAM_FINGERPRINT_VERSION,
  CANONICAL_UNITS_FINGERPRINT_VERSION,
  NAS_FINGERPRINT_VERSION,
  NETWORK_FINGERPRINT_VERSION,
  M2_AE_FINGERPRINT_VERSION,
] as const
export const MANUFACTURER_ALIAS_VERSION = 1

export const CPU_SPEC_KEYS = [
  'socket',
  'cores',
  'threads',
  'baseClockGhz',
  'boostClockGhz',
  'tdpWatts',
  'channels',
  'generation',
  'cacheMb',
  'memoryTypes',
  'memorySpeedsMt',
  'eccSupport',
  'integratedGraphics',
  'pcieGeneration',
  'pcieLanes',
  'maxTemperatureC',
  'launchDate',
  'discontinued',
  'performanceCores',
  'efficiencyCores',
  'configurableTdpMinWatts',
  'configurableTdpMaxWatts',
  'baseClockMhz',
  'boostClockMhz',
  'tdpMw',
  'cacheMib',
  'maxTemperatureMilliCelsius',
  'configurableTdpMinMw',
  'configurableTdpMaxMw',
] as const

export type CpuCatalogSpecKey = typeof CPU_SPEC_KEYS[number]

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

export type CatalogPortOrigin = 'fixed' | 'module'

export type CatalogNetworkTechnology =
  | 'ethernet'
  | 'wifi'
  | 'fibre-channel'
  | 'infiniband'
  | 'converged'
  | 'cellular'
  | 'other'

export type CatalogNetworkHostInterfaceFamily =
  | 'pcie'
  | 'm2-ae'
  | 'm2-bm'
  | 'mini-pcie'
  | 'usb'
  | 'ocp'
  | 'mezzanine'
  | 'onboard'
  | 'proprietary'

export type CatalogNetworkHostInterface = {
  family: CatalogNetworkHostInterfaceFamily
  pcieGeneration?: number
  connectorLanes?: number
  minimumElectricalLanes?: number
  key?: string
  moduleSize?: string
  usbGeneration?: string
  connector?: string
  ocpVersion?: string
  interfaceKey?: string
  requiredBuses?: CatalogRequiredBus[]
}

export type CatalogUsbGeneration =
  | 'USB 1.1'
  | 'USB 2.0'
  | 'USB 3.2 Gen 1'
  | 'USB 3.2 Gen 2'
  | 'USB 3.2 Gen 2x2'
  | 'USB4 20Gbps'
  | 'USB4 40Gbps'
  | 'USB4 80Gbps'

export type CatalogAvailableBus = {
  family: 'pcie' | 'usb'
  lanes?: number
  pcieGeneration?: number
  usbGeneration?: CatalogUsbGeneration
}

export type CatalogRequiredBus = {
  family: 'pcie' | 'usb'
  minimumLanes?: number
  minimumPcieGeneration?: number
  minimumUsbGeneration?: CatalogUsbGeneration
}

export type CatalogNetworkCapabilities = {
  sriov?: boolean
  ptp?: boolean
  pxe?: boolean
  uefiBoot?: boolean
  wakeOnLan?: boolean
  rdmaModes?: string[]
  offloads?: string[]
}

export type CatalogPort = {
  id: number
  key?: string
  kind: string
  type: string
  slotNumber: number
  role?: string
  speed?: string
  speedBps?: number
  supportedSpeedsBps?: number[]
  networkTechnology?: CatalogNetworkTechnology
  operatingModes?: string[]
  media?: string[]
  vendorLock?: boolean
  poe?: boolean
  origin?: CatalogPortOrigin
  endpoints?: CatalogPortEndpoint[]
}

export type CatalogFixedComponentDisposition = 'fixed' | 'soldered'

export type CatalogExternalAdapterDisposition = 'fixed' | 'replaceable'

export type CatalogFixedComponent = {
  id: number
  componentType: string
  disposition: CatalogFixedComponentDisposition
  label: string
  item: CatalogTemplateItem
  templateKey?: string
  templateRevision?: number
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
  aliases?: string[]
  specs?: Record<string, JsonValue>
  ports?: CatalogPort[]
  compatibility?: Record<string, JsonValue>
  fixedComponents?: CatalogFixedComponent[]
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
  facets?: CatalogArtifactDescriptor
}

export type CatalogFacetTermValue = {
  value: string
  label: string
  count: number
}

export type CatalogTermFacet = {
  kind: 'terms'
  key: string
  label: string
  values: CatalogFacetTermValue[]
}

export type CatalogRangeFacet = {
  kind: 'range'
  key: string
  label: string
  minimum: number
  maximum: number
  step: number
  unit?: string | null
}

export type CatalogFacetDefinition = CatalogTermFacet | CatalogRangeFacet
export type CatalogFacet = CatalogFacetDefinition

export type CatalogFacetCategory = {
  type: string
  label: string
  count: number
  facets: CatalogFacetDefinition[]
}

export type CatalogFacetIndex = {
  schemaVersion: 1
  catalogRevision: number
  generatedAt: string
  categories: CatalogFacetCategory[]
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
