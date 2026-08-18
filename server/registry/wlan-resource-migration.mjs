const RESOURCE_TYPES = Object.freeze({
  expansion: 'expansion-slot',
  optionalModule: 'optional-module',
})

function normalizedKey(value) {
  return typeof value === 'string'
    ? value
        .trim()
        .toLowerCase()
        .replace(/m\s*\.\s*2/g, 'm2')
        .replace(/\ba\s*[+/&-]\s*e\b/g, 'ae')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    : ''
}

function resourceCount(resource) {
  return Number.isSafeInteger(resource?.count) && resource.count > 0 ? resource.count : 1
}

export function isLegacyWlanExpansionResource(resource) {
  const key = normalizedKey(resource?.key)
  if (key === 'm2-ae-slot') return true
  const description = normalizedKey(`${resource?.key ?? ''} ${resource?.label ?? ''}`)
  const isM2 = description.includes('m2')
  const isAe = description.includes('ae')
  const isWlan = description.includes('wlan') || description.includes('wireless') || description.includes('2230')
  return isM2 && isAe && isWlan
}

export function isCanonicalWlanModuleResource(resource) {
  return normalizedKey(resource?.key) === 'wlan-m2'
    && Array.isArray(resource?.acceptedModuleKinds)
    && resource.acceptedModuleKinds.some((kind) => normalizedKey(kind) === 'wireless-card')
}

function constraintReferences(host, resourceType, resourceId) {
  if (!Number.isSafeInteger(resourceId) || resourceId <= 0) return []
  return (host?.constraintGroups ?? []).filter((group) => (
    Array.isArray(group?.members) && group.members.some((member) => (
      member?.resourceType === RESOURCE_TYPES[resourceType]
      && member?.resourceId === resourceId
    ))
  ))
}

function destinationIdRelocations(currentHost, nextHost, source, destination) {
  if (destination.id === source.id) return { status: 'ready', relocations: [] }
  const collisions = (nextHost.optionalModuleSlots ?? []).filter((resource) => (
    resource !== destination && resource.id === source.id
  ))
  if (collisions.length === 0) return { status: 'ready', relocations: [] }
  if (collisions.length !== 1) {
    return { status: 'ambiguous', reason: `Optional module resource ID ${source.id} is not unique.` }
  }
  const collision = collisions[0]
  const existing = (currentHost.optionalModuleSlots ?? []).some((resource) => (
    normalizedKey(resource.key) === normalizedKey(collision.key)
  ))
  if (existing) {
    return {
      status: 'ambiguous',
      reason: `Optional module resource ID ${source.id} belongs to an existing local resource and cannot be reassigned.`,
    }
  }
  const occupied = (nextHost.optionalModuleSlots ?? [])
    .map((resource) => resource.id)
    .filter((id) => Number.isSafeInteger(id) && id > 0)
  const nextId = Math.max(0, ...occupied, source.id) + 1
  return {
    status: 'ready',
    relocations: [{ key: collision.key, fromId: collision.id, toId: nextId }],
  }
}

export function planWlanResourceMigration(currentItem, nextItem) {
  const currentHost = currentItem?.compatibility?.host ?? {}
  const nextHost = nextItem?.compatibility?.host ?? {}
  const sources = (currentHost.expansionSlots ?? []).filter(isLegacyWlanExpansionResource)
  const destinations = (nextHost.optionalModuleSlots ?? []).filter(isCanonicalWlanModuleResource)
  const sourceStillPresent = (nextHost.expansionSlots ?? []).some(isLegacyWlanExpansionResource)

  if (sources.length === 0) return { status: 'none' }
  if (destinations.length === 0 && sourceStillPresent) return { status: 'none' }
  if (sources.length !== 1) {
    return { status: 'ambiguous', reason: `Expected one legacy M.2 A/E WLAN resource, found ${sources.length}.` }
  }
  if (destinations.length !== 1) {
    return { status: 'ambiguous', reason: `Expected one optionalModuleSlots.wlan-m2 destination, found ${destinations.length}.` }
  }
  const source = sources[0]
  const destination = destinations[0]
  if (resourceCount(source) !== resourceCount(destination)) {
    return {
      status: 'ambiguous',
      reason: `Legacy WLAN resource count ${resourceCount(source)} does not match destination count ${resourceCount(destination)}.`,
    }
  }
  const sourceConstraints = constraintReferences(currentHost, 'expansion', source.id)
  const destinationConstraints = constraintReferences(nextHost, 'optionalModule', destination.id)
  if (sourceConstraints.length > 0 || destinationConstraints.length > 0) {
    return { status: 'ambiguous', reason: 'The WLAN resource is referenced by a constraint group and cannot be migrated automatically.' }
  }
  const relocationPlan = destinationIdRelocations(currentHost, nextHost, source, destination)
  if (relocationPlan.status === 'ambiguous') return relocationPlan
  return {
    status: 'ready',
    source,
    destination,
    count: resourceCount(source),
    destinationIdRelocations: relocationPlan.relocations,
  }
}

export function wlanResourceReclassification(transition, assignmentIds = []) {
  if (transition?.status !== 'ready') return null
  return {
    kind: 'reclassify-resource',
    from: {
      resourceType: 'expansion',
      resourceId: transition.source.id,
      key: transition.source.key,
      label: transition.source.label,
    },
    to: {
      resourceType: 'optionalModule',
      resourceId: transition.source.id,
      key: transition.destination.key,
      label: transition.destination.label,
    },
    assignmentIds: [...assignmentIds].sort((left, right) => left - right),
  }
}

export function removeSupersededWlanResource(currentItem, incomingItem, mergedItem) {
  const transition = planWlanResourceMigration(currentItem, incomingItem)
  if (transition.status !== 'ready') return mergedItem
  const result = structuredClone(mergedItem)
  for (const relocation of transition.destinationIdRelocations) {
    const resource = result.compatibility.host.optionalModuleSlots.find((candidate) => (
      candidate.id === relocation.fromId && candidate.key === relocation.key
    ))
    resource.id = relocation.toId
    for (const group of result.compatibility.host.constraintGroups ?? []) {
      for (const member of group.members ?? []) {
        if (member.resourceType === RESOURCE_TYPES.optionalModule && member.resourceId === relocation.fromId) {
          member.resourceId = relocation.toId
        }
      }
    }
  }
  const destination = result.compatibility.host.optionalModuleSlots
    .find(isCanonicalWlanModuleResource)
  destination.id = transition.source.id
  result.compatibility.host.expansionSlots = result.compatibility.host.expansionSlots
    .filter((resource) => !isLegacyWlanExpansionResource(resource))
  if (result.compatibility.host.expansionSlots.length === 0) {
    delete result.compatibility.host.expansionSlots
  }
  return result
}
