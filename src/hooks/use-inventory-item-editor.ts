import { useCallback, useEffect, useRef, useState } from 'react'
import {
  inventoryFormValuesToInput,
  inventoryItemToFormValues,
  validateInventoryFormValues,
  type InventoryFormErrors,
  type InventoryFormValues,
} from '@/components/inventory-form/model'
import type { InventoryItemInput } from '@/lib/db'
import { runtimeItemKey } from '@/lib/item-keys'
import type { InventoryItem } from '@/types/inventory'

export type InventoryItemEditorChangeMode = 'debounced' | 'immediate'

export type UseInventoryItemEditorOptions = {
  item: InventoryItem
  onSave: (input: InventoryItemInput) => void | Promise<void>
  debounceMs?: number
}

export type InventoryItemEditor = {
  values: InventoryFormValues
  errors: InventoryFormErrors
  saveError: string | null
  updateValues: (
    patch: Partial<InventoryFormValues>,
    mode?: InventoryItemEditorChangeMode,
  ) => void
  reset: () => void
}

type SubmittedDraft = {
  fingerprint: string
  generation: number
  revision: number
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey))

    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`).join(',')}}`
  }

  return JSON.stringify(value) ?? 'undefined'
}

function inventoryItemAsInput(item: InventoryItem): InventoryItemInput {
  return {
    type: item.type,
    name: item.name,
    ...(item.subtype !== undefined ? { subtype: item.subtype } : {}),
    ...(item.manufacturer !== undefined ? { manufacturer: item.manufacturer } : {}),
    ...(item.secondaryManufacturer !== undefined
      ? { secondaryManufacturer: item.secondaryManufacturer }
      : {}),
    ...(item.family !== undefined ? { family: item.family } : {}),
    ...(item.model !== undefined ? { model: item.model } : {}),
    ...(item.number !== undefined ? { number: item.number } : {}),
    ...(item.specs !== undefined ? { specs: item.specs } : {}),
    ...(item.compatibility !== undefined ? { compatibility: item.compatibility } : {}),
    ...(item.properties !== undefined ? { properties: item.properties } : {}),
    ...(item.ports !== undefined ? { ports: item.ports } : {}),
    ...(item.notes !== undefined ? { notes: item.notes } : {}),
  }
}

function saveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Item could not be saved.'
}

export function useInventoryItemEditor({
  item,
  onSave,
  debounceMs = 500,
}: UseInventoryItemEditorOptions): InventoryItemEditor {
  const [values, setValues] = useState<InventoryFormValues>(() => inventoryItemToFormValues(item))
  const [errors, setErrors] = useState<InventoryFormErrors>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const draftRef = useRef(values)
  const canonicalValuesRef = useRef(values)
  const canonicalFingerprintRef = useRef(stableSerialize(inventoryItemAsInput(item)))
  const itemKeyRef = useRef(runtimeItemKey(item))
  const onSaveRef = useRef(onSave)
  const debounceMsRef = useRef(debounceMs)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const generationRef = useRef(0)
  const revisionRef = useRef(0)
  const submittedDraftRef = useRef<SubmittedDraft | null>(null)

  debounceMsRef.current = debounceMs

  const cancelPendingSave = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const persistDraft = useCallback(async (
    draft: InventoryFormValues,
    revision: number,
    generation: number,
  ) => {
    if (!mountedRef.current || generationRef.current !== generation) {
      return
    }

    const nextErrors = validateInventoryFormValues(draft)
    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      return
    }

    let input: InventoryItemInput
    try {
      input = inventoryFormValuesToInput(draft)
    } catch (error) {
      if (mountedRef.current
        && generationRef.current === generation
        && revisionRef.current === revision) {
        setSaveError(saveErrorMessage(error))
      }
      return
    }

    const submission: SubmittedDraft = {
      fingerprint: stableSerialize(input),
      generation,
      revision,
    }
    submittedDraftRef.current = submission

    try {
      await onSaveRef.current(input)
    } catch (error) {
      if (submittedDraftRef.current === submission) {
        submittedDraftRef.current = null
      }
      if (mountedRef.current
        && generationRef.current === generation
        && revisionRef.current === revision) {
        setSaveError(saveErrorMessage(error))
      }
    }
  }, [])

  const flushPendingSave = useCallback(() => {
    if (timerRef.current === null) {
      return
    }

    clearTimeout(timerRef.current)
    timerRef.current = null
    void persistDraft(
      draftRef.current,
      revisionRef.current,
      generationRef.current,
    )
  }, [persistDraft])

  useEffect(() => {
    mountedRef.current = true

    return () => {
      flushPendingSave()
      mountedRef.current = false
      generationRef.current += 1
      submittedDraftRef.current = null
    }
  }, [flushPendingSave])

  useEffect(() => {
    const nextItemKey = runtimeItemKey(item)
    const nextFingerprint = stableSerialize(inventoryItemAsInput(item))

    if (nextItemKey === itemKeyRef.current
      && nextFingerprint === canonicalFingerprintRef.current) {
      return
    }

    const nextValues = inventoryItemToFormValues(item)
    const itemChanged = nextItemKey !== itemKeyRef.current
    const submittedDraft = submittedDraftRef.current
    const acknowledgesSubmittedDraft = !itemChanged
      && submittedDraft?.generation === generationRef.current
      && submittedDraft.fingerprint === nextFingerprint

    itemKeyRef.current = nextItemKey
    canonicalValuesRef.current = nextValues
    canonicalFingerprintRef.current = nextFingerprint

    if (acknowledgesSubmittedDraft && revisionRef.current > submittedDraft.revision) {
      submittedDraftRef.current = null
      return
    }

    flushPendingSave()
    generationRef.current += 1
    revisionRef.current = 0
    submittedDraftRef.current = null
    draftRef.current = nextValues
    setValues(nextValues)
    setErrors({})
    setSaveError(null)
  }, [flushPendingSave, item])

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  const updateValues = useCallback((
    patch: Partial<InventoryFormValues>,
    mode: InventoryItemEditorChangeMode = 'debounced',
  ) => {
    const nextValues = { ...draftRef.current, ...patch }
    draftRef.current = nextValues
    revisionRef.current += 1
    const revision = revisionRef.current
    const generation = generationRef.current

    setValues(nextValues)
    setErrors((currentErrors) => {
      const nextErrors = { ...currentErrors }
      for (const key of Object.keys(patch) as Array<keyof InventoryFormValues>) {
        delete nextErrors[key]
      }
      return nextErrors
    })
    setSaveError(null)
    cancelPendingSave()

    if (mode === 'immediate') {
      void persistDraft(nextValues, revision, generation)
      return
    }

    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void persistDraft(nextValues, revision, generation)
    }, Math.max(0, debounceMsRef.current))
  }, [cancelPendingSave, persistDraft])

  const reset = useCallback(() => {
    cancelPendingSave()
    generationRef.current += 1
    revisionRef.current = 0
    submittedDraftRef.current = null
    draftRef.current = canonicalValuesRef.current
    setValues(canonicalValuesRef.current)
    setErrors({})
    setSaveError(null)
  }, [cancelPendingSave])

  return {
    values,
    errors,
    saveError,
    updateValues,
    reset,
  }
}
