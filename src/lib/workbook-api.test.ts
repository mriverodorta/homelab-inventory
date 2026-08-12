import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProject, loadProjectWorkbook, saveWorkspace } from '@/lib/workbook-api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('workbook API', () => {
  it('uses numeric scoped project and workspace endpoints', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => (
      new Response(JSON.stringify({ project: { id: 2 } }), { status: 200 })
    ))
    vi.stubGlobal('fetch', fetchMock)
    await loadProjectWorkbook(2)
    await createProject({ name: 'Downsize plan' })
    await saveWorkspace(2, 7, { id: '2', metadata: { name: 'Plan', version: 1, updatedAt: '' }, items: {}, placements: [], assignments: [], connections: [] })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/projects/2/workbook',
      '/api/projects',
      '/api/projects/2/workspaces/7',
    ])
  })
})
