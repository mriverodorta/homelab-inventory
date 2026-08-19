import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useInventoryMetadataAutosave } from './use-inventory-metadata-autosave'

const baseline = { values: {}, tagIds: [] }
const draft = { values: { 1: 'Production' }, tagIds: [2] }

describe('inventory metadata autosave', () => {
  afterEach(() => vi.useRealTimers())

  it('saves the current draft once after 500 milliseconds', () => {
    vi.useFakeTimers()
    const onSave = vi.fn()
    renderHook(() => useInventoryMetadataAutosave({
      enabled: true,
      dirty: true,
      saving: false,
      draft,
      baseline,
      revision: 4,
      onSave,
    }))

    act(() => vi.advanceTimersByTime(499))
    expect(onSave).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave).toHaveBeenCalledWith(draft, baseline, 4)
  })

  it('does not schedule while clean, read-only, or already saving', () => {
    vi.useFakeTimers()
    const onSave = vi.fn()
    const { rerender } = renderHook((properties) => useInventoryMetadataAutosave(properties), {
      initialProps: {
        enabled: true,
        dirty: false,
        saving: false,
        draft,
        baseline,
        revision: 4,
        onSave,
      },
    })
    rerender({ enabled: false, dirty: true, saving: false, draft, baseline, revision: 4, onSave })
    rerender({ enabled: true, dirty: true, saving: true, draft, baseline, revision: 4, onSave })
    act(() => vi.advanceTimersByTime(1_000))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('restarts the debounce with the newest draft', () => {
    vi.useFakeTimers()
    const onSave = vi.fn()
    const { rerender } = renderHook((properties) => useInventoryMetadataAutosave(properties), {
      initialProps: {
        enabled: true,
        dirty: true,
        saving: false,
        draft,
        baseline,
        revision: 4,
        onSave,
      },
    })
    act(() => vi.advanceTimersByTime(300))
    const newest = { values: { 1: 'Staging' }, tagIds: [3] }
    rerender({ enabled: true, dirty: true, saving: false, draft: newest, baseline, revision: 4, onSave })
    act(() => vi.advanceTimersByTime(499))
    expect(onSave).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onSave).toHaveBeenCalledWith(newest, baseline, 4)
  })
})
