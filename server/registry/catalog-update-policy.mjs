const IDENTITY_FIELDS = new Set(['type', 'manufacturer', 'secondaryManufacturer', 'family', 'model', 'number'])
const NAS_MATERIAL_SPEC_FIELDS = new Set([
  'formFactor', 'rackUnits', 'hardwareRevision', 'boardRevision', 'variantKey',
  'topologyCompleteness', 'powerConfiguration',
])

function changedJson(left, right) {
  return JSON.stringify(left) !== JSON.stringify(right)
}

function nasMaterialTopologyChanged(changes) {
  for (const change of changes) {
    if (change.field === 'fixedComponents' || change.field === 'ports') return true
    if (change.field === 'specs') {
      if ([...NAS_MATERIAL_SPEC_FIELDS].some((key) => changedJson(change.current?.[key], change.next?.[key]))) {
        return true
      }
    }
    if (change.field === 'compatibility') {
      const current = change.current?.host ?? {}
      const next = change.next?.host ?? {}
      const currentMemory = current.memory ?? {}
      const nextMemory = next.memory ?? {}
      if ([
        'slots', 'generations', 'formFactors', 'moduleTypes', 'eccSupport',
        'oemMaxCapacityMib', 'oemMaxModuleCapacityMib',
        'verifiedMaxCapacityMib', 'verifiedMaxModuleCapacityMib',
      ].some(
        (key) => changedJson(currentMemory[key], nextMemory[key]),
      )) return true
      for (const key of ['storageSlots', 'expansionSlots', 'optionalModuleSlots', 'controllerSlots']) {
        if (changedJson(current[key], next[key])) return true
      }
      const currentPower = current.power ?? {}
      const nextPower = next.power ?? {}
      if (['configuration', 'adapterDisposition', 'connector', 'psuBayCount', 'psuType'].some(
        (key) => changedJson(currentPower[key], nextPower[key]),
      )) return true
    }
  }
  return false
}

function findingKey(result, finding) {
  return `${result.assignmentId}:${finding.code}:${finding.severity ?? 'warning'}:${finding.resourceId ?? ''}`
}

export function catalogCompatibilityFindingKeys(results) {
  return new Set(results.flatMap((result) => result.findings.map((finding) => findingKey(result, finding))))
}

export function classifyCatalogUpdate({ itemType, changes, dependencyConflicts = [], beforeFindings, afterFindings, validationError }) {
  const reasons = []
  const semanticChanges = changes.flatMap((change) => change.semanticChanges ?? [change])
  if (semanticChanges.some((change) => (
    change.impact === 'identity-conflict'
    || change.impact === 'identity-replacement'
    || (!change.impact && IDENTITY_FIELDS.has(change.field))
  ))) reasons.push('identity-change')
  if (itemType === 'nas' && nasMaterialTopologyChanged(changes)) reasons.push('material-topology-change')
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
