import type { HostType, InventoryType } from './inventory'

export type PersistenceDomain =
  | 'topology'
  | 'geometry'
  | 'compatibility'
  | 'inventory'
  | 'metadata'
  | 'workbook'
  | 'workspace-preferences'
  | 'operational'

export type InventoryMutationRef = Readonly<{
  type: InventoryType
  id: number
}>

export type HostMutationRef = Readonly<{
  type: HostType
  id: number
}>

export type GeometryMutationEffect = Readonly<{
  projectIds: readonly number[]
  workspaceIds: readonly number[]
  itemRefs: readonly InventoryMutationRef[]
  connectionIds: readonly number[]
}>

export type CompatibilityMutationEffect = Readonly<{
  projectIds: readonly number[]
  hostRefs: readonly HostMutationRef[]
}>

export type PresentationMutationEffect = Readonly<{
  projectIds: readonly number[]
  itemRefs: readonly InventoryMutationRef[]
}>

export type MutationEffects = Readonly<{
  topology: boolean
  geometry: GeometryMutationEffect | null
  compatibility: CompatibilityMutationEffect | null
  presentation: PresentationMutationEffect | null
}>

export type DomainMutationRevisions = Readonly<{
  topology?: number
  workbook?: number
  workspace?: number
  inventoryItem?: number
  compatibility?: number
  metadata?: number
}>

export type DomainMutationResult<T> = Readonly<{
  data: T
  revisions: DomainMutationRevisions
  effects: MutationEffects
}>

export const NO_MUTATION_EFFECTS: MutationEffects = Object.freeze({
  topology: false,
  geometry: null,
  compatibility: null,
  presentation: null,
})
