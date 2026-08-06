const TABLE_BY_TYPE = Object.freeze({
  server: 'servers', nas: 'nas', pcBuild: 'pcBuilds', cpu: 'cpus', ram: 'ram', storage: 'storage',
  network: 'networkCards', gpu: 'gpus', motherboard: 'motherboards', powerSupply: 'powerSupplies',
})

const COMPONENT_ITEM_TYPES = Object.freeze({
  cpu: 'cpu', memory: 'ram', storage: 'storage', 'network-interface': 'network', gpu: 'gpu',
  motherboard: 'motherboard', 'power-supply': 'powerSupply',
})

const FIELD_MAP = Object.freeze({
  system: { manufacturer: 'manufacturer', productName: 'model' },
  motherboard: { manufacturer: 'manufacturer', productName: 'model', version: 'version' },
  cpu: { manufacturer: 'manufacturer', version: 'name' },
  memory: { manufacturer: 'manufacturer', partNumber: 'model', speed: 'specs.speed' },
  storage: { vendor: 'manufacturer', model: 'model', size: 'specs.capacityBytes' },
  'network-interface': { name: 'name' },
  'power-supply': { manufacturer: 'manufacturer', name: 'model', maxPowerCapacity: 'specs.wattage' },
})

function atPath(record, fieldPath) {
  return fieldPath.split('.').reduce((value, key) => value?.[key], record)
}

function hostItem(inventory, host) {
  const table = TABLE_BY_TYPE[host.hostType]
  return inventory?.[table]?.find((item) => item.id === host.hostId) ?? null
}

function assignedTargets(inventory, project, host, itemType) {
  const table = TABLE_BY_TYPE[itemType]
  return (project?.assignments ?? [])
    .filter((assignment) => assignment.hostType === host.hostType && assignment.hostId === host.hostId && assignment.itemType === itemType)
    .map((assignment) => ({
      assignment,
      item: inventory?.[table]?.find((candidate) => candidate.id === assignment.itemId) ?? null,
    }))
    .filter(({ item }) => item)
    .sort((first, second) => {
      const firstPosition = first.assignment.allocation?.positions?.[0] ?? Number.MAX_SAFE_INTEGER
      const secondPosition = second.assignment.allocation?.positions?.[0] ?? Number.MAX_SAFE_INTEGER
      return firstPosition - secondPosition || first.assignment.id - second.assignment.id
    })
}

function componentIdentity(component) {
  return typeof component.values?.opaqueFingerprint === 'string' ? component.values.opaqueFingerprint : null
}

function matchComponents(snapshot, inventory, project) {
  const host = { hostType: snapshot.host.type, hostId: snapshot.host.id }
  const matches = []
  const grouped = snapshot.components.reduce((result, component) => {
    const collection = result.get(component.kind) ?? []
    collection.push(component)
    result.set(component.kind, collection)
    return result
  }, new Map())
  for (const [kind, components] of grouped) {
    if (['system', 'chassis', 'bios'].includes(kind)) {
      const item = hostItem(inventory, host)
      for (const component of components) matches.push({ component, itemType: host.hostType, item, method: 'host', confidence: 'high' })
      continue
    }
    const itemType = COMPONENT_ITEM_TYPES[kind]
    if (!itemType) continue
    const targets = assignedTargets(inventory, project, host, itemType)
    const availableTargets = [...targets]
    const positionalMatchIsSafe = targets.length === components.length
    for (const component of components) {
      const fingerprint = componentIdentity(component)
      let targetIndex = availableTargets.findIndex(({ item }) => item.agentHardwareFingerprint && item.agentHardwareFingerprint === fingerprint)
      let method = 'opaque-fingerprint'
      if (targetIndex < 0) {
        const locator = component.locator.trim().toLowerCase()
        targetIndex = availableTargets.findIndex(({ assignment }) => {
          const label = assignment.slotLabel ?? assignment.locator ?? assignment.allocation?.locator
          return typeof label === 'string' && label.trim().toLowerCase() === locator
        })
        method = 'physical-locator'
      }
      if (targetIndex < 0 && positionalMatchIsSafe) {
        targetIndex = 0
        method = 'one-to-one-position'
      }
      if (targetIndex < 0) {
        matches.push({ component, itemType, item: null, method: 'ambiguous', confidence: 'none' })
        continue
      }
      const [target] = availableTargets.splice(targetIndex, 1)
      matches.push({ component, itemType, item: target.item, method, confidence: method === 'one-to-one-position' ? 'medium' : 'high' })
    }
  }
  return matches
}

export function buildHardwareSuggestions({ snapshot, inventory, project, now = Date.now() }) {
  if (!snapshot) return { snapshot: null, stale: false, matches: [], suggestions: [] }
  const ageMs = Math.max(0, now - Date.parse(snapshot.receivedAt))
  const matches = matchComponents(snapshot, inventory, project)
  const suggestions = []
  for (const match of matches) {
    if (!match.item || match.confidence === 'none') continue
    const mapping = FIELD_MAP[match.component.kind] ?? {}
    for (const [detectedField, fieldPath] of Object.entries(mapping)) {
      const detectedValue = match.component.values?.[detectedField]
      if (detectedValue === undefined || detectedValue === null || detectedValue === '') continue
      suggestions.push({
        id: `${snapshot.id}:${match.itemType}:${match.item.id}:${fieldPath}`,
        snapshotId: snapshot.id,
        target: { itemType: match.itemType, itemId: match.item.id },
        fieldPath,
        currentValue: atPath(match.item, fieldPath) ?? null,
        detectedValue,
        source: {
          kind: match.component.kind,
          locator: match.component.locator,
          opaqueFingerprint: componentIdentity(match.component),
          collectedAt: snapshot.collectedAt,
        },
        match: { method: match.method, confidence: match.confidence },
      })
    }
  }
  return {
    snapshot,
    stale: ageMs > 30 * 24 * 60 * 60 * 1000,
    ageMs,
    matches: matches.map((match) => ({
      component: { kind: match.component.kind, locator: match.component.locator },
      target: match.item ? { itemType: match.itemType, itemId: match.item.id } : null,
      method: match.method,
      confidence: match.confidence,
    })),
    suggestions,
  }
}
