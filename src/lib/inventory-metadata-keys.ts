import type { InventoryMetadataItemRef } from '@/types/inventory-metadata'
import type * as api from '@/lib/inventory-metadata-api'

export const inventoryMetadataKeys = Object.freeze({
  root: ['inventory-metadata'] as const,
  catalogs: () => [...inventoryMetadataKeys.root, 'catalog'] as const,
  catalog: (includeArchived = false) => [...inventoryMetadataKeys.catalogs(), { includeArchived }] as const,
  project: (projectId: number) => [...inventoryMetadataKeys.root, 'project', projectId] as const,
  projectItems: (projectId: number) => [...inventoryMetadataKeys.project(projectId), 'items'] as const,
  projectProjections: (projectId: number) => [...inventoryMetadataKeys.project(projectId), 'projections'] as const,
  projectProjection: (projectId: number, query: api.InventoryMetadataProjectQuery) => (
    [...inventoryMetadataKeys.projectProjections(projectId), query] as const
  ),
  item: (projectId: number, ref: InventoryMetadataItemRef) => (
    [...inventoryMetadataKeys.projectItems(projectId), ref.type, ref.id] as const
  ),
  itemRevision: (projectId: number, itemId: number) => (
    [...inventoryMetadataKeys.project(projectId), 'item-revisions', itemId] as const
  ),
})

