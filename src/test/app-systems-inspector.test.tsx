import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DomainEngineContext } from '@/engine/react-context'
import type { DomainEngineClient } from '@/engine/client'
import { renderWithOpenAuth as render } from '@/test/open-auth-test-render'
import type { ProjectState } from '@/types/inventory'

const { loadProject, loadWorkspace, activateCanvas } = vi.hoisted(() => ({
  loadProject: vi.fn(), loadWorkspace: vi.fn(), activateCanvas: vi.fn(),
}))
vi.mock('@/lib/db', async (original) => ({ ...await original<typeof import('@/lib/db')>(), loadProject }))
vi.mock('@/lib/workbook-api', async (original) => ({ ...await original<typeof import('@/lib/workbook-api')>(), loadWorkspace }))
vi.mock('@/app/app-dialogs', () => ({ AppDialogs: () => null }))
vi.mock('@/app/app-inventory-panels', () => ({ AppInventoryPanels: () => null }))
vi.mock('@/components/workbook/systems-workspace', () => ({
  SystemsWorkspace: ({ onSelectItem }: { onSelectItem(id: string): void }) => (
    <main aria-label="Systems">
      <button onClick={() => onSelectItem('server:1')}>Select first host</button>
      <button onClick={() => onSelectItem('server:2')}>Select second host</button>
    </main>
  ),
}))
vi.mock('@/components/lazy-app-surfaces', async (original) => ({
  ...await original<typeof import('@/components/lazy-app-surfaces')>(),
  SystemsInspectorPanel: ({ open, project, selectedItemId, onClose }: {
    open: boolean; project: ProjectState; selectedItemId: string; onClose(): void
  }) => open ? <aside aria-label="Loaded inspector">
    {project.items[selectedItemId]?.name}
    <button onClick={onClose}>Close inspector</button>
  </aside> : null,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const clients: QueryClient[] = []
function mount(projectId = 1, canvasId = 2, cached = false) {
  const project: ProjectState = {
    id: `project-${projectId}`, revision: 1,
    metadata: { name: 'Synthetic lab', version: 1, updatedAt: '', projectId, workspaceId: canvasId },
    items: {
      'server:1': { id: 1, type: 'server', name: 'First host' },
      'server:2': { id: 2, type: 'server', name: 'Second host' },
    },
    assignments: [], placements: [], connections: [],
  }
  const response = deferred<ProjectState>()
  loadProject.mockReturnValue(response.promise)
  loadWorkspace.mockReturnValue(response.promise)
  window.history.replaceState(null, '', `/projects/${projectId}/workspaces/1`)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  clients.push(client)
  client.setQueryData(['project-workbooks'], [{
    project: { id: projectId, name: 'Synthetic lab', description: null, iconKey: 'house', revision: 1, includesGlobalInventory: true },
    defaultWorkspaceId: canvasId,
    workspaces: [
      { id: 1, projectId, type: 'systems', name: 'Systems', iconKey: 'rows-3', colorKey: 'gray', sortOrder: 0, revision: 1, systemKey: 'systems' },
      { id: canvasId, projectId, type: 'canvas', name: 'Canvas', iconKey: 'network', colorKey: 'blue', sortOrder: 1, revision: 1, systemKey: null },
    ],
  }])
  if (cached) client.setQueryData(projectId === 1 && canvasId === 2 ? ['project'] : ['project', projectId, canvasId], project)
  client.setQueryData(['demo-session'], { mode: 'staging' })
  client.setQueryData(['onboarding'], { enabled: false, status: 'dismissed' })
  client.setQueryData(['release-notes-status'], { currentVersion: '0.16.21', lastSeenVersion: '0.16.21', hasUnseen: false, entries: [] })
  client.setQueryData(['update-status'], { enabled: false, state: 'disabled', entries: [] })
  render(<QueryClientProvider client={client}>
    <DomainEngineContext.Provider value={{
      enabled: false, runtimeKey: null, generation: 0, session: 0,
      client: {} as DomainEngineClient, state: { phase: 'ready', revision: null }, syncEvent: null,
      activateCanvas, setRuntimeBusy: () => {}, removeCanvasRuntime: () => {},
      clearCanvasRuntimes: () => {}, getCanvasRuntimeKeys: () => [], setEnabled: () => {}, retry: async () => {},
    }}><App /></DomainEngineContext.Provider>
  </QueryClientProvider>)
  return { project, response }
}

beforeEach(() => {
  // No actual transport is allowed: even incidental status queries stay in memory.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"Isolated test"}', { status: 503, headers: { 'Content-Type': 'application/json' } })))
})
afterEach(() => {
  cleanup()
  for (const client of clients.splice(0)) client.clear()
  window.history.replaceState(null, '', '/')
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

describe('cold Systems inspector', () => {
  it('defers project loading until selection, keeps Systems visible, and reopens from cache', async () => {
    const { project, response } = mount()
    expect(await screen.findByRole('main', { name: 'Systems' })).toBeVisible()
    expect(loadProject).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Select first host'))
    await waitFor(() => expect(loadProject).toHaveBeenCalledOnce())
    expect(within(screen.getByTestId('systems-inspector-region')).getByRole('status')).toHaveTextContent('Loading inspector')
    expect(screen.getByRole('main', { name: 'Systems' })).toBeVisible()
    await act(async () => response.resolve(project))
    expect(await screen.findByRole('complementary', { name: 'Loaded inspector' })).toHaveTextContent('First host')
    fireEvent.click(screen.getByText('Close inspector'))
    fireEvent.click(screen.getByText('Select second host'))
    expect(screen.getByRole('complementary', { name: 'Loaded inspector' })).toHaveTextContent('Second host')
    expect(loadProject).toHaveBeenCalledOnce()
    expect(activateCanvas.mock.calls.every(([scope]) => scope === null)).toBe(true)
  })

  it('preserves the latest selected host during hydration', async () => {
    const { project, response } = mount()
    fireEvent.click(await screen.findByText('Select first host'))
    fireEvent.click(screen.getByText('Select second host'))
    await act(async () => response.resolve(project))
    expect(await screen.findByRole('complementary', { name: 'Loaded inspector' })).toHaveTextContent('Second host')
    expect(loadProject).toHaveBeenCalledOnce()
  })

  it('does not reopen after closing while the request is in flight', async () => {
    const { project, response } = mount()
    fireEvent.click(await screen.findByText('Select first host'))
    fireEvent.click(screen.getByRole('button', { name: 'Close inspector' }))
    await act(async () => response.resolve(project))
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(screen.getByTestId('systems-inspector-region')).toHaveAttribute('data-open', 'false')
  })

  it('keeps failures inside the drawer and retries without visiting Canvas', async () => {
    const { project } = mount()
    loadProject.mockRejectedValueOnce(new Error('Request failed')).mockResolvedValueOnce(project)
    fireEvent.click(await screen.findByText('Select first host'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Inspector could not be loaded')
    expect(screen.getByRole('main', { name: 'Systems' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('complementary', { name: 'Loaded inspector' })).toHaveTextContent('First host')
    expect(loadProject).toHaveBeenCalledTimes(2)
  })

  it('loads the correct nondefault project and canvas scope', async () => {
    const { project, response } = mount(4, 12)
    fireEvent.click(await screen.findByText('Select first host'))
    await waitFor(() => expect(loadWorkspace).toHaveBeenCalledWith(4, 12))
    await act(async () => response.resolve(project))
    expect(await screen.findByRole('complementary', { name: 'Loaded inspector' })).toHaveTextContent('First host')
    expect(loadProject).not.toHaveBeenCalled()
  })

  it('uses a previously loaded project without another request', async () => {
    mount(1, 2, true)
    fireEvent.click(await screen.findByText('Select first host'))
    expect(await screen.findByRole('complementary', { name: 'Loaded inspector' })).toHaveTextContent('First host')
    expect(loadProject).not.toHaveBeenCalled()
  })
})
