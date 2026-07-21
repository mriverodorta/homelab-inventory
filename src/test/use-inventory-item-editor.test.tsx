import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useInventoryItemEditor } from '@/hooks/use-inventory-item-editor'
import type { InventoryItem } from '@/types/inventory'

const cpu: InventoryItem = {
  id: 1,
  name: 'Original CPU',
  type: 'cpu',
  manufacturer: 'Intel',
  specs: { cores: 4, threads: 8 },
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, reject, resolve }
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

  it('serializes immediate saves and sends the latest combined draft next', async () => {
    const firstSave = deferred<void>()
    const secondSave = deferred<void>()
    const onSave = vi.fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise)
    const { result } = renderHook(() => useInventoryItemEditor({ item: cpu, onSave }))

    act(() => result.current.updateValues({ name: 'Queued CPU' }, 'immediate'))
    act(() => result.current.updateValues({ manufacturer: 'AMD' }, 'immediate'))

    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave).toHaveBeenNthCalledWith(1, expect.objectContaining({
      name: 'Queued CPU',
      manufacturer: 'Intel',
    }))

    await act(async () => {
      firstSave.resolve()
      await firstSave.promise
    })

    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave).toHaveBeenNthCalledWith(2, expect.objectContaining({
      name: 'Queued CPU',
      manufacturer: 'AMD',
    }))

    await act(async () => {
      secondSave.resolve()
      await secondSave.promise
    })
  })

  it('preserves the latest draft when an earlier canonical acknowledgement arrives', async () => {
    const firstSave = deferred<void>()
    const secondSave = deferred<void>()
    const onSave = vi.fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise)
    const { result, rerender } = renderHook(
      ({ item }) => useInventoryItemEditor({ item, onSave }),
      { initialProps: { item: cpu } },
    )

    act(() => result.current.updateValues({ name: 'First canonical CPU' }, 'immediate'))
    act(() => result.current.updateValues({ manufacturer: 'AMD' }, 'immediate'))

    await act(async () => {
      firstSave.resolve()
      await firstSave.promise
    })
    expect(onSave).toHaveBeenCalledTimes(2)

    rerender({ item: { ...cpu, name: 'First canonical CPU' } })

    expect(result.current.values.name).toBe('First canonical CPU')
    expect(result.current.values.manufacturer).toBe('AMD')

    await act(async () => {
      secondSave.resolve()
      await secondSave.promise
    })
  })

  it('prunes skipped acknowledgement revisions when a newer revision is acknowledged', async () => {
    vi.useFakeTimers()
    const firstSave = deferred<void>()
    const secondSave = deferred<void>()
    const onSave = vi.fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise)
      .mockResolvedValueOnce(undefined)
    const { result, rerender } = renderHook(
      ({ item }) => useInventoryItemEditor({ item, onSave }),
      { initialProps: { item: cpu } },
    )

    act(() => result.current.updateValues({ name: 'Revision one CPU' }, 'immediate'))
    act(() => result.current.updateValues({ manufacturer: 'AMD' }, 'immediate'))
    act(() => result.current.updateValues({ family: 'Pending family' }))

    await act(async () => {
      firstSave.resolve()
      await firstSave.promise
    })
    expect(onSave).toHaveBeenCalledTimes(2)

    rerender({
      item: {
        ...cpu,
        name: 'Revision one CPU',
        manufacturer: 'AMD',
      },
    })

    expect(result.current.values.family).toBe('Pending family')

    rerender({ item: { ...cpu, name: 'Revision one CPU' } })

    expect(result.current.values.name).toBe('Revision one CPU')
    expect(result.current.values.manufacturer).toBe('Intel')
    expect(result.current.values.family).toBe('')

    await act(async () => {
      secondSave.resolve()
      await secondSave.promise
    })
  })

  it('does not acknowledge a repeated fingerprint until its queued revision becomes active', async () => {
    vi.useFakeTimers()
    const firstSave = deferred<void>()
    const secondSave = deferred<void>()
    const thirdSave = deferred<void>()
    const onSave = vi.fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise)
      .mockImplementationOnce(() => thirdSave.promise)
      .mockResolvedValueOnce(undefined)
    const horizontalCpu: InventoryItem = {
      ...cpu,
      properties: { canvasOrientation: 'horizontal' },
    }
    const verticalCpu: InventoryItem = {
      ...cpu,
      properties: { canvasOrientation: 'vertical' },
    }
    const { result, rerender } = renderHook(
      ({ item }) => useInventoryItemEditor({ item, onSave }),
      { initialProps: { item: horizontalCpu } },
    )

    act(() => result.current.updateValues({
      properties: { canvasOrientation: 'vertical' },
    }, 'immediate'))
    act(() => result.current.updateValues({
      properties: { canvasOrientation: 'horizontal' },
    }, 'immediate'))
    act(() => result.current.updateValues({
      properties: { canvasOrientation: 'vertical' },
    }, 'immediate'))

    expect(onSave).toHaveBeenCalledOnce()
    rerender({ item: verticalCpu })

    act(() => result.current.updateValues({ family: 'Pending family' }))

    await act(async () => {
      firstSave.resolve()
      await firstSave.promise
    })
    expect(onSave).toHaveBeenCalledTimes(2)

    rerender({ item: horizontalCpu })
    expect(result.current.values.family).toBe('Pending family')
    expect(result.current.values.properties?.canvasOrientation).toBe('vertical')

    await act(async () => {
      secondSave.resolve()
      await secondSave.promise
    })
    expect(onSave).toHaveBeenCalledTimes(3)

    rerender({ item: verticalCpu })
    expect(result.current.values.family).toBe('Pending family')

    rerender({ item: horizontalCpu })
    expect(result.current.values.family).toBe('')
    expect(result.current.values.properties?.canvasOrientation).toBe('horizontal')

    await act(async () => {
      thirdSave.resolve()
      await thirdSave.promise
      await Promise.resolve()
    })
  })

  it('continues queued saves after an earlier save fails', async () => {
    const firstSave = deferred<void>()
    const onSave = vi.fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useInventoryItemEditor({ item: cpu, onSave }))

    act(() => result.current.updateValues({ name: 'Rejected CPU' }, 'immediate'))
    act(() => result.current.updateValues({ manufacturer: 'AMD' }, 'immediate'))

    expect(onSave).toHaveBeenCalledOnce()

    await act(async () => {
      firstSave.reject(new Error('First save failed.'))
      await firstSave.promise.catch(() => undefined)
    })

    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      name: 'Rejected CPU',
      manufacturer: 'AMD',
    }))
    expect(result.current.saveError).toBeNull()
  })

  it('reset discards unsent queued saves while allowing the active save to finish', async () => {
    const activeSave = deferred<void>()
    const onSave = vi.fn().mockImplementationOnce(() => activeSave.promise)
    const { result } = renderHook(() => useInventoryItemEditor({ item: cpu, onSave }))

    act(() => result.current.updateValues({ name: 'Active CPU' }, 'immediate'))
    act(() => result.current.updateValues({ manufacturer: 'AMD' }, 'immediate'))
    expect(onSave).toHaveBeenCalledOnce()

    act(() => result.current.reset())
    expect(result.current.values.name).toBe('Original CPU')
    expect(result.current.values.manufacturer).toBe('Intel')

    await act(async () => {
      activeSave.resolve()
      await activeSave.promise
    })

    expect(onSave).toHaveBeenCalledOnce()
    expect(result.current.values.name).toBe('Original CPU')
    expect(result.current.values.manufacturer).toBe('Intel')
  })

  it('keeps queued saves durable and isolated when the selected item changes', async () => {
    vi.useFakeTimers()
    const activeSave = deferred<void>()
    const firstItemSave = vi.fn()
      .mockImplementationOnce(() => activeSave.promise)
      .mockRejectedValueOnce(new Error('Old item save failed.'))
    const secondItemSave = vi.fn()
    const nextCpu: InventoryItem = {
      id: 2,
      name: 'Second CPU',
      type: 'cpu',
      manufacturer: 'Intel',
      specs: { cores: 8 },
    }
    const { result, rerender } = renderHook(
      ({ item, onSave }) => useInventoryItemEditor({ item, onSave }),
      { initialProps: { item: cpu, onSave: firstItemSave } },
    )

    act(() => result.current.updateValues({ name: 'Active first CPU' }, 'immediate'))
    act(() => result.current.updateValues({ manufacturer: 'AMD' }))
    rerender({ item: nextCpu, onSave: secondItemSave })

    expect(result.current.values.name).toBe('Second CPU')
    expect(firstItemSave).toHaveBeenCalledOnce()

    await act(async () => {
      activeSave.resolve()
      await activeSave.promise
      await Promise.resolve()
    })

    expect(firstItemSave).toHaveBeenCalledTimes(2)
    expect(firstItemSave).toHaveBeenLastCalledWith(expect.objectContaining({
      name: 'Active first CPU',
      manufacturer: 'AMD',
    }))
    expect(secondItemSave).not.toHaveBeenCalled()
    expect(result.current.values.name).toBe('Second CPU')
    expect(result.current.values.manufacturer).toBe('Intel')
    expect(result.current.saveError).toBeNull()
  })

  it('flushes a pending save before resyncing when the selected item changes', async () => {
    vi.useFakeTimers()
    const onSave = vi.fn()
    const nextCpu: InventoryItem = {
      id: 2,
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

  it('keeps a queued debounced save after unmount', async () => {
    vi.useFakeTimers()
    const activeSave = deferred<void>()
    const onSave = vi.fn()
      .mockImplementationOnce(() => activeSave.promise)
      .mockResolvedValueOnce(undefined)
    const { result, unmount } = renderHook(() => useInventoryItemEditor({ item: cpu, onSave }))

    act(() => result.current.updateValues({ name: 'Active CPU' }, 'immediate'))
    act(() => result.current.updateValues({ manufacturer: 'AMD' }))
    unmount()

    expect(onSave).toHaveBeenCalledOnce()

    activeSave.resolve()
    await activeSave.promise
    await Promise.resolve()

    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      name: 'Active CPU',
      manufacturer: 'AMD',
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
      id: 1,
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
