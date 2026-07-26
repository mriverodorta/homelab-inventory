import {
  CANVAS_EQUIPMENT_TYPE_SET,
  INVENTORY_TYPE_SET,
} from '../db/inventory-capabilities.mjs'

export const ONBOARDING_VERSION = 1
export const ONBOARDING_STATUSES = new Set([
  'available',
  'sample_active',
  'checklist_active',
  'completed',
  'dismissed',
])

export function createOnboardingState(status = 'available') {
  if (!ONBOARDING_STATUSES.has(status)) {
    throw new Error(`Unsupported onboarding status ${String(status)}.`)
  }

  return {
    version: ONBOARDING_VERSION,
    status,
    sampleBatchId: null,
    sampleInventoryRefs: [],
    sampleAssignmentIds: [],
    sampleConnectionIds: [],
    walkthroughStep: 0,
    startedAt: null,
    completedAt: null,
  }
}
function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0
}

function assertNullableTimestamp(value, field) {
  if (value !== null && (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))) {
    throw new Error(`onboarding.${field} must be null or an ISO timestamp.`)
  }
}

function assertUniqueIds(values, field) {
  if (!Array.isArray(values)) throw new Error(`onboarding.${field} must be an array.`)
  const seen = new Set()
  for (const value of values) {
    if (!isPositiveSafeInteger(value)) {
      throw new Error(`onboarding.${field} values must be positive safe integers.`)
    }
    if (seen.has(value)) throw new Error(`onboarding.${field} contains a duplicate id.`)
    seen.add(value)
  }
}

export function assertOnboardingState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('meta.onboarding must be an object.')
  }
  if (value.version !== ONBOARDING_VERSION) {
    throw new Error(`onboarding.version must be ${ONBOARDING_VERSION}.`)
  }
  if (!ONBOARDING_STATUSES.has(value.status)) {
    throw new Error('onboarding.status is unsupported.')
  }
  if (value.sampleBatchId !== null && !isPositiveSafeInteger(value.sampleBatchId)) {
    throw new Error('onboarding.sampleBatchId must be null or a positive safe integer.')
  }
  if (!Array.isArray(value.sampleInventoryRefs)) {
    throw new Error('onboarding.sampleInventoryRefs must be an array.')
  }

  const refs = new Set()
  for (const ref of value.sampleInventoryRefs) {
    if (!ref || !INVENTORY_TYPE_SET.has(ref.type) || !isPositiveSafeInteger(ref.id)) {
      throw new Error('Every sample inventory reference must have a supported type and positive safe integer id.')
    }
    const key = `${ref.type}:${ref.id}`
    if (refs.has(key)) throw new Error(`Duplicate sample inventory reference ${key}.`)
    refs.add(key)
  }

  assertUniqueIds(value.sampleAssignmentIds, 'sampleAssignmentIds')
  assertUniqueIds(value.sampleConnectionIds, 'sampleConnectionIds')
  if (!Number.isInteger(value.walkthroughStep) || value.walkthroughStep < 0 || value.walkthroughStep > 3) {
    throw new Error('onboarding.walkthroughStep must be an integer from 0 through 3.')
  }
  assertNullableTimestamp(value.startedAt, 'startedAt')
  assertNullableTimestamp(value.completedAt, 'completedAt')

  if (value.status === 'sample_active') {
    if (!isPositiveSafeInteger(value.sampleBatchId) || value.sampleInventoryRefs.length === 0) {
      throw new Error('Active sample onboarding requires a batch id and inventory manifest.')
    }
  } else if (
    value.sampleBatchId !== null
    || value.sampleInventoryRefs.length > 0
    || value.sampleAssignmentIds.length > 0
    || value.sampleConnectionIds.length > 0
  ) {
    throw new Error('Only active sample onboarding may retain a sample manifest.')
  }

  return value
}

export function workspaceIsEmpty(inventory, project, agents = { enrollments: {}, devices: {} }) {
  const inventoryEmpty = inventory?.items
    ? Object.keys(inventory.items).length === 0
    : Object.values(inventory ?? {}).every((records) => !Array.isArray(records) || records.length === 0)
  const projectEmpty = ['placements', 'assignments', 'connections']
    .every((field) => (project?.[field] ?? []).length === 0)
  const agentsEmpty = Object.keys(agents?.enrollments ?? {}).length === 0
    && Object.keys(agents?.devices ?? {}).length === 0
  return inventoryEmpty && projectEmpty && agentsEmpty
}

export function deriveOnboardingMilestones(project) {
  const created = Object.values(project?.items ?? {}).some((item) =>
    item && CANVAS_EQUIPMENT_TYPE_SET.has(item.type) && !item.archivedAt,
  )
  const placed = (project?.placements ?? []).length > 0
  const related = (project?.assignments ?? []).length > 0 || (project?.connections ?? []).length > 0
  return { created, placed, related, completed: created && placed && related }
}
