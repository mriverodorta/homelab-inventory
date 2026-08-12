import { describe, expect, it } from 'vitest'
import { readWorkbookPreference, resolveOpeningWorkspace } from '@/lib/workspace-preference'

const workspaces = [
  { id: 1, type: 'systems' as const },
  { id: 2, type: 'canvas' as const },
  { id: 7, type: 'canvas' as const },
]

describe('workbook browser preferences', () => {
  it('uses a valid last active workspace only when enabled', () => {
    expect(resolveOpeningWorkspace({ useLastActive: true, lastActive: 7, defaultId: 2, workspaces })).toBe(7)
    expect(resolveOpeningWorkspace({ useLastActive: false, lastActive: 7, defaultId: 2, workspaces })).toBe(2)
  })

  it('falls back from a missing default to Canvas and then Systems', () => {
    expect(resolveOpeningWorkspace({ useLastActive: true, lastActive: 99, defaultId: 88, workspaces })).toBe(2)
    expect(resolveOpeningWorkspace({ useLastActive: false, defaultId: 88, workspaces: [workspaces[0]] })).toBe(1)
  })

  it('rejects malformed browser storage', () => {
    expect(readWorkbookPreference({ getItem: () => '{broken' })).toMatchObject({
      version: 1,
      useLastActiveWorkspace: false,
      lastWorkspaceByProject: {},
    })
  })
})
