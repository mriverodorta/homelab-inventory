import { InventoryMetadataForm } from './inventory-metadata-form'
import type { InventoryMetadataDraft } from './inventory-metadata-draft'
import { useInventoryMetadataCatalog } from '@/lib/inventory-metadata-query'
import type { InventoryType } from '@/types/inventory'

export function InventoryMetadataDraftPanel({
  itemType,
  draft,
  disabled,
  onChange,
}: {
  itemType: InventoryType
  draft: InventoryMetadataDraft
  disabled: boolean
  onChange: (draft: InventoryMetadataDraft) => void
}) {
  const catalog = useInventoryMetadataCatalog()

  if (catalog.isPending) return <div className="min-h-44 animate-pulse rounded-md bg-muted/40" aria-label="Loading inventory metadata" />
  if (catalog.error) return <p role="alert" className="text-sm font-semibold text-destructive">{catalog.error.message}</p>
  if (!catalog.data) return null

  return (
    <InventoryMetadataForm
      definitions={catalog.data.definitions.filter((definition) => definition.applicableItemTypes.includes(itemType))}
      tags={catalog.data.tags}
      draft={draft}
      disabled={disabled}
      onChange={onChange}
    />
  )
}
