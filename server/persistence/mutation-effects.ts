import type { InventoryItem, ProjectState } from '../../src/types/inventory.ts'
import type {
  CompatibilityMutationEffect,
  GeometryMutationEffect,
  InventoryMutationRef,
  MutationEffects,
  PresentationMutationEffect,
} from '../../src/types/domain-mutation.ts'
import { createEngineTopology } from '../engine/snapshot.mjs'

const GEOMETRY_PROPERTY_KEYS = new Set([
  'canvasOrientation',
  'patchPanelRowOrder',
  'upsOutletGroupOrder',
])

type InventoryMutationContext = Readonly<{
  projectIds: readonly number[]
  workspaceIds?: readonly number[]
  connectionIds?: readonly number[]
}>

function positiveIds(values: readonly number[] | undefined) {
  return [...new Set((values ?? []).filter((value) => Number.isSafeInteger(value) && value > 0))]
    .sort((left, right) => left - right)
}

function itemRef(item: InventoryItem): InventoryMutationRef {
  return { type: item.type, id: item.id }
}

function normalizeTopology(topology: ReturnType<typeof createEngineTopology>) {
  return {
    items: [...topology.items].map((item) => ({
      ...item,
      ports: [...item.ports].map((port) => ({
        ...port,
        endpoints: [...port.endpoints].sort((left, right) => left.id - right.id),
      })).sort((left, right) => left.id - right.id),
    })).sort((left, right) => (
      left.item.item_type.localeCompare(right.item.item_type) || left.item.id - right.item.id
    )),
    assignments: [...topology.assignments].sort((left, right) => left.id - right.id),
    connections: [...topology.connections].sort((left, right) => left.id - right.id),
    placements: [...topology.placements].sort((left, right) => (
      left.item_type.localeCompare(right.item_type) || left.id - right.id
    )),
  }
}

export function projectEngineTopologyProjection(project: ProjectState) {
  return normalizeTopology(createEngineTopology(project))
}

export function projectEngineTopologyEqual(left: ProjectState, right: ProjectState) {
  return JSON.stringify(projectEngineTopologyProjection(left))
    === JSON.stringify(projectEngineTopologyProjection(right))
}

function changedPropertyKeys(before: InventoryItem, after: InventoryItem) {
  const keys = new Set([
    ...Object.keys(before.properties ?? {}),
    ...Object.keys(after.properties ?? {}),
  ])
  return [...keys].filter((key) => before.properties?.[key] !== after.properties?.[key])
}

function changedField(before: InventoryItem, after: InventoryItem, field: keyof InventoryItem) {
  return JSON.stringify(before[field]) !== JSON.stringify(after[field])
}

function geometryEffect(
  context: InventoryMutationContext,
  ref: InventoryMutationRef,
): GeometryMutationEffect {
  return {
    projectIds: positiveIds(context.projectIds),
    workspaceIds: positiveIds(context.workspaceIds),
    itemRefs: [ref],
    connectionIds: positiveIds(context.connectionIds),
  }
}

function compatibilityEffect(
  context: InventoryMutationContext,
  before: InventoryItem,
): CompatibilityMutationEffect {
  const hostRefs = ['server', 'nas', 'pcBuild'].includes(before.type)
    ? [{ type: before.type as 'server' | 'nas' | 'pcBuild', id: before.id }]
    : []
  return { projectIds: positiveIds(context.projectIds), hostRefs }
}

function presentationEffect(
  context: InventoryMutationContext,
  ref: InventoryMutationRef,
): PresentationMutationEffect {
  return { projectIds: positiveIds(context.projectIds), itemRefs: [ref] }
}

export function classifyInventoryMutation(
  beforeProject: ProjectState,
  afterProject: ProjectState,
  before: InventoryItem,
  after: InventoryItem,
  context: InventoryMutationContext,
): MutationEffects {
  const ref = itemRef(after)
  const topology = !projectEngineTopologyEqual(beforeProject, afterProject)
  const propertyGeometryChanged = changedPropertyKeys(before, after)
    .some((key) => GEOMETRY_PROPERTY_KEYS.has(key))
  const renderedHardwareChanged = (['specs', 'ports', 'compatibility', 'fixedComponents'] as const)
    .some((field) => changedField(before, after, field))
  const inventoryChanged = JSON.stringify(before) !== JSON.stringify(after)

  return {
    topology,
    geometry: propertyGeometryChanged || renderedHardwareChanged
      ? geometryEffect(context, ref)
      : null,
    compatibility: inventoryChanged ? compatibilityEffect(context, before) : null,
    presentation: inventoryChanged ? presentationEffect(context, ref) : null,
  }
}

export function metadataMutationEffects(projectIds: readonly number[]): MutationEffects {
  return {
    topology: false,
    geometry: null,
    compatibility: null,
    presentation: { projectIds: positiveIds(projectIds), itemRefs: [] },
  }
}

export function compatibilityMutationEffects(
  projectId: number,
  hostRefs: readonly Readonly<{ type: 'server' | 'nas' | 'pcBuild'; id: number }>[] = [],
): MutationEffects {
  return {
    topology: false,
    geometry: null,
    compatibility: {
      projectIds: positiveIds([projectId]),
      hostRefs: [...hostRefs].sort((left, right) => left.type.localeCompare(right.type) || left.id - right.id),
    },
    presentation: null,
  }
}

export function workbookMutationEffects(projectId: number): MutationEffects {
  return {
    topology: false,
    geometry: null,
    compatibility: null,
    presentation: { projectIds: positiveIds([projectId]), itemRefs: [] },
  }
}
