function normalized(value) {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase('en-US') : ''
}

function sameFamily(left, right) {
  return Boolean(left && right)
    && normalized(left.manufacturer) === normalized(right.manufacturer)
    && normalized(left.model) === normalized(right.model)
    && normalized(left.physicalClass) === normalized(right.physicalClass)
}

function latestPerTemplate(candidates) {
  const latest = new Map()
  for (const candidate of candidates) {
    if (candidate?.state !== 'published' || !candidate.templateKey) continue
    const current = latest.get(candidate.templateKey)
    if (!current || (candidate.revision ?? 1) > (current.revision ?? 1)) {
      latest.set(candidate.templateKey, candidate)
    }
  }
  return [...latest.values()]
}

function uniqueMatch(candidates, predicate) {
  const matches = candidates.filter(predicate)
  return matches.length === 1 ? matches[0] : null
}

export function describeVariantCandidate(candidate) {
  return {
    templateKey: candidate.templateKey,
    revision: candidate.revision ?? 1,
    contentHash: candidate.contentHash,
    fingerprintVersion: candidate.fingerprintVersion,
    label: candidate.variantEvidence?.label ?? candidate.templateKey,
    ...(candidate.variantEvidence?.structuralSummary
      ? { structuralSummary: candidate.variantEvidence.structuralSummary }
      : {}),
  }
}

export function matchOemVariant(projection, publishedCandidates) {
  if (projection?.fingerprintVersion !== 4 || !projection.productFamily) return { outcome: 'none' }
  const family = latestPerTemplate(publishedCandidates)
    .filter((candidate) => candidate.fingerprintVersion === 4)
    .filter((candidate) => sameFamily(projection.productFamily, candidate.productFamily))
  if (family.length === 0) return { outcome: 'none' }

  const local = projection.variantEvidence ?? {}
  const boardPart = normalized(local.motherboardPartNumber)
  const boardRevision = normalized(local.motherboardRevision)
  if (boardPart && boardRevision) {
    const match = uniqueMatch(family, (candidate) => (
      normalized(candidate.variantEvidence?.motherboardPartNumber) === boardPart
      && normalized(candidate.variantEvidence?.motherboardRevision) === boardRevision
    ))
    if (match) return { outcome: 'match', match, reason: 'motherboard' }
  }

  const variantKey = normalized(local.variantKey)
  if (variantKey) {
    const match = uniqueMatch(family, (candidate) => normalized(candidate.variantEvidence?.variantKey) === variantKey)
    if (match) return { outcome: 'match', match, reason: 'variant' }
  }

  const topologySignature = normalized(local.topologySignature)
  if (topologySignature && local.completeness === 'complete') {
    const match = uniqueMatch(family, (candidate) => (
      candidate.variantEvidence?.completeness === 'complete'
      && normalized(candidate.variantEvidence?.topologySignature) === topologySignature
    ))
    if (match) return { outcome: 'match', match, reason: 'topology' }
  }

  if (family.length === 1) return { outcome: 'match', match: family[0], reason: 'single-family-variant' }
  return {
    outcome: 'ambiguous',
    productFamily: projection.productFamily,
    candidates: family.map(describeVariantCandidate),
  }
}
