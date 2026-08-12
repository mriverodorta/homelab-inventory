import { describe, expect, it } from 'vitest'
import { projectQueryKey } from '@/lib/project-query-key'
import type { ProjectState } from '@/types/inventory'

function project(projectId?: number, workspaceId?: number) {
  return {
    id: projectId ? String(projectId) : 'default',
    metadata: { name: 'Project', version: 1, updatedAt: '2026-08-11T00:00:00.000Z', projectId, workspaceId },
    items: {}, placements: [], assignments: [], connections: [],
  } satisfies ProjectState
}

describe('project query keys', () => {
  it('keeps the default compatibility cache key', () => {
    expect(projectQueryKey(project())).toEqual(['project'])
    expect(projectQueryKey(project(1, 2))).toEqual(['project'])
  })

  it('isolates non-default project workspaces', () => {
    expect(projectQueryKey(project(2, 7))).toEqual(['project', 2, 7])
    expect(projectQueryKey(project(1, 9))).toEqual(['project', 1, 9])
  })
})
