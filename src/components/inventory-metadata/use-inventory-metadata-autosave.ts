import { useEffect, useRef } from 'react'
import type { InventoryMetadataDraft } from './inventory-metadata-draft'

const METADATA_AUTOSAVE_DELAY_MS = 500

export function useInventoryMetadataAutosave({
  enabled,
  dirty,
  saving,
  draft,
  baseline,
  revision,
  onSave,
}: {
  enabled: boolean
  dirty: boolean
  saving: boolean
  draft: InventoryMetadataDraft
  baseline: InventoryMetadataDraft
  revision: number
  onSave(
    draft: InventoryMetadataDraft,
    baseline: InventoryMetadataDraft,
    revision: number,
  ): void | Promise<void>
}) {
  const saveRef = useRef(onSave)
  saveRef.current = onSave

  useEffect(() => {
    if (!enabled || !dirty || saving) return
    const timer = window.setTimeout(() => {
      void saveRef.current(draft, baseline, revision)
    }, METADATA_AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [baseline, dirty, draft, enabled, revision, saving])
}
