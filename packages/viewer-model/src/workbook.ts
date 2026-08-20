import { parseShareManifest, type ShareManifest } from '@homelab-inventory/share-contract'

import { deepFreeze, type DeepReadonly } from './immutable'

export interface SharedWorkbookModel {
  projectPublicId: string
  projectLabel: string
  title: string
  description: string | null
  initialViewPublicId: string
  views: ShareManifest['views']
}

export function createSharedWorkbookModel(value: unknown): DeepReadonly<SharedWorkbookModel> {
  const manifest = parseShareManifest(value)
  return deepFreeze({
    projectPublicId: manifest.projectPublicId,
    projectLabel: manifest.projectLabel,
    title: manifest.title,
    description: manifest.description ?? null,
    initialViewPublicId: manifest.initialViewPublicId,
    views: [...manifest.views].sort((a, b) => a.sortOrder - b.sortOrder),
  })
}
