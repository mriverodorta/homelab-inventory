import { normalizeRegistryStore } from '../registry/model.mjs'

export function migrateSchema14To15(registry) {
  return normalizeRegistryStore(registry)
}
