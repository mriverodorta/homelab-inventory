import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pushHistory } from '@/lib/history'
import { createEmptyProject } from '@/lib/project'
import {
  createProjectHistorySnapshot,
  setInventoryMetadataHistoryItem,
} from './project-history-snapshot'
import { useProjectHistory } from './use-project-history'
import type { ProjectWorkbook } from '@/lib/workbook-api'

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

  it('restores workbook presentation without scheduling a project or engine save', async () => {
    const project = {
      ...createEmptyProject(),
      revision: 12,
      metadata: { ...createEmptyProject().metadata, projectId: 1, workspaceId: 2, name: 'After' },
    }
    const workbook = (name: string, revision: number): ProjectWorkbook => ({
      project: {
        id: 1,
        name,
        description: null,
        iconKey: 'house',
        revision: 12,
        workbookRevision: revision,
        includesGlobalInventory: true,
      },
      defaultWorkspaceId: 2,
      workspaces: [{
        id: 2,
        projectId: 1,
        type: 'canvas',
        name: 'Canvas',
        iconKey: 'network',
        colorKey: 'violet',
        sortOrder: 1,
        revision: 4,
        systemKey: null,
      }],
    })
    const before = workbook('Before', 3)
    const after = workbook('After', 4)
    const projectRef = { current: project }
    const metadataRef = { current: new Map() }
    const workbookRef = { current: after as ProjectWorkbook | null }
    const scheduleProjectSave = vi.fn()
    const setProject = vi.fn((value) => { projectRef.current = value })
    const restoreWorkbookHistory = vi.fn(async () => workbook('Before', 5))

    const { result } = renderHook(() => useProjectHistory({
      projectRef,
      inventoryMetadataHistoryRef: metadataRef,
      workbookHistoryRef: workbookRef,
      setProject,
      setSelectedItemId: vi.fn(),
      setSelectedConnectionId: vi.fn(),
      setValidationMessage: vi.fn(),
      scheduleProjectSave,
      restoreWorkbookHistory,
    }))
    act(() => {
      result.current.setHistory((history) => pushHistory(
        history,
        createProjectHistorySnapshot({
          ...project,
          metadata: { ...project.metadata, name: 'Before' },
        }, metadataRef.current, before),
      ))
    })
    act(() => result.current.undoProjectChange())

    await waitFor(() => expect(restoreWorkbookHistory).toHaveBeenCalledWith(before))
    await waitFor(() => expect(result.current.historyBusy).toBe(false))
    expect(workbookRef.current?.project.name).toBe('Before')
    expect(projectRef.current.metadata.name).toBe('Before')
    expect(projectRef.current.revision).toBe(12)
    expect(scheduleProjectSave).not.toHaveBeenCalled()
  })

  it('restores placement history through the scoped engine mutation path', async () => {
    const previous = {
      ...createEmptyProject(),
      revision: 6,
      placements: [{ serverId: 'server:1', x: 24, y: 24 }],
    }
    const current = {
      ...previous,
      revision: 7,
      placements: [{ serverId: 'server:1', x: 48, y: 48 }],
    }
    const projectRef = { current }
    const metadataRef = { current: new Map() }
    const scheduleProjectSave = vi.fn()
    const restorePlacementHistory = vi.fn(async (target) => ({
      ...target,
      revision: 8,
    }))

    const { result } = renderHook(() => useProjectHistory({
      projectRef,
      inventoryMetadataHistoryRef: metadataRef,
      setProject: vi.fn((value) => { projectRef.current = value }),
      setSelectedItemId: vi.fn(),
      setSelectedConnectionId: vi.fn(),
      setValidationMessage: vi.fn(),
      scheduleProjectSave,
      restorePlacementHistory,
    }))
    act(() => {
      result.current.setHistory((history) => pushHistory(
        history,
        createProjectHistorySnapshot(previous, metadataRef.current),
      ))
    })
    act(() => result.current.undoProjectChange())

    await waitFor(() => expect(restorePlacementHistory).toHaveBeenCalledWith(previous))
    await waitFor(() => expect(result.current.historyBusy).toBe(false))
    expect(scheduleProjectSave).not.toHaveBeenCalled()
    expect(projectRef.current.revision).toBe(8)
    expect(projectRef.current.placements).toEqual(previous.placements)
  })
})
