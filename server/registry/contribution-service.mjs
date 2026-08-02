import {
  FINGERPRINT_VERSION,
  LEGACY_FINGERPRINT_VERSION,
  OEM_FINGERPRINT_VERSION,
  projectCatalogItem,
  reconcileCatalogProjections,
  sha256Hex,
} from '../../packages/catalog-protocol/src/index.ts'
import { projectLocalItemForCatalog } from './local-catalog-mapping.mjs'
import { matchOemVariant } from './oem-variant-matcher.mjs'

const MAX_OUTBOX_RECORDS = 10_000

function nextId(records) {
  return records.reduce((maximum, record) => Math.max(maximum, Number(record.id) || 0), 0) + 1
}

function itemKey(type, id) {
  return `${type}:${String(id)}`
}

function identityKey(fingerprintVersion, identityHash) {
  return `${String(fingerprintVersion)}:${identityHash}`
}

function contributionKey(fingerprintVersion, identityHash, contentHash) {
  return `${identityKey(fingerprintVersion, identityHash)}:${contentHash}`
}

function fingerprintVersionForItem(item) {
  const catalogItem = projectLocalItemForCatalog(item, item.type)
  return ['desktop', 'server', 'nas'].includes(catalogItem.type)
    && typeof catalogItem.manufacturer === 'string'
    && typeof catalogItem.model === 'string'
    ? OEM_FINGERPRINT_VERSION
    : FINGERPRINT_VERSION
}

async function projectLocalInventoryItem(item, fingerprintVersion) {
  const catalogItem = projectLocalItemForCatalog(item, item.type)
  const projection = await projectCatalogItem(catalogItem, { fingerprintVersion })
  return { ...projection, source: { itemType: item.type, itemId: item.id } }
}

export async function discoverContributionCandidates(
  store,
  now = new Date(),
  externalKnownHashes = [],
  { explicit = false, linkOnly = false } = {},
) {
  const registry = store.getRegistryState()
  if (registry.settings.mode !== 'connected') {
    return { queued: 0, skipped: 0 }
  }
  const contributionsAllowed = !linkOnly
    && (explicit || registry.settings.automaticContributions === true)
  if (!contributionsAllowed && !linkOnly) return { queued: 0, skipped: 0 }

  const externalEntries = externalKnownHashes instanceof Map
    ? externalKnownHashes
    : new Map([...externalKnownHashes].map((hash) => [hash, null]))
  const publishedByIdentity = new Map()
  const publishedCandidates = []
  for (const [contentHash, entry] of externalEntries) {
    if (entry?.state !== 'published' || !entry.identityHash || !entry.templateKey) continue
    publishedCandidates.push({ ...entry, contentHash })
    const canonicalFingerprintVersion = entry.fingerprintVersion ?? LEGACY_FINGERPRINT_VERSION
    const identities = [
      { identityHash: entry.identityHash, fingerprintVersion: canonicalFingerprintVersion },
      ...(entry.identityAliases ?? []),
    ]
    for (const identity of identities) {
      const key = identityKey(identity.fingerprintVersion ?? canonicalFingerprintVersion, identity.identityHash)
      const current = publishedByIdentity.get(key)
      if (!current || (entry.revision ?? 1) > (current.revision ?? 1)) {
        publishedByIdentity.set(key, {
          ...entry,
          matchedIdentityHash: identity.identityHash,
          matchedFingerprintVersion: identity.fingerprintVersion,
          contentHash,
        })
      }
    }
  }
  const knownHashes = new Set([
    ...registry.links.map((link) => link.importedContentHash),
    ...registry.contributionOutbox.map((record) => record.contentHash),
    ...registry.contributionLedger.map((record) => record.contentHash),
    ...externalEntries.keys(),
  ])
  const linkedItems = new Set(registry.links
    .filter((link) => ['linked', 'update-available', 'adoption-available'].includes(link.state))
    .map((link) => itemKey(link.itemType, link.itemId)))
  const candidates = []
  const projections = []
  const compatibilityIdentitiesByItem = new Map()
  let skipped = 0

  for (const item of Object.values(store.getProject().items)) {
    if (!Number.isSafeInteger(item.id) || item.id < 1 || linkedItems.has(itemKey(item.type, item.id))) {
      skipped += 1
      continue
    }
    const fingerprintVersion = fingerprintVersionForItem(item)
    const compatibilityVersions = [...new Set([
      FINGERPRINT_VERSION,
      LEGACY_FINGERPRINT_VERSION,
    ].filter((version) => version !== fingerprintVersion))]
    const [projection, ...compatibilityProjections] = await Promise.all([
      projectLocalInventoryItem(item, fingerprintVersion).catch(() => null),
      ...compatibilityVersions.map((version) => projectLocalInventoryItem(item, version).catch(() => null)),
    ])
    if (!projection || projection.status !== 'eligible') skipped += 1
    else {
      projections.push(projection)
      compatibilityIdentitiesByItem.set(
        itemKey(projection.source.itemType, projection.source.itemId),
        compatibilityProjections
          .filter((candidate) => candidate?.status === 'eligible')
          .map((candidate) => ({
            fingerprintVersion: candidate.fingerprintVersion,
            identityHash: candidate.identityHash,
            contentHash: candidate.contentHash,
          })),
      )
    }
  }

  const groups = await reconcileCatalogProjections(projections)
  const activeGroupsByContribution = new Map(groups
    .filter((group) => group.status !== 'withheld-conflict')
    .map((group) => [
      contributionKey(group.fingerprintVersion ?? FINGERPRINT_VERSION, group.identityHash, group.contentHash),
      group,
    ]))
  const retainedOutbox = registry.contributionOutbox.filter((record) => {
    if (!['queued', 'retrying'].includes(record.state)) return true
    return activeGroupsByContribution.has(contributionKey(
      record.fingerprintVersion ?? FINGERPRINT_VERSION,
      record.identityHash,
      record.contentHash,
    ))
  })
  const activeSourceId = registry.snapshot?.sourceId
  const links = []
  const adoptions = []
  const ambiguousMatches = []
  for (const group of groups) {
    if (group.status === 'withheld-conflict') continue
    const exact = externalEntries.get(group.contentHash)
    const canonicalMatch = publishedByIdentity.get(identityKey(group.fingerprintVersion, group.identityHash))
    const compatibilityMatches = []
    for (const fingerprintVersion of [FINGERPRINT_VERSION, LEGACY_FINGERPRINT_VERSION]) {
      const identities = new Set(group.sources
        .flatMap((source) => compatibilityIdentitiesByItem.get(itemKey(source.itemType, source.itemId)) ?? [])
        .filter((identity) => identity.fingerprintVersion === fingerprintVersion)
        .map((identity) => identity.identityHash))
      if (identities.size !== 1) continue
      const match = publishedByIdentity.get(identityKey(fingerprintVersion, [...identities][0]))
      if (match) compatibilityMatches.push({ match, fingerprintVersion })
    }
    const oemMatch = canonicalMatch || group.fingerprintVersion !== OEM_FINGERPRINT_VERSION
      ? { outcome: 'none' }
      : matchOemVariant(group, publishedCandidates)
    const compatibilityMatch = compatibilityMatches[0]
    const identityMatch = canonicalMatch
      ?? (oemMatch.outcome === 'match' ? oemMatch.match : undefined)
      ?? compatibilityMatch?.match
    if (exact?.state === 'published' && exact.templateKey && Number.isSafeInteger(activeSourceId)) {
      for (const source of group.sources) links.push({ source, exact, contentHash: group.contentHash })
      skipped += group.sources.length
      continue
    }
    if (identityMatch && Number.isSafeInteger(activeSourceId)) {
      for (const source of group.sources) {
        const localContentHash = compatibilityMatch
          ? compatibilityIdentitiesByItem.get(itemKey(source.itemType, source.itemId))
            ?.find((identity) => identity.fingerprintVersion === compatibilityMatch.fingerprintVersion)
            ?.contentHash
          : group.contentHash
        adoptions.push({ source, match: identityMatch, localContentHash: localContentHash ?? group.contentHash })
      }
      skipped += group.sources.length
      continue
    }
    if (oemMatch.outcome === 'ambiguous' && Number.isSafeInteger(activeSourceId)) {
      for (const source of group.sources) {
        ambiguousMatches.push({
          source,
          productFamily: oemMatch.productFamily,
          candidates: oemMatch.candidates,
          localContentHash: group.contentHash,
          fingerprintVersion: group.fingerprintVersion,
        })
      }
      skipped += group.sources.length
      continue
    }
    if (knownHashes.has(group.contentHash)) {
      skipped += group.sources.length
      continue
    }
    if (!contributionsAllowed) {
      skipped += group.sources.length
      continue
    }
    const primary = group.sources[0]
    const idempotencyKey = await sha256Hex(`hli:contribution:v${group.fingerprintVersion}:${group.identityHash}:${group.contentHash}`)
    candidates.push({
      itemType: primary.itemType,
      itemId: primary.itemId,
      sources: group.sources,
      payload: group.item,
      identityHash: group.identityHash,
      contentHash: group.contentHash,
      fingerprintVersion: group.fingerprintVersion ?? FINGERPRINT_VERSION,
      ...(group.productFamily ? { productFamily: group.productFamily } : {}),
      ...(group.variantEvidence ? { variantEvidence: group.variantEvidence } : {}),
      idempotencyKey,
    })
    knownHashes.add(group.contentHash)
  }

  if (retainedOutbox.length + candidates.length > MAX_OUTBOX_RECORDS) {
    throw new Error('Contribution outbox capacity has been reached. Pause contributions and review registry status.')
  }
  store.registryTransaction((draft) => {
    draft.contributionOutbox = retainedOutbox.map((record) => {
      if (!['queued', 'retrying'].includes(record.state)) return record
      const group = activeGroupsByContribution.get(contributionKey(
        record.fingerprintVersion ?? FINGERPRINT_VERSION,
        record.identityHash,
        record.contentHash,
      ))
      if (!group || group.status === 'withheld-conflict') return record
      return {
        ...record,
        itemType: group.sources[0].itemType,
        itemId: group.sources[0].itemId,
        sources: group.sources,
      }
    })
    const groupIds = new Map(draft.contributionGroups.map((group) => [group.identityHash, group.id]))
    let nextGroupId = nextId(draft.contributionGroups)
    draft.projectionCache = projections.map((projection, index) => ({
      id: index + 1,
      identityHash: projection.identityHash,
      contentHash: projection.contentHash,
      fingerprintVersion: projection.fingerprintVersion,
      ...(projection.productFamily ? { productFamily: projection.productFamily } : {}),
      ...(projection.variantEvidence ? { variantEvidence: projection.variantEvidence } : {}),
      sources: [projection.source],
    }))
    draft.contributionGroups = groups.map((group) => ({
      id: groupIds.get(group.identityHash) ?? nextGroupId++,
      identityHash: group.identityHash,
      fingerprintVersion: group.fingerprintVersion ?? FINGERPRINT_VERSION,
      ...(group.productFamily ? { productFamily: group.productFamily } : {}),
      ...(group.variantEvidence ? { variantEvidence: group.variantEvidence } : {}),
      ...(group.status === 'withheld-conflict'
        ? { status: group.status, sources: group.sources }
        : { status: 'eligible', contentHash: group.contentHash, sources: group.sources }),
    }))
    if (Number.isSafeInteger(activeSourceId)) {
      let linkId = nextId(draft.links)
      for (const { source, exact, contentHash } of links) {
        const existing = draft.links.find((link) => link.itemType === source.itemType && link.itemId === source.itemId)
        if (existing) {
          if (existing.state === 'detached' || existing.state === 'contribution-pending') {
            Object.assign(existing, {
              sourceId: activeSourceId,
              templateKey: exact.templateKey,
              importedRevision: exact.revision ?? 1,
              importedContentHash: contentHash,
              importedFingerprintVersion: exact.fingerprintVersion ?? LEGACY_FINGERPRINT_VERSION,
              ...(exact.productFamily ? { productFamily: exact.productFamily } : {}),
              ...(exact.variantEvidence ? { variantEvidence: exact.variantEvidence } : {}),
              ...(exact.identityAliases ? { identityAliases: exact.identityAliases } : {}),
              state: 'linked',
              linkedAt: now.toISOString(),
            })
            delete existing.availableRevision
            delete existing.availableContentHash
            delete existing.detachedAt
          }
          continue
        }
        draft.links.push({
          id: linkId++, itemType: source.itemType, itemId: source.itemId, sourceId: activeSourceId,
          templateKey: exact.templateKey, importedRevision: exact.revision ?? 1,
          importedContentHash: contentHash, state: 'linked', linkedAt: now.toISOString(),
          importedFingerprintVersion: exact.fingerprintVersion ?? LEGACY_FINGERPRINT_VERSION,
          ...(exact.productFamily ? { productFamily: exact.productFamily } : {}),
          ...(exact.variantEvidence ? { variantEvidence: exact.variantEvidence } : {}),
          ...(exact.identityAliases ? { identityAliases: exact.identityAliases } : {}),
        })
      }
      for (const { source, match, localContentHash } of adoptions) {
        const existing = draft.links.find((link) => link.itemType === source.itemType && link.itemId === source.itemId)
        if (existing) continue
        draft.links.push({
          id: linkId++, itemType: source.itemType, itemId: source.itemId, sourceId: activeSourceId,
          templateKey: match.templateKey, importedRevision: match.revision ?? 1,
          importedContentHash: localContentHash, state: 'adoption-available', linkedAt: now.toISOString(),
          importedFingerprintVersion: match.matchedFingerprintVersion ?? match.fingerprintVersion ?? FINGERPRINT_VERSION,
          ...(match.productFamily ? { productFamily: match.productFamily } : {}),
          ...(match.variantEvidence ? { variantEvidence: match.variantEvidence } : {}),
          ...(match.identityAliases ? { identityAliases: match.identityAliases } : {}),
          availableRevision: match.revision ?? 1, availableContentHash: match.contentHash,
        })
      }
      const unlinkedItems = new Set(projections.flatMap((projection) => projection.sources ?? [projection.source])
        .map((source) => itemKey(source.itemType, source.itemId)))
      draft.variantMatches = (draft.variantMatches ?? []).filter((record) => (
        !unlinkedItems.has(itemKey(record.itemType, record.itemId))
      ))
      let variantMatchId = nextId(draft.variantMatches)
      for (const match of ambiguousMatches) {
        draft.variantMatches.push({
          id: variantMatchId++,
          itemType: match.source.itemType,
          itemId: match.source.itemId,
          sourceId: activeSourceId,
          productFamily: match.productFamily,
          candidates: match.candidates,
          localContentHash: match.localContentHash,
          fingerprintVersion: match.fingerprintVersion,
          createdAt: now.toISOString(),
        })
      }
    }
    let id = nextId(draft.contributionOutbox)
    for (const candidate of candidates) {
      draft.contributionOutbox.push({
        id,
        ...candidate,
        state: 'queued',
        attempts: 0,
        createdAt: now.toISOString(),
        nextAttemptAt: now.toISOString(),
        lastError: null,
      })
      id += 1
    }
  })
  return { queued: candidates.length, skipped }
}

export function contributionStatus(store) {
  const registry = store.getRegistryState()
  const count = (records, state) => records.filter((record) => record.state === state).length
  return {
    enabled: registry.settings.mode === 'connected' && registry.settings.automaticContributions === true,
    queued: count(registry.contributionOutbox, 'queued'),
    retrying: count(registry.contributionOutbox, 'retrying'),
    delivered: count(registry.contributionLedger, 'delivered'),
    accepted: count(registry.contributionLedger, 'accepted'),
    rejected: count(registry.contributionLedger, 'rejected'),
    suppressed: count(registry.contributionLedger, 'suppressed'),
    enrollment: registry.installationIdentity?.state ?? 'not-enrolled',
    tokenExpiresAt: registry.installationIdentity?.tokenExpiresAt ?? null,
    lastError: registry.contributionOutbox.find((record) => record.lastError)?.lastError ?? null,
  }
}
