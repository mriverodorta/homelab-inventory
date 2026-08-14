const IDENTITY_FIELDS = new Set(['type', 'manufacturer', 'secondaryManufacturer', 'family', 'model', 'number'])

function findingKey(result, finding) {
  return `${result.assignmentId}:${finding.code}:${finding.severity ?? 'warning'}:${finding.resourceId ?? ''}`
}

export function catalogCompatibilityFindingKeys(results) {
  return new Set(results.flatMap((result) => result.findings.map((finding) => findingKey(result, finding))))
}

export function classifyCatalogUpdate({ changes, dependencyConflicts = [], beforeFindings, afterFindings, validationError }) {
  const reasons = []
  if (changes.some((change) => IDENTITY_FIELDS.has(change.field))) reasons.push('identity-change')
  if (dependencyConflicts.length > 0) reasons.push('assignment-conflict')
  if (validationError?.code === 'connected-port-change') reasons.push('connected-port-change')
  else if (validationError) reasons.push('structural-validation-failed')

  const before = catalogCompatibilityFindingKeys(beforeFindings)
  const introduced = [...catalogCompatibilityFindingKeys(afterFindings)].filter((key) => !before.has(key))
  if (introduced.length > 0) reasons.push('new-compatibility-findings')

  if (reasons.some((reason) => ['connected-port-change', 'assignment-conflict', 'structural-validation-failed'].includes(reason))) {
    return { classification: 'blocked', reasons, introducedFindings: introduced }
  }
  if (reasons.length > 0) return { classification: 'review-required', reasons, introducedFindings: introduced }
  return { classification: 'safe', reasons: ['verified-compatible'], introducedFindings: [] }
}
