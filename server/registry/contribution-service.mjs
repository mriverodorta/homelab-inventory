import {
  FINGERPRINT_VERSION,
  LEGACY_FINGERPRINT_VERSION,
  projectCatalogItem,
  reconcileCatalogProjections,
  sha256Hex,
} from '../../packages/catalog-protocol/src/index.ts'

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
  for (const [contentHash, entry] of externalEntries) {
    if (entry?.state !== 'published' || !entry.identityHash || !entry.templateKey) continue
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
  const legacyIdentityByItem = new Map()
  let skipped = 0

  for (const item of Object.values(store.getProject().items)) {
    if (!Number.isSafeInteger(item.id) || item.id < 1 || linkedItems.has(itemKey(item.type, item.id))) {
      skipped += 1
      continue
    }
    const [projection, legacyProjection] = await Promise.all([
      projectCatalogItem(item).catch(() => null),
      projectCatalogItem(item, { fingerprintVersion: LEGACY_FINGERPRINT_VERSION }).catch(() => null),
    ])
    if (!projection || projection.status !== 'eligible') skipped += 1
    else {
      projections.push(projection)
      if (legacyProjection?.status === 'eligible') {
        legacyIdentityByItem.set(
          itemKey(projection.source.itemType, projection.source.itemId),
          legacyProjection.identityHash,
        )
      }
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
  for (const group of groups) {
    if (group.status === 'withheld-conflict') continue
    const exact = externalEntries.get(group.contentHash)
    const canonicalMatch = publishedByIdentity.get(identityKey(group.fingerprintVersion, group.identityHash))
    const legacyIdentities = new Set(group.sources
      .map((source) => legacyIdentityByItem.get(itemKey(source.itemType, source.itemId)))
      .filter(Boolean))
    const legacyIdentity = legacyIdentities.size === 1 ? [...legacyIdentities][0] : undefined
    const identityMatch = canonicalMatch ?? (legacyIdentity
      ? publishedByIdentity.get(identityKey(LEGACY_FINGERPRINT_VERSION, legacyIdentity))
      : undefined)
    if (exact?.state === 'published' && exact.templateKey && Number.isSafeInteger(activeSourceId)) {
      for (const source of group.sources) links.push({ source, exact, contentHash: group.contentHash })
      skipped += group.sources.length
      continue
    }
    if (identityMatch && Number.isSafeInteger(activeSourceId)) {
      for (const source of group.sources) {
        adoptions.push({ source, match: identityMatch, localContentHash: group.contentHash })
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
          availableRevision: match.revision ?? 1, availableContentHash: match.contentHash,
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
