import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pushHistory } from '@/lib/history'
import { createEmptyProject } from '@/lib/project'
import {
  createProjectHistorySnapshot,
  setInventoryMetadataHistoryItem,
} from './project-history-snapshot'
import { useProjectHistory } from './use-project-history'

const restoreHistory = vi.fn()

vi.mock('@/lib/inventory-metadata-api', () => ({
  restoreInventoryItemMetadataHistory: (...args: unknown[]) => restoreHistory(...args),
}))

describe('useProjectHistory inventory metadata', () => {
  beforeEach(() => restoreHistory.mockReset())

  it('restores metadata without rewriting unchanged canvas state', async () => {
    const project = { ...createEmptyProject(), revision: 2 }
    const ref = { type: 'server', id: 7 }
    const before = setInventoryMetadataHistoryItem(new Map(), ref, {
      values: [{ definitionId: 1, value: 'Before' }], tagIds: [],
    })
    const after = setInventoryMetadataHistoryItem(before, ref, {
      values: [{ definitionId: 1, value: 'After' }], tagIds: [2],
    })
    const projectRef = { current: project }
    const metadataRef = { current: after }
    const scheduleProjectSave = vi.fn()
    const setProject = vi.fn((value) => { projectRef.current = value })
    const setValidationMessage = vi.fn()
    restoreHistory.mockResolvedValue({
      affectedProjectIds: [1],
      affectedProjectRevisions: { 1: 3 },
      items: [],
    })

    const { result } = renderHook(() => useProjectHistory({
      projectRef,
      inventoryMetadataHistoryRef: metadataRef,
      setProject,
      setSelectedItemId: vi.fn(),
      setSelectedConnectionId: vi.fn(),
      setValidationMessage,
      scheduleProjectSave,
      synchronizeCanonicalRevision: vi.fn(async (revision) => revision),
    }))

    act(() => {
      result.current.setHistory((history) => pushHistory(
        history,
        createProjectHistorySnapshot(project, before),
      ))
    })
    act(() => result.current.undoProjectChange())

    await waitFor(() => expect(restoreHistory).toHaveBeenCalledWith([{
      ref,
      metadata: { values: [{ definitionId: 1, value: 'Before' }], tagIds: [] },
    }]))
    await waitFor(() => expect(result.current.historyBusy).toBe(false))
    expect(setValidationMessage.mock.calls).toEqual([[null]])
    expect(setProject).toHaveBeenCalled()
    await waitFor(() => expect(projectRef.current?.revision).toBe(3))
    expect(metadataRef.current).toEqual(before)
    expect(scheduleProjectSave).not.toHaveBeenCalled()
    expect(setValidationMessage).toHaveBeenLastCalledWith(null)
  })
})
