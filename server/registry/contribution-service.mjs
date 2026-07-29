import {
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

export async function discoverContributionCandidates(store, now = new Date(), externalKnownHashes = []) {
  const registry = store.getRegistryState()
  if (registry.settings.mode !== 'connected' || registry.settings.automaticContributions !== true) {
    return { queued: 0, skipped: 0 }
  }

  const externalEntries = externalKnownHashes instanceof Map
    ? externalKnownHashes
    : new Map([...externalKnownHashes].map((hash) => [hash, null]))
  const knownHashes = new Set([
    ...registry.links.map((link) => link.importedContentHash),
    ...registry.contributionOutbox.map((record) => record.contentHash),
    ...registry.contributionLedger.map((record) => record.contentHash),
    ...externalEntries.keys(),
  ])
  const linkedItems = new Set(registry.links
    .filter((link) => link.state === 'linked' || link.state === 'update-available')
    .map((link) => itemKey(link.itemType, link.itemId)))
  const candidates = []
  const projections = []
  let skipped = 0

  for (const item of Object.values(store.getProject().items)) {
    if (!Number.isSafeInteger(item.id) || item.id < 1 || linkedItems.has(itemKey(item.type, item.id))) {
      skipped += 1
      continue
    }
    const projection = await projectCatalogItem(item).catch(() => null)
    if (!projection || projection.status !== 'eligible') skipped += 1
    else projections.push(projection)
  }

  const groups = await reconcileCatalogProjections(projections)
  const activeSourceId = registry.snapshot?.sourceId
  const links = []
  for (const group of groups) {
    if (group.status === 'withheld-conflict') continue
    const exact = externalEntries.get(group.contentHash)
    if (knownHashes.has(group.contentHash)) {
      if (exact?.state === 'published' && exact.templateKey && Number.isSafeInteger(activeSourceId)) {
        for (const source of group.sources) links.push({ source, exact, contentHash: group.contentHash })
      }
      skipped += group.sources.length
      continue
    }
    const primary = group.sources[0]
    const idempotencyKey = await sha256Hex(`hli:contribution:v2:${group.identityHash}:${group.contentHash}`)
    candidates.push({
      itemType: primary.itemType,
      itemId: primary.itemId,
      sources: group.sources,
      payload: group.item,
      identityHash: group.identityHash,
      contentHash: group.contentHash,
      idempotencyKey,
    })
    knownHashes.add(group.contentHash)
  }

  if (registry.contributionOutbox.length + candidates.length > MAX_OUTBOX_RECORDS) {
    throw new Error('Contribution outbox capacity has been reached. Pause contributions and review registry status.')
  }
  store.registryTransaction((draft) => {
    const groupIds = new Map(draft.contributionGroups.map((group) => [group.identityHash, group.id]))
    let nextGroupId = nextId(draft.contributionGroups)
    draft.projectionCache = projections.map((projection, index) => ({
      id: index + 1,
      identityHash: projection.identityHash,
      contentHash: projection.contentHash,
      sources: [projection.source],
    }))
    draft.contributionGroups = groups.map((group) => ({
      id: groupIds.get(group.identityHash) ?? nextGroupId++,
      identityHash: group.identityHash,
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
