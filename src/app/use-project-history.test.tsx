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
const updatePolicy = vi.fn()

vi.mock('@/lib/inventory-metadata-api', () => ({
  restoreInventoryItemMetadataHistory: (...args: unknown[]) => restoreHistory(...args),
}))
vi.mock('@/lib/compatibility-audit-api', () => ({
  updateCompatibilityPolicy: (...args: unknown[]) => updatePolicy(...args),
}))

describe('useProjectHistory inventory metadata', () => {
  beforeEach(() => {
    restoreHistory.mockReset()
    updatePolicy.mockReset()
  })

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
    const refreshInventoryMetadata = vi.fn(async () => undefined)
    restoreHistory.mockResolvedValue({
      affectedProjectIds: [1],
      affectedMetadataRevisions: { 7: 3 },
      items: [{
        itemId: 7,
        metadata: {
          itemId: 7,
          revision: 3,
          definitions: [],
          values: [{ definitionId: 1, value: 'Before' }],
          tags: [],
        },
      }],
    })

    const { result } = renderHook(() => useProjectHistory({
      projectRef,
      inventoryMetadataHistoryRef: metadataRef,
      setProject,
      setSelectedItemId: vi.fn(),
      setSelectedConnectionId: vi.fn(),
      setValidationMessage,
      scheduleProjectSave,
      refreshInventoryMetadata,
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
    await waitFor(() => expect(projectRef.current?.revision).toBe(2))
    expect(metadataRef.current).toEqual(before)
    expect(refreshInventoryMetadata).toHaveBeenCalledWith([1], [{
      ref: { type: 'server', id: 7 },
      metadata: expect.objectContaining({ itemId: 7, revision: 3 }),
    }])
    expect(scheduleProjectSave).not.toHaveBeenCalled()
    expect(setValidationMessage).toHaveBeenLastCalledWith(null)
  })

  it('restores compatibility policy without scheduling a project or engine save', async () => {
    const project = {
      ...createEmptyProject(),
      revision: 2,
      metadata: { ...createEmptyProject().metadata, projectId: 1 },
      compatibilityPolicy: { disabledHosts: [], ignoredWarningIds: [] },
    }
    const previous = {
      ...project,
      compatibilityPolicy: {
        disabledHosts: [{ hostType: 'server' as const, hostId: 7 }],
        ignoredWarningIds: [],
      },
    }
    const projectRef = { current: project }
    const metadataRef = { current: new Map() }
    const scheduleProjectSave = vi.fn()
    const setProject = vi.fn((value) => { projectRef.current = value })
    updatePolicy.mockResolvedValue({ policy: previous.compatibilityPolicy, revision: 3 })

    const { result } = renderHook(() => useProjectHistory({
      projectRef,
      inventoryMetadataHistoryRef: metadataRef,
      setProject,
      setSelectedItemId: vi.fn(),
      setSelectedConnectionId: vi.fn(),
      setValidationMessage: vi.fn(),
      scheduleProjectSave,
    }))
    act(() => {
      result.current.setHistory((history) => pushHistory(
        history,
        createProjectHistorySnapshot(previous, metadataRef.current),
      ))
    })
    act(() => result.current.undoProjectChange())

    await waitFor(() => expect(updatePolicy).toHaveBeenCalledWith(1, previous.compatibilityPolicy))
    await waitFor(() => expect(result.current.historyBusy).toBe(false))
    expect(projectRef.current.compatibilityPolicy).toEqual(previous.compatibilityPolicy)
    expect(projectRef.current.revision).toBe(2)
    expect(scheduleProjectSave).not.toHaveBeenCalled()
  })
})
