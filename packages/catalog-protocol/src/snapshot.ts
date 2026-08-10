import { canonicalJson } from './canonicalize'
import { sha256Hex } from './hash'
import { digestCatalogTemplate } from './projector'
import {
  CATALOG_SCHEMA_VERSION,
  LEGACY_FINGERPRINT_VERSION,
  SUPPORTED_FINGERPRINT_VERSIONS,
  type FingerprintVersion,
} from './types'
import type {
  CatalogManifest,
  CatalogDigestIndex,
  CatalogSnapshot,
  CatalogTemplateRevision,
} from './types'

export const DEFAULT_MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024
export const DEFAULT_MAX_CATALOG_TEMPLATES = 100_000

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} must be a positive integer.`)
}

function assertTimestamp(value: unknown, label: string): number {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp.`)
  }
  return Date.parse(value)
}

function assertHexDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a SHA-256 hex digest.`)
  }
}

function fingerprintVersion(value: unknown, label: string): FingerprintVersion {
  const resolved = value === undefined ? LEGACY_FINGERPRINT_VERSION : Number(value)
  if (!(SUPPORTED_FINGERPRINT_VERSIONS as readonly number[]).includes(resolved)) {
    throw new Error(`${label} fingerprint version is unsupported.`)
  }
  return resolved as FingerprintVersion
}

export async function validateCatalogSnapshot(
  value: unknown,
  options: {
    now?: Date
    maxBytes?: number
    maxTemplates?: number
  } = {},
): Promise<CatalogSnapshot> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_SNAPSHOT_BYTES
  const byteLength = new TextEncoder().encode(JSON.stringify(value)).byteLength
  if (byteLength > maxBytes) throw new Error(`Catalog snapshot exceeds the ${maxBytes}-byte limit.`)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Catalog snapshot must be an object.')

  const source = value as Record<string, unknown>
  if (source.schemaVersion !== CATALOG_SCHEMA_VERSION) {
    throw new Error(`Catalog schema ${String(source.schemaVersion)} is unsupported.`)
  }
  assertPositiveInteger(source.catalogRevision, 'Catalog revision')
  const generatedAt = assertTimestamp(source.generatedAt, 'Catalog generatedAt')
  if (generatedAt > (options.now ?? new Date()).getTime() + 5 * 60_000) {
    throw new Error('Catalog snapshot was generated in the future.')
  }
  if (source.expiresAt !== undefined && assertTimestamp(source.expiresAt, 'Catalog expiresAt') <= (options.now ?? new Date()).getTime()) {
    throw new Error('Catalog snapshot has expired.')
  }
  if (!source.manufacturerAliases || typeof source.manufacturerAliases !== 'object' || Array.isArray(source.manufacturerAliases)) {
    throw new Error('Catalog manufacturerAliases must be an object.')
  }
  if (!Array.isArray(source.templates)) throw new Error('Catalog templates must be an array.')
  const maxTemplates = options.maxTemplates ?? DEFAULT_MAX_CATALOG_TEMPLATES
  if (source.templates.length > maxTemplates) throw new Error(`Catalog snapshot exceeds the ${maxTemplates}-template limit.`)

  const templateKeys = new Set<string>()
  const identities = new Map<string, string>()
  const templates: CatalogTemplateRevision[] = []
  for (const [index, raw] of source.templates.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Catalog template ${index} must be an object.`)
    const template = raw as Record<string, unknown>
    if (typeof template.templateKey !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(template.templateKey)) {
      throw new Error(`Catalog template ${index} has an invalid public key.`)
    }
    assertPositiveInteger(template.revision, `Catalog template ${index} revision`)
    assertHexDigest(template.identityHash, `Catalog template ${index} identityHash`)
    assertHexDigest(template.contentHash, `Catalog template ${index} contentHash`)
    if (templateKeys.has(template.templateKey)) throw new Error(`Catalog template key ${template.templateKey} is duplicated.`)
    const version = fingerprintVersion(template.fingerprintVersion, `Catalog template ${index}`)
    const existingCanonical = identities.get(template.identityHash as string)
    if (existingCanonical) throw new Error(`Catalog identity ${template.identityHash} is duplicated by ${existingCanonical}.`)
    const projection = await digestCatalogTemplate(template.item, { fingerprintVersion: version })
    const { item, identityHash, contentHash } = projection
    const digests = { identityHash, contentHash }
    if (digests.identityHash !== template.identityHash || digests.contentHash !== template.contentHash) {
      throw new Error(`Catalog template ${template.templateKey} does not match its declared hashes.`)
    }
    const identityAliases = Array.isArray(template.identityAliases)
      ? template.identityAliases.map((rawAlias, aliasIndex) => {
          if (!rawAlias || typeof rawAlias !== 'object' || Array.isArray(rawAlias)) {
            throw new Error(`Catalog template ${template.templateKey} alias ${aliasIndex} is invalid.`)
          }
          const alias = rawAlias as Record<string, unknown>
          const aliasVersion = fingerprintVersion(alias.fingerprintVersion, `Catalog template ${template.templateKey} alias ${aliasIndex}`)
          assertHexDigest(alias.identityHash, `Catalog template ${template.templateKey} alias ${aliasIndex} identityHash`)
          if (alias.identityHash === template.identityHash) {
            throw new Error(`Catalog template ${template.templateKey} repeats its canonical identity as an alias.`)
          }
          const owner = identities.get(alias.identityHash)
          if (owner) throw new Error(`Catalog identity alias ${alias.identityHash} collides with ${owner}.`)
          identities.set(alias.identityHash, template.templateKey as string)
          return { fingerprintVersion: aliasVersion, identityHash: alias.identityHash }
        })
      : []
    templateKeys.add(template.templateKey)
    identities.set(template.identityHash, template.templateKey)
    templates.push({
      templateKey: template.templateKey,
      revision: template.revision,
      fingerprintVersion: version,
      ...(identityAliases.length > 0 ? { identityAliases } : {}),
      ...(projection.productFamily ? { productFamily: projection.productFamily } : {}),
      ...(projection.variantEvidence ? { variantEvidence: projection.variantEvidence } : {}),
      ...digests,
      item,
    })
  }

  const manufacturerAliases: Record<string, string> = {}
  for (const [alias, manufacturer] of Object.entries(source.manufacturerAliases as Record<string, unknown>).sort()) {
    if (typeof manufacturer !== 'string' || manufacturer.trim() === '') throw new Error(`Manufacturer alias ${alias} is invalid.`)
    manufacturerAliases[alias] = manufacturer
  }

  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    catalogRevision: source.catalogRevision,
    generatedAt: source.generatedAt as string,
    ...(source.expiresAt === undefined ? {} : { expiresAt: source.expiresAt as string }),
    manufacturerAliases,
    templates: templates.sort((left, right) => left.templateKey.localeCompare(right.templateKey)),
  }
}

export async function catalogSnapshotDigest(snapshot: CatalogSnapshot): Promise<string> {
  return sha256Hex(canonicalJson(snapshot))
}

export function validateCatalogManifest(
  value: unknown,
  options: { now?: Date } = {},
): CatalogManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Catalog manifest must be an object.')
  const source = value as Record<string, unknown>
  if (source.schemaVersion !== CATALOG_SCHEMA_VERSION) throw new Error(`Catalog schema ${String(source.schemaVersion)} is unsupported.`)
  assertPositiveInteger(source.catalogRevision, 'Catalog revision')
  assertTimestamp(source.generatedAt, 'Catalog generatedAt')
  if (assertTimestamp(source.expiresAt, 'Catalog expiresAt') <= (options.now ?? new Date()).getTime()) {
    throw new Error('Catalog manifest has expired.')
  }
  for (const [field, label] of [['snapshot', 'snapshot'], ['digests', 'digest index'], ['facets', 'facet index']] as const) {
    if (field === 'facets' && source[field] === undefined) continue
    if (!source[field] || typeof source[field] !== 'object' || Array.isArray(source[field])) {
      throw new Error(`Catalog manifest ${label} descriptor is invalid.`)
    }
    const descriptor = source[field] as Record<string, unknown>
    if (typeof descriptor.url !== 'string' || !descriptor.url.startsWith('https://')) {
      throw new Error(`Catalog ${label} URL must use HTTPS.`)
    }
    assertHexDigest(descriptor.sha256, `Catalog ${label} checksum`)
    assertPositiveInteger(descriptor.sizeBytes, `Catalog ${label} size`)
    assertPositiveInteger(descriptor.expandedSizeBytes, `Catalog ${label} expanded size`)
    if (Number(descriptor.expandedSizeBytes) < Number(descriptor.sizeBytes)) {
      throw new Error(`Catalog ${label} expanded size cannot be smaller than its artifact size.`)
    }
  }
  return value as CatalogManifest
}

export function validateCatalogDigestIndex(value: unknown): CatalogDigestIndex {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Catalog digest index must be an object.')
  const source = value as Record<string, unknown>
  if (
    source.schemaVersion !== CATALOG_SCHEMA_VERSION
    || !(SUPPORTED_FINGERPRINT_VERSIONS as readonly unknown[]).includes(source.fingerprintVersion)
    || source.manufacturerAliasVersion !== 1
  ) {
    throw new Error('Catalog digest index protocol versions are unsupported.')
  }
  assertPositiveInteger(source.catalogRevision, 'Catalog digest revision')
  assertTimestamp(source.generatedAt, 'Catalog digest generatedAt')
  if (!Array.isArray(source.entries) || source.entries.length > DEFAULT_MAX_CATALOG_TEMPLATES * 4) {
    throw new Error('Catalog digest entries are invalid or exceed the limit.')
  }
  const entries = source.entries.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Catalog digest entry ${index} is invalid.`)
    const entry = raw as Record<string, unknown>
    assertHexDigest(entry.identityHash, `Catalog digest entry ${index} identityHash`)
    const entryFingerprintVersion = fingerprintVersion(entry.fingerprintVersion ?? source.fingerprintVersion, `Catalog digest entry ${index}`)
    if (entry.templateKey !== undefined && (typeof entry.templateKey !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(entry.templateKey))) {
      throw new Error(`Catalog digest entry ${index} templateKey is invalid.`)
    }
    if (!Array.isArray(entry.contentHashes) || entry.contentHashes.length < 1 || entry.contentHashes.length > 100) {
      throw new Error(`Catalog digest entry ${index} content hashes are invalid.`)
    }
    const seen = new Set<string>()
    const contentHashes = entry.contentHashes.map((rawObservation, observationIndex) => {
      if (!rawObservation || typeof rawObservation !== 'object' || Array.isArray(rawObservation)) {
        throw new Error(`Catalog digest entry ${index} observation ${observationIndex} is invalid.`)
      }
      const observation = rawObservation as Record<string, unknown>
      assertHexDigest(observation.hash, `Catalog digest entry ${index} observation ${observationIndex} hash`)
      if (!['published', 'pending', 'suppressed'].includes(String(observation.state))) {
        throw new Error(`Catalog digest entry ${index} observation ${observationIndex} state is invalid.`)
      }
      if (seen.has(observation.hash)) throw new Error(`Catalog digest entry ${index} duplicates a content hash.`)
      seen.add(observation.hash)
      if (observation.revision !== undefined) assertPositiveInteger(observation.revision, `Catalog digest entry ${index} observation ${observationIndex} revision`)
      if (observation.retryAfter !== undefined && observation.retryAfter !== null) {
        assertTimestamp(observation.retryAfter, `Catalog digest entry ${index} observation ${observationIndex} retryAfter`)
      }
      return {
        hash: observation.hash,
        state: observation.state as 'published' | 'pending' | 'suppressed',
        ...(observation.revision === undefined ? {} : { revision: Number(observation.revision) }),
        ...(observation.retryAfter === undefined ? {} : { retryAfter: observation.retryAfter as string | null }),
      }
    })
    const identityAliases = Array.isArray(entry.identityAliases)
      ? entry.identityAliases.map((rawAlias, aliasIndex) => {
          if (!rawAlias || typeof rawAlias !== 'object' || Array.isArray(rawAlias)) {
            throw new Error(`Catalog digest entry ${index} alias ${aliasIndex} is invalid.`)
          }
          const alias = rawAlias as Record<string, unknown>
          assertHexDigest(alias.identityHash, `Catalog digest entry ${index} alias ${aliasIndex} identityHash`)
          return {
            fingerprintVersion: fingerprintVersion(alias.fingerprintVersion, `Catalog digest entry ${index} alias ${aliasIndex}`),
            identityHash: alias.identityHash,
          }
        })
      : []
    return {
      identityHash: entry.identityHash,
      fingerprintVersion: entryFingerprintVersion,
      ...(identityAliases.length > 0 ? { identityAliases } : {}),
      ...(entry.templateKey === undefined ? {} : { templateKey: entry.templateKey as string }),
      contentHashes,
    }
  })
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    fingerprintVersion: source.fingerprintVersion as FingerprintVersion,
    manufacturerAliasVersion: 1,
    catalogRevision: Number(source.catalogRevision),
    generatedAt: String(source.generatedAt),
    entries,
  }
}
