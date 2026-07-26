import { INVENTORY_TYPES } from '../db/inventory-capabilities.mjs'
import { InventoryLifecycleError } from '../db/inventory-lifecycle.mjs'
import { createOnboardingState, deriveOnboardingMilestones, workspaceIsEmpty } from './model.mjs'
import { cloneExampleWorkspaceTemplate } from './example-workspace.mjs'

const TABLE_BY_TYPE = {
  server: 'servers', pcBuild: 'pcBuilds', cpu: 'cpus', ram: 'ram', storage: 'storage',
  network: 'networkCards', gpu: 'gpus', motherboard: 'motherboards', cpuCooler: 'cpuCoolers',
  case: 'cases', powerSupply: 'powerSupplies', soundCard: 'soundCards', wireless: 'wirelessCards',
  powerAdapter: 'powerAdapters', nas: 'nas', switch: 'switches', patchPanel: 'patchPanels',
  monitor: 'monitors', ups: 'upsSystems', powerStrip: 'powerStrips',
}

const refKey = (type, id) => `${type}:${id}`

function nextId(records) {
  return records.reduce((maximum, record) => Math.max(maximum, Number(record.id) || 0), 0) + 1
}

function nextProjectId(records) {
  return records.reduce((maximum, record) => Math.max(maximum, Number(record.id) || 0), 0) + 1
}

function endpointReferencesSample(endpoint, sampleKeys) {
  return sampleKeys.has(refKey(endpoint.itemType, endpoint.itemId))
    || (endpoint.hostedItemType && sampleKeys.has(refKey(endpoint.hostedItemType, endpoint.hostedItemId)))
}

function assignmentReferencesSample(assignment, sampleKeys) {
  return sampleKeys.has(refKey(assignment.hostType, assignment.hostId))
    || sampleKeys.has(refKey(assignment.itemType, assignment.itemId))
}

export function publicOnboardingStatus({ meta, inventory, project, agents, enabled = true }) {
  if (!enabled) return { enabled: false, mode: 'demo' }
  const state = structuredClone(meta.onboarding)
  const runtimeProject = project.items ? project : { ...project, items: {} }
  const milestones = deriveOnboardingMilestones(runtimeProject)
  return {
    enabled: true,
    ...state,
    eligibleForExample: workspaceIsEmpty(inventory, project, agents) && state.status !== 'sample_active',
    shouldInvite: state.status === 'available' && workspaceIsEmpty(inventory, project, agents),
    milestones,
    projectRevision: project.revision,
  }
}

export function loadExampleIntoDraft(draft, now = new Date().toISOString()) {
  if (draft.meta.onboarding.status === 'sample_active') return false
  if (!workspaceIsEmpty(draft.inventory, draft.project, draft.agents)) {
    throw new InventoryLifecycleError('The example workspace can only be loaded into an empty project.', {
      code: 'onboarding-workspace-not-empty', status: 409,
    })
  }

  const template = cloneExampleWorkspaceTemplate()
  const mappedIds = new Map()
  const sampleInventoryRefs = []
  for (const type of INVENTORY_TYPES) {
    const table = TABLE_BY_TYPE[type]
    let id = nextId(draft.inventory[table])
    for (const item of template.inventory.filter((entry) => entry.type === type)) {
      mappedIds.set(refKey(type, item.id), id)
      const record = structuredClone(item)
      delete record.type
      record.id = id
      draft.inventory[table].push(record)
      sampleInventoryRefs.push({ type, id })
      id += 1
    }
    draft.inventory[table].sort((left, right) => left.id - right.id)
  }

  const mapId = (type, id) => mappedIds.get(refKey(type, id))
  const assignmentStart = nextProjectId(draft.project.assignments)
  const assignments = template.assignments.map((assignment, index) => ({
    ...assignment,
    id: assignmentStart + index,
    hostId: mapId(assignment.hostType, assignment.hostId),
    itemId: mapId(assignment.itemType, assignment.itemId),
  }))
  const connectionStart = nextProjectId(draft.project.connections)
  const mapEndpoint = (endpoint) => ({
    ...endpoint,
    itemId: mapId(endpoint.itemType, endpoint.itemId),
    ...(endpoint.hostedItemType
      ? { hostedItemId: mapId(endpoint.hostedItemType, endpoint.hostedItemId) }
      : {}),
  })
  const connections = template.connections.map((connection, index) => ({
    ...connection,
    id: connectionStart + index,
    from: mapEndpoint(connection.from),
    to: mapEndpoint(connection.to),
  }))
  const placements = template.placements.map((placement) => ({
    ...placement,
    itemId: mapId(placement.itemType, placement.itemId),
  }))

  draft.project.assignments.push(...assignments)
  draft.project.connections.push(...connections)
  draft.project.placements.push(...placements)
  draft.meta.onboarding = {
    ...createOnboardingState('sample_active'),
    sampleBatchId: (draft.meta.onboarding.sampleBatchId ?? 0) + 1,
    sampleInventoryRefs,
    sampleAssignmentIds: assignments.map(({ id }) => id),
    sampleConnectionIds: connections.map(({ id }) => id),
    startedAt: now,
  }
  return true
}

export function sampleRemovalImpact(draft) {
  const state = draft.meta.onboarding
  if (state.status !== 'sample_active') {
    return { inventoryRecords: 0, assignments: 0, connections: 0, placements: 0, additionalRelationships: 0 }
  }
  const sampleKeys = new Set(state.sampleInventoryRefs.map((ref) => refKey(ref.type, ref.id)))
  const manifestAssignments = new Set(state.sampleAssignmentIds)
  const manifestConnections = new Set(state.sampleConnectionIds)
  const affectedAssignments = draft.project.assignments.filter((assignment) => assignmentReferencesSample(assignment, sampleKeys))
  const affectedConnections = draft.project.connections.filter((connection) =>
    endpointReferencesSample(connection.from, sampleKeys) || endpointReferencesSample(connection.to, sampleKeys),
  )
  return {
    inventoryRecords: state.sampleInventoryRefs.length,
    assignments: affectedAssignments.length,
    connections: affectedConnections.length,
    placements: draft.project.placements.filter((placement) => sampleKeys.has(refKey(placement.itemType, placement.itemId))).length,
    additionalRelationships: affectedAssignments.filter(({ id }) => !manifestAssignments.has(id)).length
      + affectedConnections.filter(({ id }) => !manifestConnections.has(id)).length,
  }
}

export function finishExampleInDraft(draft, action, now = new Date().toISOString()) {
  const state = draft.meta.onboarding
  if (state.status !== 'sample_active') {
    throw new InventoryLifecycleError('There is no active example workspace.', {
      code: 'onboarding-sample-not-active', status: 409,
    })
  }
  if (action === 'keep') {
    draft.meta.onboarding = { ...createOnboardingState('completed'), completedAt: now }
    return
  }
  if (action !== 'remove') {
    throw new InventoryLifecycleError('Example action must be keep or remove.', {
      code: 'onboarding-invalid-action', status: 400,
    })
  }

  const sampleKeys = new Set(state.sampleInventoryRefs.map((ref) => refKey(ref.type, ref.id)))
  for (const ref of state.sampleInventoryRefs) {
    const table = TABLE_BY_TYPE[ref.type]
    draft.inventory[table] = draft.inventory[table].filter((item) => item.id !== ref.id)
  }
  draft.project.placements = draft.project.placements.filter(
    (placement) => !sampleKeys.has(refKey(placement.itemType, placement.itemId)),
  )
  draft.project.assignments = draft.project.assignments.filter(
    (assignment) => !assignmentReferencesSample(assignment, sampleKeys),
  )
  draft.project.connections = draft.project.connections.filter((connection) =>
    !endpointReferencesSample(connection.from, sampleKeys) && !endpointReferencesSample(connection.to, sampleKeys),
  )
  if (draft.project.compatibilityPolicy) {
    draft.project.compatibilityPolicy.disabledHosts = (draft.project.compatibilityPolicy.disabledHosts ?? [])
      .filter((host) => !sampleKeys.has(refKey(host.hostType, host.hostId)))
  }
  draft.meta.onboarding = { ...createOnboardingState('checklist_active'), startedAt: now }
}

export function setOnboardingStatusInDraft(draft, status, now = new Date().toISOString()) {
  draft.meta.onboarding = {
    ...createOnboardingState(status),
    ...(status === 'checklist_active' ? { startedAt: now } : {}),
    ...(['completed', 'dismissed'].includes(status) ? { completedAt: now } : {}),
  }
}

export function setWalkthroughStepInDraft(draft, step) {
  if (!Number.isInteger(step) || step < 0 || step > 3) {
    throw new InventoryLifecycleError('Walkthrough step must be between 0 and 3.', {
      code: 'onboarding-invalid-step', status: 400,
    })
  }
  if (draft.meta.onboarding.status !== 'sample_active') {
    throw new InventoryLifecycleError('There is no active example walkthrough.', {
      code: 'onboarding-sample-not-active', status: 409,
    })
  }
  draft.meta.onboarding.walkthroughStep = step
}

export function onboardingNeedsReconciliation(draft) {
  const state = draft.meta.onboarding
  if (state.status !== 'sample_active') return false
  const existingRefs = new Set()
  for (const ref of state.sampleInventoryRefs) {
    const table = TABLE_BY_TYPE[ref.type]
    if (draft.inventory[table]?.some((item) => item.id === ref.id)) existingRefs.add(refKey(ref.type, ref.id))
  }
  if (existingRefs.size !== state.sampleInventoryRefs.length) return true
  const assignmentIds = new Set(draft.project.assignments.map(({ id }) => id))
  const connectionIds = new Set(draft.project.connections.map(({ id }) => id))
  return state.sampleAssignmentIds.some((id) => !assignmentIds.has(id))
    || state.sampleConnectionIds.some((id) => !connectionIds.has(id))
}

export function reconcileOnboardingDraft(draft) {
  const state = draft.meta.onboarding
  if (state.status !== 'sample_active') return false
  const existingRefs = state.sampleInventoryRefs.filter((ref) => {
    const table = TABLE_BY_TYPE[ref.type]
    return draft.inventory[table]?.some((item) => item.id === ref.id)
  })
  const existingKeys = new Set(existingRefs.map((ref) => refKey(ref.type, ref.id)))
  const missingKeys = new Set(
    state.sampleInventoryRefs
      .map((ref) => refKey(ref.type, ref.id))
      .filter((key) => !existingKeys.has(key)),
  )
  if (missingKeys.size > 0) {
    draft.project.placements = draft.project.placements.filter(
      (placement) => !missingKeys.has(refKey(placement.itemType, placement.itemId)),
    )
    draft.project.assignments = draft.project.assignments.filter(
      (assignment) => !assignmentReferencesSample(assignment, missingKeys),
    )
    draft.project.connections = draft.project.connections.filter((connection) =>
      !endpointReferencesSample(connection.from, missingKeys) && !endpointReferencesSample(connection.to, missingKeys),
    )
  }
  const assignmentIds = new Set(draft.project.assignments.map(({ id }) => id))
  const connectionIds = new Set(draft.project.connections.map(({ id }) => id))
  if (existingRefs.length === 0) {
    draft.meta.onboarding = createOnboardingState('checklist_active')
  } else {
    draft.meta.onboarding.sampleInventoryRefs = existingRefs
    draft.meta.onboarding.sampleAssignmentIds = state.sampleAssignmentIds.filter((id) => assignmentIds.has(id))
    draft.meta.onboarding.sampleConnectionIds = state.sampleConnectionIds.filter((id) => connectionIds.has(id))
  }
  return true
}
