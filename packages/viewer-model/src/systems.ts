import { parseShareViewBlob, type SystemsViewBlob } from '@homelab-inventory/share-contract'

import { deepFreeze, type DeepReadonly } from './immutable'

export interface SharedSystemsModel {
  publicViewId: string
  rows: SystemsViewBlob['items']
}

export function createSharedSystemsModel(value: unknown): DeepReadonly<SharedSystemsModel> {
  const blob = parseShareViewBlob(value)
  if (blob.viewType !== 'systems') throw new TypeError('Expected a Systems share view.')

  return deepFreeze({
    publicViewId: blob.publicViewId,
    rows: blob.items,
  })
}
