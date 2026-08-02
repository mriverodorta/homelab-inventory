import {
  FINGERPRINT_VERSION,
  LEGACY_FINGERPRINT_VERSION,
  SUPPORTED_FINGERPRINT_VERSIONS,
  canonicalJson,
  computeCatalogDigests,
  sanitizeCatalogItem,
  sha256Hex,
} from '../../packages/catalog-protocol/src/index.ts'
import { isRelationalId } from '../db/relational-ids.mjs'

export const REGISTRY_MODES = new Set(['disabled', 'offline', 'connected'])
export const INVENTORY_SOURCE_TABS = new Set(['catalog', 'manual', 'private-templates'])
export const MAX_PRIVATE_TEMPLATE_IMPORT_COUNT = 1_000
const MAX_PRIVATE_TEMPLATE_NAME_LENGTH = 160
const MAX_PRIVATE_TEMPLATE_DESCRIPTION_LENGTH = 1_000

function isFingerprintVersion(value) {
  return SUPPORTED_FINGERPRINT_VERSIONS.includes(value)
}

export function createRegistryStore() {
  return {
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
    contributionOutbox: [],
    contributionLedger: [],
    contributionGroups: [],
    projectionCache: [],
    privateTemplates: [],
    snapshot: null,
    installationIdentity: null,
  }
}

function cleanOptionalString(value) {
  if (typeof value !== 'string') return undefined
  const cleaned = value.trim().replace(/\s+/g, ' ')
  return cleaned === '' ? undefined : cleaned
}

export function normalizeRegistryStore(value) {
  const defaults = createRegistryStore()
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const rawSettings = source.settings && typeof source.settings === 'object' && !Array.isArray(source.settings)
    ? source.settings
    : {}

  return {
    settings: {
      mode: REGISTRY_MODES.has(rawSettings.mode) ? rawSettings.mode : defaults.settings.mode,
      defaultInventorySource: INVENTORY_SOURCE_TABS.has(rawSettings.defaultInventorySource)
        ? rawSettings.defaultInventorySource
        : defaults.settings.defaultInventorySource,
      automaticContributions: rawSettings.mode === 'connected' && rawSettings.automaticContributions === true,
      showRegistryLinkIndicators: rawSettings.showRegistryLinkIndicators === true,
      updatedAt: typeof rawSettings.updatedAt === 'string' ? rawSettings.updatedAt : null,
    },
    sources: Array.isArray(source.sources) ? source.sources : [],
    links: Array.isArray(source.links) ? source.links : [],
    variantMatches: Array.isArray(source.variantMatches) ? source.variantMatches : [],
    contributionOutbox: Array.isArray(source.contributionOutbox)
      ? source.contributionOutbox.map((record) => ({
          ...record,
          fingerprintVersion: isFingerprintVersion(record?.fingerprintVersion)
            ? record.fingerprintVersion
            : LEGACY_FINGERPRINT_VERSION,
          ...(record?.state === 'delivering'
            ? { state: 'retrying', lastError: 'Delivery was interrupted before completion.' }
            : {}),
        }))
      : [],
    contributionLedger: Array.isArray(source.contributionLedger)
      ? source.contributionLedger.map((record) => ({ ...record, fingerprintVersion: record?.fingerprintVersion ?? LEGACY_FINGERPRINT_VERSION }))
      : [],
    contributionGroups: Array.isArray(source.contributionGroups)
      ? source.contributionGroups.map((record) => ({ ...record, fingerprintVersion: record?.fingerprintVersion ?? LEGACY_FINGERPRINT_VERSION }))
      : [],
    projectionCache: Array.isArray(source.projectionCache)
      ? source.projectionCache.map((record) => ({ ...record, fingerprintVersion: record?.fingerprintVersion ?? LEGACY_FINGERPRINT_VERSION }))
      : [],
    privateTemplates: Array.isArray(source.privateTemplates)
      ? source.privateTemplates.map((template) => ({
          ...template,
          name: cleanOptionalString(template?.name) ?? '',
          ...(cleanOptionalString(template?.description)
            ? { description: cleanOptionalString(template.description) }
            : {}),
        }))
      : [],
    snapshot: source.snapshot ?? null,
    installationIdentity: source.installationIdentity ?? null,
  }
}

function assertUniqueNumericIds(records, field) {
  const ids = new Set()
  records.forEach((record, index) => {
    if (!isRelationalId(record?.id)) throw new Error(`${field}[${index}].id must be a positive safe integer.`)
    if (ids.has(record.id)) throw new Error(`${field}[${index}].id must be unique.`)
    ids.add(record.id)
  })
}

export function assertRegistryStoreShape(store) {
  if (!store || typeof store !== 'object' || Array.isArray(store)) {
    throw new Error('Registry store must be an object.')
  }
  if (!store.settings || typeof store.settings !== 'object' || Array.isArray(store.settings)) {
    throw new Error('registry.settings must be an object.')
  }
  if (!REGISTRY_MODES.has(store.settings.mode)) throw new Error('registry.settings.mode is unsupported.')
  if (!INVENTORY_SOURCE_TABS.has(store.settings.defaultInventorySource)) {
    throw new Error('registry.settings.defaultInventorySource is unsupported.')
  }
  if (typeof store.settings.automaticContributions !== 'boolean') {
    throw new Error('registry.settings.automaticContributions must be boolean.')
  }
  if (typeof store.settings.showRegistryLinkIndicators !== 'boolean') {
    throw new Error('registry.settings.showRegistryLinkIndicators must be boolean.')
  }
  if (store.settings.mode !== 'connected' && store.settings.automaticContributions) {
    throw new Error('registry.settings.automaticContributions requires connected mode.')
  }
  if (store.settings.updatedAt !== null && typeof store.settings.updatedAt !== 'string') {
    throw new Error('registry.settings.updatedAt must be a timestamp or null.')
  }

  for (const collection of [
    'sources',
    'links',
    'variantMatches',
    'contributionOutbox',
    'contributionLedger',
    'contributionGroups',
    'projectionCache',
    'privateTemplates',
  ]) {
    if (!Array.isArray(store[collection])) throw new Error(`registry.${collection} must be an array.`)
  }

  assertUniqueNumericIds(store.privateTemplates, 'registry.privateTemplates')
  assertUniqueNumericIds(store.sources, 'registry.sources')
  assertUniqueNumericIds(store.links, 'registry.links')
  assertUniqueNumericIds(store.variantMatches, 'registry.variantMatches')
  assertUniqueNumericIds(store.contributionOutbox, 'registry.contributionOutbox')
  assertUniqueNumericIds(store.contributionLedger, 'registry.contributionLedger')
  assertUniqueNumericIds(store.contributionGroups, 'registry.contributionGroups')
  assertUniqueNumericIds(store.projectionCache, 'registry.projectionCache')
  store.sources.forEach((source, index) => {
    if (!['official-connected', 'official-offline', 'private'].includes(source.kind)) {
      throw new Error(`registry.sources[${index}].kind is unsupported.`)
    }
    if (typeof source.displayName !== 'string' || source.displayName.trim() === '') {
      throw new Error(`registry.sources[${index}].displayName must be a non-empty string.`)
    }
  })
  store.links.forEach((link, index) => {
    if (typeof link.itemType !== 'string' || link.itemType.trim() === '' || !isRelationalId(link.itemId)) {
      throw new Error(`registry.links[${index}] must reference an inventory type and numeric ID.`)
    }
    if (!isRelationalId(link.sourceId) || !store.sources.some((source) => source.id === link.sourceId)) {
      throw new Error(`registry.links[${index}].sourceId must reference a registry source.`)
    }
    if (typeof link.templateKey !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(link.templateKey)) {
      throw new Error(`registry.links[${index}].templateKey is invalid.`)
    }
    if (!isRelationalId(link.importedRevision)) {
      throw new Error(`registry.links[${index}].importedRevision must be a positive safe integer.`)
    }
    if (typeof link.importedContentHash !== 'string' || !/^[a-f0-9]{64}$/.test(link.importedContentHash)) {
      throw new Error(`registry.links[${index}].importedContentHash must be a SHA-256 hex digest.`)
    }
    if (!['linked', 'update-available', 'adoption-available', 'detached', 'contribution-pending'].includes(link.state)) {
      throw new Error(`registry.links[${index}].state is unsupported.`)
    }
    if (!isFingerprintVersion(link.importedFingerprintVersion ?? LEGACY_FINGERPRINT_VERSION)) {
      throw new Error(`registry.links[${index}].importedFingerprintVersion is unsupported.`)
    }
  })
  store.variantMatches.forEach((match, index) => {
    if (typeof match.itemType !== 'string' || match.itemType.trim() === '' || !isRelationalId(match.itemId)) {
      throw new Error(`registry.variantMatches[${index}] must reference an inventory type and numeric ID.`)
    }
    if (!isRelationalId(match.sourceId) || !store.sources.some((source) => source.id === match.sourceId)) {
      throw new Error(`registry.variantMatches[${index}].sourceId must reference a registry source.`)
    }
    if (!isFingerprintVersion(match.fingerprintVersion)) {
      throw new Error(`registry.variantMatches[${index}].fingerprintVersion is unsupported.`)
    }
    if (!match.productFamily || typeof match.productFamily !== 'object' || Array.isArray(match.productFamily)) {
      throw new Error(`registry.variantMatches[${index}].productFamily is required.`)
    }
    if (!Array.isArray(match.candidates) || match.candidates.length < 2) {
      throw new Error(`registry.variantMatches[${index}].candidates must contain ambiguous variants.`)
    }
    if (match.candidates.some((candidate) => (
      typeof candidate?.templateKey !== 'string'
      || !/^[A-Za-z0-9_-]{8,128}$/.test(candidate.templateKey)
      || !isRelationalId(candidate.revision)
    ))) {
      throw new Error(`registry.variantMatches[${index}].candidates contain an invalid catalog reference.`)
    }
    if (typeof match.localContentHash !== 'string' || !/^[a-f0-9]{64}$/.test(match.localContentHash)) {
      throw new Error(`registry.variantMatches[${index}].localContentHash must be a SHA-256 hex digest.`)
    }
  })
  store.contributionOutbox.forEach((record, index) => {
    if (typeof record.itemType !== 'string' || !isRelationalId(record.itemId)) {
      throw new Error(`registry.contributionOutbox[${index}] must reference an inventory item.`)
    }
    if (typeof record.identityHash !== 'string' || !/^[a-f0-9]{64}$/.test(record.identityHash)
      || typeof record.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(record.contentHash)) {
      throw new Error(`registry.contributionOutbox[${index}] hashes are invalid.`)
    }
    if (!['queued', 'retrying', 'delivering'].includes(record.state)) {
      throw new Error(`registry.contributionOutbox[${index}].state is unsupported.`)
    }
    if (!isFingerprintVersion(record.fingerprintVersion ?? FINGERPRINT_VERSION)) {
      throw new Error(`registry.contributionOutbox[${index}].fingerprintVersion is unsupported.`)
    }
    sanitizeCatalogItem(record.payload)
    if (!Array.isArray(record.sources) || record.sources.length < 1) {
      throw new Error(`registry.contributionOutbox[${index}].sources must contain inventory references.`)
    }
  })
  for (const [collection, records] of [['contributionGroups', store.contributionGroups], ['projectionCache', store.projectionCache]]) {
    records.forEach((record, index) => {
      if (!Array.isArray(record.sources) || record.sources.some((source) => (
        typeof source?.itemType !== 'string' || !isRelationalId(source?.itemId)
      ))) {
        throw new Error(`registry.${collection}[${index}].sources must contain typed numeric inventory references.`)
      }
      if (typeof record.identityHash !== 'string' || !/^[a-f0-9]{64}$/.test(record.identityHash)) {
        throw new Error(`registry.${collection}[${index}].identityHash is invalid.`)
      }
      if (!isFingerprintVersion(record.fingerprintVersion ?? LEGACY_FINGERPRINT_VERSION)) {
        throw new Error(`registry.${collection}[${index}].fingerprintVersion is unsupported.`)
      }
    })
  }
  store.contributionLedger.forEach((record, index) => {
    if (typeof record.itemType !== 'string' || !isRelationalId(record.itemId)) {
      throw new Error(`registry.contributionLedger[${index}] must reference an inventory item.`)
    }
    if (typeof record.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(record.contentHash)) {
      throw new Error(`registry.contributionLedger[${index}].contentHash is invalid.`)
    }
    if (!['delivered', 'accepted', 'rejected', 'suppressed'].includes(record.state)) {
      throw new Error(`registry.contributionLedger[${index}].state is unsupported.`)
    }
    if (!isFingerprintVersion(record.fingerprintVersion ?? LEGACY_FINGERPRINT_VERSION)) {
      throw new Error(`registry.contributionLedger[${index}].fingerprintVersion is unsupported.`)
    }
  })
  store.privateTemplates.forEach((template, index) => {
    if (typeof template.name !== 'string' || template.name.trim() === '') {
      throw new Error(`registry.privateTemplates[${index}].name must be a non-empty string.`)
    }
    if (template.description !== undefined && (typeof template.description !== 'string' || template.description.trim() === '')) {
      throw new Error(`registry.privateTemplates[${index}].description must be a non-empty string.`)
    }
    if (typeof template.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(template.checksum)) {
      throw new Error(`registry.privateTemplates[${index}].checksum must be a SHA-256 hex digest.`)
    }
    if (typeof template.createdAt !== 'string' || Number.isNaN(Date.parse(template.createdAt))) {
      throw new Error(`registry.privateTemplates[${index}].createdAt must be a timestamp.`)
    }
    if (typeof template.updatedAt !== 'string' || Number.isNaN(Date.parse(template.updatedAt))) {
      throw new Error(`registry.privateTemplates[${index}].updatedAt must be a timestamp.`)
    }
    sanitizeCatalogItem(template.item)
  })

  if (store.snapshot !== null && (typeof store.snapshot !== 'object' || Array.isArray(store.snapshot))) {
    throw new Error('registry.snapshot must be an object or null.')
  }
  if (store.snapshot !== null) {
    if (!isRelationalId(store.snapshot.sourceId) || !store.sources.some((source) => source.id === store.snapshot.sourceId)) {
      throw new Error('registry.snapshot.sourceId must reference a registry source.')
    }
    if (!isRelationalId(store.snapshot.revision) || !Number.isSafeInteger(store.snapshot.templateCount) || store.snapshot.templateCount < 0) {
      throw new Error('registry.snapshot revision must be positive and templateCount must be non-negative.')
    }
    if (typeof store.snapshot.digest !== 'string' || !/^[a-f0-9]{64}$/.test(store.snapshot.digest)) {
      throw new Error('registry.snapshot.digest must be a SHA-256 hex digest.')
    }
    if (typeof store.snapshot.keyId !== 'string' || store.snapshot.keyId.trim() === '') {
      throw new Error('registry.snapshot.keyId must be a non-empty string.')
    }
  }
  if (
    store.installationIdentity !== null
    && (typeof store.installationIdentity !== 'object' || Array.isArray(store.installationIdentity))
  ) {
    throw new Error('registry.installationIdentity must be an object or null.')
  }
  if (store.installationIdentity !== null) {
    const identity = store.installationIdentity
    if (typeof identity.installationKey !== 'string' || identity.installationKey.trim() === '') {
      throw new Error('registry.installationIdentity.installationKey must be a non-empty string.')
    }
    if (typeof identity.publicKeyId !== 'string' || !/^[a-f0-9]{64}$/.test(identity.publicKeyId)) {
      throw new Error('registry.installationIdentity.publicKeyId must be a SHA-256 digest.')
    }
    if (!['active', 'revoked'].includes(identity.state)) {
      throw new Error('registry.installationIdentity.state is unsupported.')
    }
  }
}

function nextId(records) {
  const maximum = records.reduce((current, record) => Math.max(current, Number(record?.id) || 0), 0)
  if (maximum >= Number.MAX_SAFE_INTEGER) throw new Error('Registry identifiers are exhausted.')
  return maximum + 1
}

export async function createPrivateTemplateRecord(records, input, now = new Date().toISOString()) {
  const name = cleanOptionalString(input?.name)
  if (!name) throw new Error('Private template name is required.')
  if (name.length > MAX_PRIVATE_TEMPLATE_NAME_LENGTH) throw new Error('Private template name is too long.')
  const item = sanitizeCatalogItem(input?.item)
  const { contentHash } = await computeCatalogDigests(item)
  const description = cleanOptionalString(input?.description)
  if (description && description.length > MAX_PRIVATE_TEMPLATE_DESCRIPTION_LENGTH) {
    throw new Error('Private template description is too long.')
  }
  return {
    id: nextId(records),
    name,
    ...(description ? { description } : {}),
    checksum: contentHash,
    createdAt: now,
    updatedAt: now,
    item,
  }
}

export async function createPrivateTemplatePack(templates, exportedAt = new Date().toISOString()) {
  const pack = {
    format: 'homelab-inventory-private-templates',
    version: 1,
    exportedAt,
    templates: templates.map(({ name, description, checksum, item }) => ({
      name,
      ...(description ? { description } : {}),
      checksum,
      item: sanitizeCatalogItem(item),
    })),
  }
  return {
    ...pack,
    checksum: await sha256Hex(`hli:private-template-pack:v1:${canonicalJson(pack)}`),
  }
}

export async function previewPrivateTemplatePack(value) {
  const errors = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, templates: [], errors: ['Template pack must be an object.'] }
  }
  if (value.format !== 'homelab-inventory-private-templates' || value.version !== 1) {
    errors.push('Template pack format or version is unsupported.')
  }
  if (!Array.isArray(value.templates)) errors.push('Template pack templates must be an array.')
  if (Array.isArray(value.templates) && value.templates.length > MAX_PRIVATE_TEMPLATE_IMPORT_COUNT) {
    errors.push(`Template pack cannot contain more than ${MAX_PRIVATE_TEMPLATE_IMPORT_COUNT} templates.`)
  }

  const templates = []
  if (Array.isArray(value.templates) && value.templates.length <= MAX_PRIVATE_TEMPLATE_IMPORT_COUNT) {
    for (const [index, rawTemplate] of value.templates.entries()) {
      try {
        const name = cleanOptionalString(rawTemplate?.name)
        if (!name) throw new Error('name is required')
        if (name.length > MAX_PRIVATE_TEMPLATE_NAME_LENGTH) throw new Error('name is too long')
        const item = sanitizeCatalogItem(rawTemplate.item)
        const { contentHash } = await computeCatalogDigests(item)
        if (rawTemplate.checksum !== contentHash) throw new Error('item checksum does not match')
        const description = cleanOptionalString(rawTemplate.description)
        if (description && description.length > MAX_PRIVATE_TEMPLATE_DESCRIPTION_LENGTH) {
          throw new Error('description is too long')
        }
        templates.push({
          name,
          ...(description ? { description } : {}),
          checksum: contentHash,
          item,
        })
      } catch (error) {
        errors.push(`Template ${index + 1}: ${error instanceof Error ? error.message : 'invalid template'}.`)
      }
    }
  }

  if (typeof value.checksum === 'string') {
    const pack = {
      format: value.format,
      version: value.version,
      exportedAt: value.exportedAt,
      templates: value.templates,
    }
    const expected = await sha256Hex(`hli:private-template-pack:v1:${canonicalJson(pack)}`)
    if (expected !== value.checksum) errors.push('Template pack checksum does not match.')
  } else {
    errors.push('Template pack checksum is required.')
  }

  return { valid: errors.length === 0, templates, errors }
}
