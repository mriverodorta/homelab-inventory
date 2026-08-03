import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { renderWithOpenAuth as render } from '@/test/open-auth-test-render'
import type { InventoryItem, InventoryProperties, ProjectState } from '@/types/inventory'
import type { OnboardingStatus } from '@/lib/onboarding-api'

const {
  fitAllMock,
  loadOnboardingExampleMock,
  saveProjectMock,
  updateInventoryItemMock,
  updateInventoryItemPropertiesMock,
} = vi.hoisted(() => ({
  fitAllMock: vi.fn(),
  loadOnboardingExampleMock: vi.fn(),
  saveProjectMock: vi.fn(),
  updateInventoryItemMock: vi.fn(),
  updateInventoryItemPropertiesMock: vi.fn(),
}))

vi.mock('@/lib/onboarding-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/onboarding-api')>(),
  loadOnboardingExample: loadOnboardingExampleMock,
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
  updateInventoryItem: updateInventoryItemMock,
  updateInventoryItemProperties: updateInventoryItemPropertiesMock,
}))

vi.mock('@/components/desktop-inventory-shell', () => ({
  DesktopInventoryShell: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('@/components/lazy-dnd-workspace', () => ({
  DndWorkspace: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('@/components/lazy-inventory-sidebar', () => ({
  InventorySidebar: () => null,
}))

vi.mock('@/components/lazy-mobile-inventory-sheet', () => ({
  MobileInventorySheet: () => null,
}))

vi.mock('@/components/lazy-workbench-canvas', () => ({
  WorkbenchCanvas: ({
      canUndo,
      canRedo,
      onUndo,
      onRedo,
      onViewportReady,
    }: {
      canUndo: boolean
      canRedo: boolean
      onUndo: () => void
      onRedo: () => void
      onViewportReady: (controller: {
        screenToFlowPosition: (point: { x: number; y: number }) => { x: number; y: number }
        getViewportZoom: () => number
        focusItem: () => void
        fitAll: () => void
      }) => void
    }) => (
      (() => {
        onViewportReady({
          screenToFlowPosition: (point) => point,
          getViewportZoom: () => 1,
          focusItem: () => {},
          fitAll: fitAllMock,
        })
        return (
          <div>
            <button type="button" disabled={!canUndo} onClick={onUndo}>Undo</button>
            <button type="button" disabled={!canRedo} onClick={onRedo}>Redo</button>
          </div>
        )
      })()
    ),
}))

vi.mock('@/components/lazy-app-surfaces', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/components/lazy-app-surfaces')>(),
  InspectorPanel: ({
    project,
    persistenceWarning,
    onUpdateProject,
    onUpdateItem,
    onUpdateItemProperties,
  }: {
    project: ProjectState
    persistenceWarning: string | null
    onUpdateProject: (project: ProjectState) => void
    onUpdateItem: (itemId: string, input: Omit<InventoryItem, 'id' | 'key'>) => Promise<void>
    onUpdateItemProperties: (itemId: string, properties: InventoryProperties) => Promise<void>
  }) => (
    <div>
      <div data-testid="item-name">{project.items['server:1']?.name}</div>
      <div data-testid="disabled-hosts">
        {project.compatibilityPolicy?.disabledHosts.map((host) => `${host.hostType}:${host.hostId}`).join(',') || 'enabled'}
      </div>
      <button
        type="button"
        onClick={() => onUpdateProject({
          ...project,
          compatibilityPolicy: {
            disabledHosts: [{ hostType: 'server', hostId: 1 }],
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
            disabledHosts: [],
            ignoredWarningIds: [],
          },
        })}
      >
        Enable compatibility
      </button>
      <button
        type="button"
        onClick={() => void onUpdateItem('server:1', {
          name: 'Updated server',
          type: 'server',
        })}
      >
        Update inventory item
      </button>
      <button
        type="button"
        onClick={() => void onUpdateItemProperties('server:1', {
          canvasOrientation: 'vertical',
        })}
      >
        Update inventory properties
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
    'server:1': {
      id: 1,
      key: 'server:1',
      name: 'Test server',
      type: 'server',
    },
  },
  placements: [],
  assignments: [],
  connections: [],
  compatibilityPolicy: {
    disabledHosts: [],
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

function renderApp(
  projectData: ProjectState = persistedProject,
  onboarding: OnboardingStatus = { enabled: true, status: 'dismissed' } as OnboardingStatus,
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  })
  queryClient.setQueryData(['project'], projectData)
  queryClient.setQueryData(['agent-status'], { servers: {}, registeredServerIds: [] })
  queryClient.setQueryData(['demo-session'], { mode: 'production' })
  queryClient.setQueryData(['onboarding'], onboarding)
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
  it('offers onboarding only for a fresh empty workspace', async () => {
    const emptyProject: ProjectState = {
      ...persistedProject,
      items: {}, placements: [], assignments: [], connections: [],
    }
    renderApp(emptyProject, {
      enabled: true,
      version: 1,
      status: 'available',
      sampleBatchId: null,
      sampleInventoryRefs: [],
      sampleAssignmentIds: [],
      sampleConnectionIds: [],
      walkthroughStep: 0,
      startedAt: null,
      completedAt: null,
      eligibleForExample: true,
      shouldInvite: true,
      milestones: { created: false, placed: false, related: false, completed: false },
      projectRevision: 1,
    })

    expect(await screen.findByRole('heading', { name: /See a working homelab/i })).toBeInTheDocument()
  })

  it('fits the example workspace once after its project snapshot is applied', async () => {
    const emptyProject: ProjectState = {
      ...persistedProject,
      items: {}, placements: [], assignments: [], connections: [],
    }
    const availableStatus = {
      enabled: true,
      version: 1,
      status: 'available',
      sampleBatchId: null,
      sampleInventoryRefs: [],
      sampleAssignmentIds: [],
      sampleConnectionIds: [],
      walkthroughStep: 0,
      startedAt: null,
      completedAt: null,
      eligibleForExample: true,
      shouldInvite: true,
      milestones: { created: false, placed: false, related: false, completed: false },
      projectRevision: 1,
    } satisfies Extract<OnboardingStatus, { enabled: true }>
    loadOnboardingExampleMock.mockResolvedValueOnce({
      project: { ...emptyProject, revision: 2 },
      status: {
        ...availableStatus,
        status: 'sample_active',
        sampleBatchId: 1,
        shouldInvite: false,
        eligibleForExample: false,
        projectRevision: 2,
      },
    })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    renderApp(emptyProject, availableStatus)

    fireEvent.click(await screen.findByRole('button', { name: 'Explore example' }))

    await vi.waitFor(() => expect(fitAllMock).toHaveBeenCalledOnce())
  })

  it('records persisted inventory item updates in Undo and Redo history', async () => {
    const updatedProject: ProjectState = {
      ...persistedProject,
      items: {
        ...persistedProject.items,
        'server:1': {
          ...persistedProject.items['server:1'],
          name: 'Updated server',
        },
      },
    }
    updateInventoryItemMock.mockResolvedValueOnce(updatedProject)
    saveProjectMock.mockImplementation(async (project: ProjectState) => project)
    renderApp()

    expect(await screen.findByTestId('item-name')).toHaveTextContent('Test server')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Update inventory item' }))

    expect(await screen.findByTestId('item-name')).toHaveTextContent('Updated server')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByTestId('item-name')).toHaveTextContent('Test server')
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(saveProjectMock.mock.calls[0]?.[0].items['server:1']?.name).toBe('Test server')

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(screen.getByTestId('item-name')).toHaveTextContent('Updated server')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(saveProjectMock.mock.calls[1]?.[0].items['server:1']?.name).toBe('Updated server')
  })

  it('rebases Undo and Redo snapshots onto the current canonical revision', async () => {
    const initialProject = { ...persistedProject, revision: 7 }
    const updatedProject: ProjectState = {
      ...initialProject,
      revision: 8,
      items: {
        ...initialProject.items,
        'server:1': {
          ...initialProject.items['server:1'],
          name: 'Updated server',
        },
      },
    }
    updateInventoryItemMock.mockResolvedValueOnce(updatedProject)
    saveProjectMock
      .mockImplementationOnce(async (project: ProjectState) => ({
        ...project,
        revision: (project.revision ?? 0) + 1,
      }))
      .mockImplementationOnce(async (project: ProjectState) => ({
        ...project,
        revision: (project.revision ?? 0) + 1,
      }))
    renderApp(initialProject)

    fireEvent.click(await screen.findByRole('button', { name: 'Update inventory item' }))
    expect(await screen.findByTestId('item-name')).toHaveTextContent('Updated server')

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(saveProjectMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      revision: 8,
      items: expect.objectContaining({
        'server:1': expect.objectContaining({ name: 'Test server' }),
      }),
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(saveProjectMock.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      revision: 9,
      items: expect.objectContaining({
        'server:1': expect.objectContaining({ name: 'Updated server' }),
      }),
    }))
  })

  it('records property-only inventory updates in Undo history', async () => {
    const updatedProject: ProjectState = {
      ...persistedProject,
      items: {
        ...persistedProject.items,
        'server:1': {
          ...persistedProject.items['server:1'],
          properties: { canvasOrientation: 'vertical' },
        },
      },
    }
    updateInventoryItemPropertiesMock.mockResolvedValueOnce(updatedProject)
    renderApp()

    expect(await screen.findByTestId('item-name')).toHaveTextContent('Test server')
    fireEvent.click(screen.getByRole('button', { name: 'Update inventory properties' }))

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(updateInventoryItemPropertiesMock).toHaveBeenCalledWith(
      { type: 'server', id: 1 },
      { canvasOrientation: 'vertical' },
    )
    expect(updateInventoryItemMock).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()
  })

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
      compatibilityPolicy: expect.objectContaining({ disabledHosts: [{ hostType: 'server', hostId: 1 }] }),
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
      compatibilityPolicy: expect.objectContaining({ disabledHosts: [] }),
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
