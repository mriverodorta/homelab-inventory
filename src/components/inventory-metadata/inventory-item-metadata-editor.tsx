import { useEffect, useRef, useState } from 'react'
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
import { useInventoryMetadataAutosave } from './use-inventory-metadata-autosave'
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
  const [baselineRevision, setBaselineRevision] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const saveSequenceRef = useRef(0)

  useEffect(() => {
    if (!metadata.data) return
    const next = inventoryMetadataDraft(metadata.data)
    setDraft(next)
    setBaseline(next)
    setBaselineRevision(metadata.data.revision)
  }, [metadata.data])

  const dirty = !inventoryMetadataDraftEqual(draft, baseline)

  async function save(
    submittedDraft: InventoryMetadataDraft,
    submittedBaseline: InventoryMetadataDraft,
    expectedRevision: number,
  ) {
    const sequence = ++saveSequenceRef.current
    setError(null)
    try {
      const before = inventoryMetadataInput(submittedBaseline)
      const after = inventoryMetadataInput(submittedDraft)
      const result = await mutations.updateItem.mutateAsync({ ref: item, input: after, expectedRevision })
      const next = inventoryMetadataDraft(result.metadata)
      if (sequence !== saveSequenceRef.current) return
      setBaseline(next)
      setBaselineRevision(result.metadata.revision)
      setDraft((current) => inventoryMetadataDraftEqual(current, submittedDraft) ? next : current)
      await onSaved?.({ ref: item, before, after: inventoryMetadataInput(next), result })
    } catch (caughtError) {
      if (sequence !== saveSequenceRef.current) return
      setError(caughtError instanceof Error ? caughtError.message : 'Inventory metadata could not be saved.')
    }
  }

  useInventoryMetadataAutosave({
    enabled: canEdit,
    dirty,
    saving: mutations.updateItem.isPending,
    draft,
    baseline,
    revision: baselineRevision,
    onSave: save,
  })

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
      <p className="min-h-5 text-right text-xs text-muted-foreground" aria-live="polite">
        {mutations.updateItem.isPending ? 'Saving…' : dirty ? 'Changes save automatically' : 'Saved'}
      </p>
    </div>
  )
}
