import { createHash } from 'node:crypto'

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function tokenFor(group, context) {
  const relevantProjectIds = context.projectIdsByLinkId
    ? [...new Set(group.members.flatMap((member) => context.projectIdsByLinkId.get(member.linkId) ?? []))]
    : Object.keys(context.projectRevisions).map(Number)
  const projectRevisions = Object.fromEntries(
    relevantProjectIds.sort((left, right) => left - right).map((projectId) => [projectId, context.projectRevisions[projectId]]),
  )
  return createHash('sha256').update(stableJson({
    groupId: group.id,
    targetContentHash: group.targetContentHash,
    members: group.members.map((member) => ({
      linkId: member.linkId,
      fromRevision: member.fromRevision,
      importedRevision: member.importedRevision,
      importedContentHash: member.importedContentHash,
      classification: member.classification,
    })).sort((left, right) => left.linkId - right.linkId),
    catalogRevision: context.catalogRevision,
    projectRevisions,
    inventoryItemRevisions: Object.fromEntries(group.members
      .map((member) => [member.linkId, context.itemRevisionsByLinkId?.get(member.linkId) ?? null])
      .sort((left, right) => left[0] - right[0])),
  })).digest('hex')
}

function latestRows(rows, identity) {
  const latest = new Map()
  for (const row of rows) {
    const key = identity(row)
    const current = latest.get(key)
    if (
      !current
      || row.evaluatedAtMs > current.evaluatedAtMs
      || (row.evaluatedAtMs === current.evaluatedAtMs && row.id > current.id)
    ) latest.set(key, row)
  }
  return [...latest.values()]
}

function changeKind(change) {
  if (['added', 'removed', 'changed', 'reclassify-resource'].includes(change?.kind)) return change.kind
  if (change?.current === undefined && change?.next !== undefined) return 'added'
  if (change?.current !== undefined && change?.next === undefined) return 'removed'
  return 'changed'
}

function changeImpact(path, impact) {
  if (['metadata', 'compatibility', 'assignment', 'cable', 'topology'].includes(impact)) return impact
  if (/^ports(?:\[|\.)/u.test(path)) return 'cable'
  if (/^fixedComponents(?:\[|\.)/u.test(path)) return 'topology'
  if (/^compatibility\.host\.(?:storageSlots|expansionSlots|optionalModuleSlots|controllerSlots|bootDeviceSlots)/u.test(path)) return 'assignment'
  if (/^compatibility\.host\.power/u.test(path) || path === 'specs.powerConfiguration') return 'topology'
  if (/^compatibility(?:\[|\.)/u.test(path)) return 'compatibility'
  return 'metadata'
}

export function canonicalCatalogFieldChange(change) {
  const path = typeof change?.path === 'string' && change.path
    ? change.path
    : typeof change?.field === 'string' ? change.field : ''
  return {
    path,
    kind: changeKind(change),
    impact: changeImpact(path, change?.impact),
    ...(change && Object.hasOwn(change, 'current') ? { current: change.current } : {}),
    ...(change && Object.hasOwn(change, 'next') ? { next: change.next } : {}),
    ...(change?.operation === 'reclassify-resource' ? { operation: change.operation } : {}),
    ...(change?.from && typeof change.from === 'object' ? { from: change.from } : {}),
    ...(change?.to && typeof change.to === 'object' ? { to: change.to } : {}),
  }
}

export function canonicalCatalogFieldChanges(changes) {
  return Array.isArray(changes) ? changes.map(canonicalCatalogFieldChange) : []
}

export function currentRegistryUpdateEvaluations(evaluations, links) {
  const linksById = new Map(links.map((link) => [link.id, link]))
  return latestRows(evaluations, (row) => row.linkId).filter((row) => {
    const link = linksById.get(row.linkId)
    return row.decision === 'pending'
      && ['update-available', 'adoption-available'].includes(link?.state)
      && row.toRevision === link.availableRevision
      && row.targetContentHash === link.availableContentHash
  })
}

export function registryUpdateHistoryEvaluations(evaluations) {
  return latestRows(
    evaluations.filter((row) => ['applied', 'declined'].includes(row.decision)),
    (row) => `${row.linkId}:${row.toRevision}:${row.targetContentHash}:${row.decision}`,
  )
}

function groupRows(rows, links, status) {
  const linksById = new Map(links.map((link) => [link.id, link]))
  const groups = new Map()
  for (const row of rows) {
    const link = linksById.get(row.linkId)
    if (!link) continue
    const groupStatus = status ?? (row.classification === 'blocked' ? 'blocked' : 'review')
    const key = `${groupStatus}:${link.templateKey}:${row.toRevision}:${row.targetContentHash}`
    const group = groups.get(key) ?? {
      id: key,
      status: groupStatus,
      templateKey: link.templateKey,
      fromRevision: row.fromRevision,
      toRevision: row.toRevision,
      targetContentHash: row.targetContentHash,
      classification: row.classification,
      reasons: [],
      changes: canonicalCatalogFieldChanges(row.changes),
      members: [],
      evaluatedAtMs: row.evaluatedAtMs,
    }
    group.fromRevision = Math.min(group.fromRevision, row.fromRevision)
    group.evaluatedAtMs = Math.max(group.evaluatedAtMs, row.evaluatedAtMs)
    group.reasons = [...new Set([...group.reasons, ...(row.reasons ?? [])])]
    group.members.push({
      linkId: link.id,
      itemId: link.itemId,
      itemType: link.itemType,
      importedRevision: link.importedRevision,
      importedContentHash: link.importedContentHash,
      fromRevision: row.fromRevision,
      classification: row.classification,
      evaluationId: row.id,
      reasons: row.reasons ?? [],
      changes: canonicalCatalogFieldChanges(row.changes),
    })
    if (row.classification === 'blocked') group.classification = 'blocked'
    groups.set(key, group)
  }
  return [...groups.values()]
}

export function registryUpdateGroups({
  evaluations,
  links,
  projectRevisions = {},
  projectIdsByLinkId = null,
  itemRevisionsByLinkId = null,
  catalogRevision = null,
}) {
  const current = currentRegistryUpdateEvaluations(evaluations, links)
  const history = registryUpdateHistoryEvaluations(evaluations)
  const groups = [
    ...groupRows(current.filter((row) => row.classification !== 'blocked'), links, 'review'),
    ...groupRows(current.filter((row) => row.classification === 'blocked'), links, 'blocked'),
    ...groupRows(history.filter((row) => row.decision === 'applied'), links, 'applied'),
    ...groupRows(history.filter((row) => row.decision === 'declined'), links, 'declined'),
  ]
  return groups.map((group) => ({
    ...group,
    reconsiderable: group.status === 'declined' && group.members.every((member) => {
      const link = links.find((candidate) => candidate.id === member.linkId)
      return ['update-available', 'adoption-available'].includes(link?.state)
        && link.availableRevision === group.toRevision
        && link.availableContentHash === group.targetContentHash
    }),
    concurrencyToken: tokenFor(group, {
      projectRevisions,
      projectIdsByLinkId,
      itemRevisionsByLinkId,
      catalogRevision,
    }),
  })).sort((left, right) => right.evaluatedAtMs - left.evaluatedAtMs || left.id.localeCompare(right.id))
}

export function registryUpdateCounts(groups) {
  const counts = { review: 0, blocked: 0, applied: 0, declined: 0 }
  for (const group of groups) counts[group.status] += 1
  return counts
}
