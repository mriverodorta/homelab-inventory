import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useInventoryItemEditor } from '@/hooks/use-inventory-item-editor'
import type { InventoryItem } from '@/types/inventory'

const cpu: InventoryItem = {
  id: 'cpu-a',
  name: 'Original CPU',
  type: 'cpu',
  manufacturer: 'Intel',
  specs: { cores: 4, threads: 8 },
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useInventoryItemEditor', () => {
  it('updates the local draft immediately and debounces text saves', async () => {
    vi.useFakeTimers()
    const onSave = vi.fn()
    const { result } = renderHook(() => useInventoryItemEditor({ item: cpu, onSave }))

    act(() => result.current.updateValues({ name: 'Updated CPU' }))

    expect(result.current.values.name).toBe('Updated CPU')
    expect(onSave).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTimeAsync(499))
    expect(onSave).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(onSave).toHaveBeenCalledWith({
      type: 'cpu',
      name: 'Updated CPU',
      manufacturer: 'Intel',
      specs: { cores: 4, threads: 8 },
    })
  })

  it('saves select and toggle changes immediately', () => {
    vi.useFakeTimers()
    const onSave = vi.fn()
    const { result } = renderHook(() => useInventoryItemEditor({ item: cpu, onSave }))

    act(() => result.current.updateValues({ manufacturer: 'AMD' }, 'immediate'))

    expect(result.current.values.manufacturer).toBe('AMD')
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ manufacturer: 'AMD' }))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('flushes a pending save before resyncing when the selected item changes', async () => {
    vi.useFakeTimers()
    const onSave = vi.fn()
    const nextCpu: InventoryItem = {
      id: 'cpu-b',
      name: 'Second CPU',
      type: 'cpu',
      specs: { cores: 8 },
    }
    const { result, rerender } = renderHook(
      ({ item }) => useInventoryItemEditor({ item, onSave }),
      { initialProps: { item: cpu } },
    )

    act(() => result.current.updateValues({ name: 'Unsaved CPU' }))
    rerender({ item: nextCpu })

    expect(result.current.values.name).toBe('Second CPU')

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Unsaved CPU',
    }))

    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(onSave).toHaveBeenCalledOnce()
  })

  it('flushes a pending save when unmounted', async () => {
    vi.useFakeTimers()
    const onSave = vi.fn()
    const { result, unmount } = renderHook(() => useInventoryItemEditor({ item: cpu, onSave }))

    act(() => result.current.updateValues({ name: 'Unsaved CPU' }))
    unmount()
    await vi.advanceTimersByTimeAsync(500)

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Unsaved CPU',
    }))
  })

  it('resyncs when the canonical selected item changes outside the draft', () => {
    const onSave = vi.fn()
    const { result, rerender } = renderHook(
      ({ item }) => useInventoryItemEditor({ item, onSave }),
      { initialProps: { item: cpu } },
    )

    rerender({ item: { ...cpu, name: 'Canonical CPU', specs: { cores: 6 } } })

    expect(result.current.values.name).toBe('Canonical CPU')
    expect(result.current.values.cores).toBe('6')
  })

  it('uses the latest save callback when a debounce completes', async () => {
    vi.useFakeTimers()
    const firstSave = vi.fn()
    const secondSave = vi.fn()
    const { result, rerender } = renderHook(
      ({ onSave }) => useInventoryItemEditor({ item: cpu, onSave }),
      { initialProps: { onSave: firstSave } },
    )

    act(() => result.current.updateValues({ name: 'Updated CPU' }))
    rerender({ onSave: secondSave })
    await act(async () => vi.advanceTimersByTimeAsync(500))

    expect(firstSave).not.toHaveBeenCalled()
    expect(secondSave).toHaveBeenCalledOnce()
  })

  it('validates before saving and exposes field errors', () => {
    const onSave = vi.fn()
    const { result } = renderHook(() => useInventoryItemEditor({ item: cpu, onSave }))

    act(() => result.current.updateValues({ name: '' }, 'immediate'))

    expect(result.current.errors.name).toBe('Name is required.')
    expect(result.current.saveError).toBeNull()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('exposes reconciliation errors without calling save', () => {
    const protectedSwitch: InventoryItem = {
      id: 'switch-a',
      type: 'switch',
      name: 'Protected switch',
      ports: [
        {
          id: 21,
          kind: 'switch-port',
          type: 'rj45',
          slotNumber: 1,
          speed: '1G',
          label: 'Uplink',
        },
      ],
    }
    const onSave = vi.fn()
    const { result } = renderHook(() => useInventoryItemEditor({ item: protectedSwitch, onSave }))

    act(() => result.current.updateValues({
      portGroups: [{ ...result.current.values.portGroups[0], count: 0 }],
    }, 'immediate'))

    expect(result.current.errors).toEqual({})
    expect(result.current.saveError).toMatch(/protected port 21/i)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('exposes callback failures and reset restores the canonical draft', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Project save failed.'))
    const { result } = renderHook(() => useInventoryItemEditor({ item: cpu, onSave }))

    await act(async () => {
      result.current.updateValues({ name: 'Rejected CPU' }, 'immediate')
      await Promise.resolve()
    })

    expect(result.current.saveError).toBe('Project save failed.')

    act(() => result.current.reset())

    expect(result.current.values.name).toBe('Original CPU')
    expect(result.current.errors).toEqual({})
    expect(result.current.saveError).toBeNull()
  })
})
