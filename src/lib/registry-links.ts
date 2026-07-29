import type { RegistryState } from '@/types/registry'

const LINKED_STATES = new Set(['linked', 'update-available'])
export const EMPTY_REGISTRY_LINK_KEYS: ReadonlySet<string> = new Set()

export function buildVisibleRegistryLinkKeys(registry: RegistryState | undefined): ReadonlySet<string> {
  if (!registry?.settings.showRegistryLinkIndicators) return EMPTY_REGISTRY_LINK_KEYS

  return new Set(
    registry.links
      .filter((link) => LINKED_STATES.has(link.state))
      .map((link) => `${link.itemType}:${link.itemId}`),
  )
}
