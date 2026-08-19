import type { ProjectState } from '@/types/inventory'
import type { HistoryState } from '@/lib/history'
import type {
  InventoryItemMetadataInput,
  InventoryMetadataItemRef,
} from '@/types/inventory-metadata'

export type InventoryMetadataHistoryItem = Readonly<{
  ref: InventoryMetadataItemRef
  metadata: InventoryItemMetadataInput
}>

export type InventoryMetadataHistoryState = ReadonlyMap<string, InventoryMetadataHistoryItem>

export type ProjectHistorySnapshot = Readonly<{
  project: ProjectState
  inventoryMetadata: InventoryMetadataHistoryState
}>

export function inventoryMetadataHistoryKey(ref: InventoryMetadataItemRef) {
  return `${ref.type}:${ref.id}`
}

function copyInput(input: InventoryItemMetadataInput): InventoryItemMetadataInput {
  return {
    values: input.values.map((value) => ({
      ...value,
      value: Array.isArray(value.value) ? [...value.value] : value.value,
    })),
    tagIds: [...input.tagIds],
  }
}

export function setInventoryMetadataHistoryItem(
  state: InventoryMetadataHistoryState,
  ref: InventoryMetadataItemRef,
  metadata: InventoryItemMetadataInput,
) {
  const next = new Map(state)
  next.set(inventoryMetadataHistoryKey(ref), { ref: { ...ref }, metadata: copyInput(metadata) })
  return next as InventoryMetadataHistoryState
}

export function createProjectHistorySnapshot(
  project: ProjectState,
  inventoryMetadata: InventoryMetadataHistoryState,
): ProjectHistorySnapshot {
  return { project, inventoryMetadata: new Map(inventoryMetadata) }
}

export function backfillProjectHistoryMetadata(
  history: HistoryState<ProjectHistorySnapshot>,
  ref: InventoryMetadataItemRef,
  metadata: InventoryItemMetadataInput,
): HistoryState<ProjectHistorySnapshot> {
  const key = inventoryMetadataHistoryKey(ref)
  const backfill = (snapshot: ProjectHistorySnapshot) => snapshot.inventoryMetadata.has(key)
    ? snapshot
    : createProjectHistorySnapshot(
        snapshot.project,
        setInventoryMetadataHistoryItem(snapshot.inventoryMetadata, ref, metadata),
      )
  return {
    past: history.past.map(backfill),
    future: history.future.map(backfill),
  }
}

export function metadataHistoryChanges(
  current: InventoryMetadataHistoryState,
  target: InventoryMetadataHistoryState,
) {
  return [...target].flatMap(([key, item]) => (
    JSON.stringify(current.get(key)?.metadata) === JSON.stringify(item.metadata) ? [] : [item]
  ))
}

export function projectHistoryContentEqual(left: ProjectState, right: ProjectState) {
  const leftComparable = { ...left, revision: 0 }
  const rightComparable = { ...right, revision: 0 }
  return JSON.stringify(leftComparable) === JSON.stringify(rightComparable)
}
