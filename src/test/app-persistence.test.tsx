import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { ProjectState } from '@/types/inventory'

const { saveProjectMock } = vi.hoisted(() => ({
  saveProjectMock: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  archiveInventoryItems: vi.fn(),
  createInventoryItems: vi.fn(),
  deleteInventoryItems: vi.fn(),
  duplicateInventoryItem: vi.fn(),
  loadInventoryDependencyReports: vi.fn(),
  loadProject: vi.fn(),
  restoreInventoryItems: vi.fn(),
  saveProject: saveProjectMock,
  updateInventoryItem: vi.fn(),
}))

vi.mock('@/components/desktop-inventory-shell', () => ({
  DesktopInventoryShell: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('@/components/inventory-sidebar', () => ({
  InventorySidebar: () => null,
}))

vi.mock('@/components/workbench-canvas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/workbench-canvas')>()

  return {
    ...actual,
    WorkbenchCanvas: ({
      canUndo,
      canRedo,
      onUndo,
      onRedo,
    }: {
      canUndo: boolean
      canRedo: boolean
      onUndo: () => void
      onRedo: () => void
    }) => (
      <div>
        <button type="button" disabled={!canUndo} onClick={onUndo}>Undo</button>
        <button type="button" disabled={!canRedo} onClick={onRedo}>Redo</button>
      </div>
    ),
  }
})

vi.mock('@/components/inspector-panel', () => ({
  InspectorPanel: ({
    project,
    persistenceWarning,
    onUpdateProject,
  }: {
    project: ProjectState
    persistenceWarning: string | null
    onUpdateProject: (project: ProjectState) => void
  }) => (
    <div>
      <div data-testid="disabled-hosts">
        {project.compatibilityPolicy?.disabledHostIds.join(',') || 'enabled'}
      </div>
      <button
        type="button"
        onClick={() => onUpdateProject({
          ...project,
          compatibilityPolicy: {
            disabledHostIds: ['server'],
            ignoredWarningIds: [],
          },
        })}
      >
        Disable compatibility
      </button>
      <button
        type="button"
        onClick={() => onUpdateProject({
          ...project,
          compatibilityPolicy: {
            disabledHostIds: [],
            ignoredWarningIds: [],
          },
        })}
      >
        Enable compatibility
      </button>
      {persistenceWarning ? <div role="alert">{persistenceWarning}</div> : null}
    </div>
  ),
}))

vi.mock('@/components/audit-drawer', () => ({ AuditDrawer: () => null }))
vi.mock('@/components/demo-session-dialog', () => ({ DemoSessionDialog: () => null }))
vi.mock('@/components/global-item-search', () => ({ GlobalItemSearch: () => null }))
vi.mock('@/components/inventory-lifecycle-dialog', () => ({ InventoryLifecycleDialog: () => null }))
vi.mock('@/components/update-dialog', () => ({ UpdateDialog: () => null }))
vi.mock('@/components/whats-new-dialog', () => ({ WhatsNewDialog: () => null }))

const persistedProject: ProjectState = {
  id: 'default-project',
  metadata: {
    name: 'Persistence test',
    version: 1,
    updatedAt: '2026-07-19T00:00:00.000Z',
  },
  items: {
    server: {
      id: 'server',
      name: 'Test server',
      type: 'server',
    },
  },
  placements: [],
  assignments: [],
  connections: [],
  compatibilityPolicy: {
    disabledHostIds: [],
    ignoredWarningIds: [],
  },
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, reject, resolve }
}

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  })
  queryClient.setQueryData(['project'], persistedProject)
  queryClient.setQueryData(['agent-status'], { servers: {}, registeredServerIds: [] })
  queryClient.setQueryData(['demo-session'], { mode: 'production' })
  queryClient.setQueryData(['release-notes-status'], {
    currentVersion: '0.1.26',
    lastSeenVersion: '0.1.26',
    hasUnseen: false,
    entries: [],
  })
  queryClient.setQueryData(['update-status'], {
    enabled: false,
    channel: 'stable',
    runningVersion: '0.1.26',
    runningRevision: 'test',
    availableVersion: null,
    availableRevision: null,
    updateAvailable: false,
    skipped: false,
    checkedAt: null,
    state: 'disabled',
    errorCode: null,
    entries: [],
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('App project persistence', () => {
  it('rolls a rejected debounced save back to the last confirmed project', async () => {
    saveProjectMock.mockRejectedValueOnce(new Error('Project save rejected.'))
    renderApp()

    expect(await screen.findByTestId('disabled-hosts')).toHaveTextContent('enabled')

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Disable compatibility' }))
    expect(screen.getByTestId('disabled-hosts')).toHaveTextContent('server')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(saveProjectMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      compatibilityPolicy: expect.objectContaining({ disabledHostIds: ['server'] }),
    }))
    expect(screen.getByTestId('disabled-hosts')).toHaveTextContent('enabled')
    expect(screen.getByRole('alert')).toHaveTextContent('Project save rejected.')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByTestId('disabled-hosts')).toHaveTextContent('enabled')
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(screen.getByTestId('disabled-hosts')).toHaveTextContent('enabled')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(saveProjectMock).toHaveBeenCalledTimes(1)
  })

  it('waits for save A before running a queued save B that fails', async () => {
    const saveA = createDeferred<ProjectState>()
    saveProjectMock
      .mockReturnValueOnce(saveA.promise)
      .mockRejectedValueOnce(new Error('Save B rejected.'))
    renderApp()

    expect(await screen.findByTestId('disabled-hosts')).toHaveTextContent('enabled')

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Disable compatibility' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    const projectA = saveProjectMock.mock.calls[0]?.[0] as ProjectState

    fireEvent.click(screen.getByRole('button', { name: 'Enable compatibility' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(saveProjectMock).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('disabled-hosts')).toHaveTextContent('enabled')

    await act(async () => {
      saveA.resolve(projectA)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(saveProjectMock).toHaveBeenCalledTimes(2)
    expect(saveProjectMock.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      compatibilityPolicy: expect.objectContaining({ disabledHostIds: [] }),
    }))
    expect(screen.getByTestId('disabled-hosts')).toHaveTextContent('server')
    expect(screen.getByRole('alert')).toHaveTextContent('Save B rejected.')
  })

  it('does not suppress the next edit after consecutive save failures', async () => {
    saveProjectMock
      .mockRejectedValueOnce(new Error('First save rejected.'))
      .mockRejectedValueOnce(new Error('Second save rejected.'))
      .mockImplementationOnce(async (project: ProjectState) => project)
    renderApp()

    expect(await screen.findByTestId('disabled-hosts')).toHaveTextContent('enabled')

    vi.useFakeTimers()
    for (const expectedCallCount of [1, 2]) {
      fireEvent.click(screen.getByRole('button', { name: 'Disable compatibility' }))
      expect(screen.getByTestId('disabled-hosts')).toHaveTextContent('server')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      expect(saveProjectMock).toHaveBeenCalledTimes(expectedCallCount)
      expect(screen.getByTestId('disabled-hosts')).toHaveTextContent('enabled')
    }

    expect(screen.getByRole('alert')).toHaveTextContent('Second save rejected.')

    fireEvent.click(screen.getByRole('button', { name: 'Disable compatibility' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(saveProjectMock).toHaveBeenCalledTimes(3)
    expect(screen.getByTestId('disabled-hosts')).toHaveTextContent('server')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
