import { describe, expect, it } from 'vitest'
import { createSystemsProjectScope, shouldLoadCanvasProject } from '@/app/workspace-project-loading'
import type { ProjectWorkbook } from '@/lib/workbook-api'

const workbook: ProjectWorkbook = {
  project: {
    id: 4,
    name: 'Lab rebuild',
    description: null,
    iconKey: 'house',
    revision: 9,
    includesGlobalInventory: true,
  },
  defaultWorkspaceId: 12,
  workspaces: [
    { id: 11, projectId: 4, type: 'systems', name: 'Systems', iconKey: 'rows-3', colorKey: 'gray', sortOrder: 0, revision: 1, systemKey: 'systems' },
    { id: 12, projectId: 4, type: 'canvas', name: 'Canvas', iconKey: 'network', colorKey: 'blue', sortOrder: 1, revision: 1, systemKey: null },
  ],
}

describe('workspace project loading', () => {
  it('loads the full project only for Canvas or an explicit settings flow', () => {
    expect(shouldLoadCanvasProject(false, false)).toBe(false)
    expect(shouldLoadCanvasProject(true, false)).toBe(true)
    expect(shouldLoadCanvasProject(false, true)).toBe(true)
  })

  it('creates a non-persisted empty scope for Systems rendering', () => {
    expect(createSystemsProjectScope(workbook, workbook.workspaces[0])).toEqual({
      id: 'project-4-systems',
      revision: 9,
      metadata: { name: 'Lab rebuild', version: 9, updatedAt: '', projectId: 4, workspaceId: 11 },
      items: {},
      placements: [],
      assignments: [],
      connections: [],
    })
    expect(createSystemsProjectScope(workbook, workbook.workspaces[1])).toBeNull()
  })
})
