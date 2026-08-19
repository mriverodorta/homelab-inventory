import { describe, expect, it } from 'vitest'
import {
  createProjectHistorySnapshot,
  metadataHistoryChanges,
  projectHistoryContentEqual,
  setInventoryMetadataHistoryItem,
} from './project-history-snapshot'
import { createEmptyProject } from '@/lib/project'

describe('project history snapshots', () => {
  it('copies metadata inputs and identifies exact restore changes', () => {
    const ref = { type: 'server', id: 7 }
    const before = setInventoryMetadataHistoryItem(new Map(), ref, {
      values: [{ definitionId: 1, value: [2, 3] }], tagIds: [4],
    })
    const snapshot = createProjectHistorySnapshot(createEmptyProject(), before)
    const after = setInventoryMetadataHistoryItem(before, ref, {
      values: [{ definitionId: 1, value: [3] }], tagIds: [],
    })

    expect(metadataHistoryChanges(after, snapshot.inventoryMetadata)).toEqual([{
      ref,
      metadata: { values: [{ definitionId: 1, value: [2, 3] }], tagIds: [4] },
    }])
  })

  it('ignores only the canonical project revision when comparing history content', () => {
    const project = createEmptyProject()
    expect(projectHistoryContentEqual(project, { ...project, revision: (project.revision ?? 0) + 1 })).toBe(true)
    expect(projectHistoryContentEqual(project, {
      ...project,
      metadata: { ...project.metadata, name: 'Changed' },
    })).toBe(false)
  })
})
