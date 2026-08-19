import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InventoryMetadataForm } from './inventory-metadata-form'
import {
  EMPTY_INVENTORY_METADATA_DRAFT,
  inventoryMetadataDraft,
  inventoryMetadataDraftEqual,
  inventoryMetadataInput,
  type InventoryMetadataDraft,
} from './inventory-metadata-draft'
import {
  useInventoryItemMetadata,
  useInventoryMetadataCatalog,
  useInventoryMetadataMutations,
} from '@/lib/inventory-metadata-query'
import type {
  InventoryMetadataItemRef,
  InventoryMetadataSavedChange,
} from '@/types/inventory-metadata'

export function InventoryItemMetadataEditor({
  projectId,
  item,
  enabled,
  canEdit,
  onSaved,
}: {
  projectId: number
  item: InventoryMetadataItemRef
  enabled: boolean
  canEdit: boolean
  onSaved?: (change: InventoryMetadataSavedChange) => void | Promise<void>
}) {
  const catalog = useInventoryMetadataCatalog({ enabled })
  const metadata = useInventoryItemMetadata(projectId, item, enabled)
  const mutations = useInventoryMetadataMutations(projectId)
  const [draft, setDraft] = useState<InventoryMetadataDraft>(EMPTY_INVENTORY_METADATA_DRAFT)
  const [baseline, setBaseline] = useState<InventoryMetadataDraft>(EMPTY_INVENTORY_METADATA_DRAFT)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!metadata.data) return
    const next = inventoryMetadataDraft(metadata.data)
    setDraft(next)
    setBaseline(next)
  }, [metadata.data])

  const dirty = !inventoryMetadataDraftEqual(draft, baseline)

  async function save() {
    setError(null)
    try {
      const before = inventoryMetadataInput(baseline)
      const after = inventoryMetadataInput(draft)
      const result = await mutations.updateItem.mutateAsync({ ref: item, input: after })
      const next = inventoryMetadataDraft(result.metadata)
      setDraft(next)
      setBaseline(next)
      await onSaved?.({ ref: item, before, after: inventoryMetadataInput(next), result })
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Inventory metadata could not be saved.')
    }
  }

  if (!enabled) return null
  if (metadata.isPending || catalog.isPending) return <div className="min-h-40 animate-pulse rounded-md bg-muted/40" aria-label="Loading inventory metadata" />
  if (metadata.error || catalog.error) return <p role="alert" className="text-sm font-semibold text-destructive">{metadata.error?.message ?? catalog.error?.message}</p>
  if (!metadata.data || !catalog.data) return null

  return (
    <div className="space-y-4">
      <InventoryMetadataForm
        definitions={metadata.data.definitions}
        tags={catalog.data.tags}
        draft={draft}
        disabled={!canEdit || mutations.updateItem.isPending}
        onChange={setDraft}
      />
      {error ? <p role="alert" className="text-sm font-semibold text-destructive">{error}</p> : null}
      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-background/95 py-3 backdrop-blur">
        <Button type="button" variant="outline" disabled={!dirty || mutations.updateItem.isPending} onClick={() => setDraft(baseline)}>Reset</Button>
        <Button type="button" disabled={!canEdit || !dirty || mutations.updateItem.isPending} onClick={() => void save()}>{mutations.updateItem.isPending ? 'Saving…' : 'Save metadata'}</Button>
      </div>
    </div>
  )
}
