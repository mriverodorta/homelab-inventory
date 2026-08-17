const IDENTITY_FIELDS = new Set(['type', 'manufacturer', 'secondaryManufacturer', 'family', 'model', 'number'])
const NAS_MATERIAL_SPEC_FIELDS = new Set([
  'formFactor', 'rackUnits', 'hardwareRevision', 'boardRevision', 'variantKey',
  'topologyCompleteness', 'powerConfiguration',
])
const NETWORK_HOST_INTERFACE_PATHS = [
  'specs.networkTechnology',
  'specs.formFactor',
  'specs.hostInterface',
  'compatibility.requirements.expansion',
]
const NETWORK_RADIO_PATHS = [
  'specs.wifiGenerations',
  'specs.frequencyBandsGhz',
  'specs.spatialStreams',
  'specs.antennaTopology',
  'specs.maxPhyRateBps',
  'specs.bluetoothVersion',
  'specs.bluetoothProfiles',
]
const NETWORK_MINIMUM_LANE_PATHS = new Set([
  'specs.hostInterface.minimumElectricalLanes',
  'compatibility.requirements.expansion.minimumElectricalLanes',
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

function changedPath(change) {
  return change.path ?? change.field ?? ''
}

function pathMatches(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`)
}

function networkChangeReason(semanticChanges) {
  const hostInterfaceChanges = semanticChanges.filter((change) => (
    change.impact === 'attachment'
    || NETWORK_HOST_INTERFACE_PATHS.some((path) => pathMatches(changedPath(change), path))
  ))
  const isMinimumRelaxation = (change) => {
    if (!NETWORK_MINIMUM_LANE_PATHS.has(changedPath(change))) return false
    return Number.isSafeInteger(change.current)
      && change.current > 0
      && (change.next === undefined || (
        Number.isSafeInteger(change.next) && change.next > 0 && change.next < change.current
      ))
  }
  if (hostInterfaceChanges.length > 0 && !hostInterfaceChanges.every(isMinimumRelaxation)) {
    return 'network-host-interface-change'
  }
  if (semanticChanges.some((change) => (
    NETWORK_RADIO_PATHS.some((path) => pathMatches(changedPath(change), path))
  ))) return 'network-radio-change'
  return null
}

function findingKey(result, finding) {
  return `${result.assignmentId}:${finding.code}:${finding.severity ?? 'warning'}:${finding.resourceId ?? ''}`
}

export function catalogCompatibilityFindingKeys(results) {
  return new Set(results.flatMap((result) => result.findings.map((finding) => findingKey(result, finding))))
}

function confirmedCompatibilityFindingKeys(results) {
  return new Set(results.flatMap((result) => result.findings
    .filter((finding) => finding.severity !== 'unknown')
    .map((finding) => findingKey(result, finding))))
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
  if (itemType === 'network') {
    const networkReason = networkChangeReason(semanticChanges)
    if (networkReason) reasons.push(networkReason)
  }
  if (dependencyConflicts.length > 0) reasons.push('assignment-conflict')
  if (validationError?.code === 'connected-port-change') reasons.push('connected-port-change')
  else if (validationError) reasons.push('structural-validation-failed')

  const before = confirmedCompatibilityFindingKeys(beforeFindings)
  const introduced = [...confirmedCompatibilityFindingKeys(afterFindings)].filter((key) => !before.has(key))
  if (introduced.length > 0) reasons.push('new-compatibility-findings')

  if (reasons.some((reason) => ['connected-port-change', 'assignment-conflict', 'structural-validation-failed'].includes(reason))) {
    return { classification: 'blocked', reasons, introducedFindings: introduced }
  }
  if (reasons.length > 0) return { classification: 'review-required', reasons, introducedFindings: introduced }
  return { classification: 'safe', reasons: ['verified-compatible'], introducedFindings: [] }
}
