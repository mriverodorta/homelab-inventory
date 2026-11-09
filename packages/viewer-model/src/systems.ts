import { parseShareViewBlob, type SystemsViewBlob } from '@homelab-inventory/share-contract'

import { deepFreeze, type DeepReadonly } from './immutable'
import { presentSharedItems, type SharedPresentationContext, type SharedPresentedItem } from './item-presentation'

export interface SharedSystemsModel {
  publicViewId: string
  rows: SharedPresentedItem<SystemsViewBlob['items'][number]>[]
}

export function createSharedSystemsModel(value: unknown, presentation?: SharedPresentationContext): DeepReadonly<SharedSystemsModel> {
  const blob = parseShareViewBlob(value)
  if (blob.viewType !== 'systems') throw new TypeError('Expected a Systems share view.')

  return deepFreeze({
    publicViewId: blob.publicViewId,
    rows: presentSharedItems(blob.items, presentation),
  })
}
