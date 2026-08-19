import type { ProjectState } from '@/types/inventory'
import type { ProjectWorkbook } from '@/lib/workbook-api'
import type { InventoryProperties } from '@/types/inventory'
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
  workbook: ProjectWorkbook | null
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
  workbook: ProjectWorkbook | null = null,
): ProjectHistorySnapshot {
  return {
    project,
    inventoryMetadata: new Map(inventoryMetadata),
    workbook: workbook === null ? null : structuredClone(workbook),
  }
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
          snapshot.workbook,
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

function projectWithoutInventoryProperties(project: ProjectState) {
  return {
    ...project,
    revision: 0,
    items: Object.fromEntries(Object.entries(project.items).map(([key, item]) => [
      key,
      { ...item, properties: undefined },
    ])),
  }
}

function projectWithoutInventoryItems(project: ProjectState) {
  return { ...project, revision: 0, items: {} }
}

export function inventoryPropertiesOnlyChanged(current: ProjectState, target: ProjectState) {
  return !projectHistoryContentEqual(current, target)
    && JSON.stringify(projectWithoutInventoryProperties(current))
      === JSON.stringify(projectWithoutInventoryProperties(target))
}

export function inventoryPropertyHistoryChanges(current: ProjectState, target: ProjectState) {
  return Object.entries(target.items).flatMap(([key, targetItem]) => {
    const currentItem = current.items[key]
    if (!currentItem || JSON.stringify(currentItem.properties ?? {}) === JSON.stringify(targetItem.properties ?? {})) {
      return []
    }
    return [{
      ref: { type: targetItem.type, id: targetItem.id },
      properties: { ...(targetItem.properties ?? {}) } as InventoryProperties,
    }]
  })
}

export function inventoryItemsOnlyChanged(current: ProjectState, target: ProjectState) {
  return !projectHistoryContentEqual(current, target)
    && JSON.stringify(projectWithoutInventoryItems(current))
      === JSON.stringify(projectWithoutInventoryItems(target))
    && Object.keys(current.items).length === Object.keys(target.items).length
    && Object.keys(current.items).every((key) => target.items[key] !== undefined)
}

export function inventoryItemHistoryChanges(current: ProjectState, target: ProjectState) {
  return Object.entries(target.items).flatMap(([key, targetItem]) => (
    JSON.stringify(current.items[key]) === JSON.stringify(targetItem)
      ? []
      : [targetItem]
  ))
}
