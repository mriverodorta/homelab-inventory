import { normalizeRegistryStore } from '../registry/model.mjs'

export function migrateSchema16To17(registry) {
  const migrated = normalizeRegistryStore(registry)
  return {
    registry: migrated,
    summary: {
      catalogLinks: migrated.links.length,
      adoptionLinks: migrated.links.filter((link) => link.state === 'adoption-available').length,
    },
  }
}
