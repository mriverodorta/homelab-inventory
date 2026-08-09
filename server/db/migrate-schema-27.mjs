import { assertRegistryStoreShape } from '../registry/model.mjs'
import { validateRoutingCache } from '../routing-cache-model.mjs'
import {
  assertInventoryStoreShape,
  assertProjectStoreShape,
} from './validation.mjs'

export function migrateSchema26To27(inventory, project, registry, routingCache) {
  assertInventoryStoreShape(inventory)
  assertProjectStoreShape(project, { requireRevision: true })
  assertRegistryStoreShape(registry)
  validateRoutingCache(routingCache)

  return {
    summary: {
      preservedMotherboards: inventory.motherboards.length,
      preservedAssignments: project.assignments.length,
      preservedPlacements: project.placements.length,
      preservedConnections: project.connections.length,
      preservedRegistryLinks: registry.links.length,
      preservedRoutingEntries: routingCache.entries.length,
    },
  }
}
