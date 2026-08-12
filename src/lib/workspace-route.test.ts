import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  navigateWorkspace,
  parseWorkspaceRoute,
  resolveWorkspaceRoute,
  subscribeWorkspaceRoute,
} from '@/lib/workspace-route'

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('workspace route state', () => {
  it('parses only positive numeric project and workspace IDs', () => {
    expect(parseWorkspaceRoute('/projects/2/workspaces/7')).toEqual({ projectId: 2, workspaceId: 7 })
    expect(parseWorkspaceRoute('/projects/no/workspaces/7')).toBeNull()
    expect(parseWorkspaceRoute('/projects/2/workspaces/0')).toBeNull()
    expect(parseWorkspaceRoute('/projects/2/workspaces/7/extra')).toBeNull()
  })

  it('publishes navigation and browser history changes', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeWorkspaceRoute(listener)
    navigateWorkspace({ projectId: 2, workspaceId: 7 })
    expect(window.location.pathname).toBe('/projects/2/workspaces/7')
    expect(listener).toHaveBeenLastCalledWith({ projectId: 2, workspaceId: 7 })
    unsubscribe()
  })

  it('falls back to the configured default, then Canvas, then Systems', () => {
    const workbooks = [{
      project: { id: 1 },
      defaultWorkspaceId: 99,
      workspaces: [{ id: 1, type: 'systems' }, { id: 2, type: 'canvas' }],
    }]
    expect(resolveWorkspaceRoute({ projectId: 4, workspaceId: 8 }, workbooks)).toEqual({
      projectId: 1,
      workspaceId: 2,
    })
  })
})
