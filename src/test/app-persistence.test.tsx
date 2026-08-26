import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { DomainEngineClient } from '@/engine/client'
import { DomainEngineContext } from '@/engine/react-context'
import { renderWithOpenAuth as render } from '@/test/open-auth-test-render'
import type { InventoryItem, InventoryProperties, ProjectState } from '@/types/inventory'
import type { OnboardingStatus } from '@/lib/onboarding-api'
import type { MutationEffects } from '@/types/domain-mutation'

function mutationResult(project: ProjectState, effects: MutationEffects = {
  topology: false,
  geometry: null,
  compatibility: null,
  presentation: null,
}) {
  return { data: project, revisions: { inventoryItem: 2 }, effects }
}

const {
  fitAllMock,
  loadOnboardingExampleMock,
  saveProjectMock,
  updateInventoryItemMock,
  updateInventoryItemPropertiesMock,
  updateCompatibilityPolicyMock,
  loadWorkspaceMock,
  saveWorkspaceMock,
} = vi.hoisted(() => ({
  fitAllMock: vi.fn(),
  loadOnboardingExampleMock: vi.fn(),
  saveProjectMock: vi.fn(),
  updateInventoryItemMock: vi.fn(),
  updateInventoryItemPropertiesMock: vi.fn(),
  updateCompatibilityPolicyMock: vi.fn(),
  loadWorkspaceMock: vi.fn(),
  saveWorkspaceMock: vi.fn(),
}))

vi.mock('@/lib/compatibility-audit-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/compatibility-audit-api')>(),
  updateCompatibilityPolicy: updateCompatibilityPolicyMock,
}))

vi.mock('@/lib/onboarding-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/onboarding-api')>(),
  loadOnboardingExample: loadOnboardingExampleMock,
}))

vi.mock('@/lib/workbook-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/workbook-api')>(),
  loadWorkspace: loadWorkspaceMock,
  saveWorkspace: saveWorkspaceMock,
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
    onCopyHostConfiguration,
    onUpdateItem,
    onUpdateItemProperties,
  }: {
    project: ProjectState
    persistenceWarning: string | null
    onUpdateProject: (project: ProjectState) => void
    onCopyHostConfiguration: (previous: ProjectState, project: ProjectState) => Promise<void>
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
        onClick={() => {
          const destination = {
            ...project,
            metadata: { ...project.metadata, projectId: 1, workspaceId: 3 },
            placements: [],
          }
          void onCopyHostConfiguration(destination, {
            ...destination,
            placements: [{ serverId: 'server:1', x: 24, y: 36 }],
          })
        }}
      >
        Copy to another canvas
      </button>
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
      <DomainEngineContext.Provider value={{
        enabled: false,
        runtimeKey: null,
        generation: 0,
        session: 0,
        client: {} as DomainEngineClient,
        state: { phase: 'ready', revision: null },
        syncEvent: null,
        activateCanvas: () => {},
        setRuntimeBusy: () => {},
        removeCanvasRuntime: () => {},
        clearCanvasRuntimes: () => {},
        getCanvasRuntimeKeys: () => [],
        setEnabled: () => {},
        retry: async () => {},
      }}>
        <App />
      </DomainEngineContext.Provider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('App project persistence', () => {
  it('copies into another canvas and restores only that canvas during Undo and Redo', async () => {
    const source: ProjectState = {
      ...persistedProject,
      revision: 6,
      metadata: { ...persistedProject.metadata, projectId: 1, workspaceId: 2 },
      placements: [{ serverId: 'server:1', x: 24, y: 36 }],
    }
    const emptyDestination: ProjectState = {
      ...source,
      metadata: { ...source.metadata, workspaceId: 3 },
      placements: [],
    }
    const copiedDestination: ProjectState = {
      ...emptyDestination,
      revision: 7,
      placements: [{ serverId: 'server:1', x: 24, y: 36 }],
    }
    loadWorkspaceMock
      .mockResolvedValueOnce(emptyDestination)
      .mockResolvedValueOnce({ ...source, revision: 7 })
      .mockResolvedValueOnce(copiedDestination)
      .mockResolvedValueOnce({ ...source, revision: 8 })
      .mockResolvedValueOnce({ ...emptyDestination, revision: 8 })
      .mockResolvedValueOnce({ ...source, revision: 9 })
    saveWorkspaceMock
      .mockResolvedValueOnce(copiedDestination)
      .mockResolvedValueOnce({ ...emptyDestination, revision: 8 })
      .mockResolvedValueOnce({ ...copiedDestination, revision: 9 })
    renderApp(source)

    fireEvent.click(await screen.findByRole('button', { name: 'Copy to another canvas' }))

    await vi.waitFor(() => expect(saveWorkspaceMock).toHaveBeenCalledWith(1, 3, expect.objectContaining({
      metadata: expect.objectContaining({ projectId: 1, workspaceId: 3 }),
      placements: [{ serverId: 'server:1', x: 24, y: 36 }],
    })))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled())
    expect(saveProjectMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await vi.waitFor(() => expect(saveWorkspaceMock).toHaveBeenCalledTimes(2))
    expect(saveWorkspaceMock).toHaveBeenLastCalledWith(1, 3, expect.objectContaining({ placements: [] }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled())

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    await vi.waitFor(() => expect(saveWorkspaceMock).toHaveBeenCalledTimes(3))
    expect(saveWorkspaceMock).toHaveBeenLastCalledWith(1, 3, expect.objectContaining({
      placements: [{ serverId: 'server:1', x: 24, y: 36 }],
    }))
    expect(saveProjectMock).not.toHaveBeenCalled()
  })

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
    updateInventoryItemMock
      .mockResolvedValueOnce(mutationResult(updatedProject))
      .mockResolvedValueOnce(mutationResult(persistedProject))
      .mockResolvedValueOnce(mutationResult(updatedProject))
    renderApp()

    expect(await screen.findByTestId('item-name')).toHaveTextContent('Test server')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Update inventory item' }))

    expect(await screen.findByTestId('item-name')).toHaveTextContent('Updated server')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByTestId('item-name')).toHaveTextContent('Test server')
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(await screen.findByTestId('item-name')).toHaveTextContent('Updated server')
    expect(updateInventoryItemMock).toHaveBeenCalledTimes(3)
    expect(saveProjectMock).not.toHaveBeenCalled()
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
    updateInventoryItemMock
      .mockResolvedValueOnce(mutationResult(updatedProject))
      .mockResolvedValueOnce(mutationResult({ ...initialProject, revision: 8 }))
      .mockResolvedValueOnce(mutationResult(updatedProject))
    renderApp(initialProject)

    fireEvent.click(await screen.findByRole('button', { name: 'Update inventory item' }))
    expect(await screen.findByTestId('item-name')).toHaveTextContent('Updated server')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByTestId('item-name')).toHaveTextContent('Test server')
    expect(updateInventoryItemMock).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(await screen.findByTestId('item-name')).toHaveTextContent('Updated server')
    expect(updateInventoryItemMock).toHaveBeenCalledTimes(3)
    expect(saveProjectMock).not.toHaveBeenCalled()
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
    const geometryEffects: MutationEffects = {
      topology: false,
      geometry: {
        projectIds: [1],
        workspaceIds: [2],
        itemRefs: [{ type: 'server', id: 1 }],
        connectionIds: [],
      },
      compatibility: null,
      presentation: { projectIds: [1], itemRefs: [{ type: 'server', id: 1 }] },
    }
    updateInventoryItemPropertiesMock
      .mockResolvedValueOnce(mutationResult(updatedProject, geometryEffects))
      .mockResolvedValueOnce(mutationResult(persistedProject, geometryEffects))
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
      { projectId: 1, workspaceId: 2 },
    )
    expect(updateInventoryItemMock).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await vi.waitFor(() => expect(updateInventoryItemPropertiesMock).toHaveBeenCalledTimes(2))
    expect(saveProjectMock).not.toHaveBeenCalled()
  })

  it('rolls a rejected compatibility save back to the last confirmed policy', async () => {
    updateCompatibilityPolicyMock.mockRejectedValueOnce(new Error('Policy save rejected.'))
    renderApp()

    expect(await screen.findByTestId('disabled-hosts')).toHaveTextContent('enabled')

    fireEvent.click(screen.getByRole('button', { name: 'Disable compatibility' }))
    expect(screen.getByTestId('disabled-hosts')).toHaveTextContent('server')

    await vi.waitFor(() => expect(updateCompatibilityPolicyMock).toHaveBeenCalledOnce())
    expect(updateCompatibilityPolicyMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      disabledHosts: [{ hostType: 'server', hostId: 1 }],
    }))
    await vi.waitFor(() => expect(screen.getByTestId('disabled-hosts')).toHaveTextContent('enabled'))
    expect(screen.getByRole('alert')).toHaveTextContent('Policy save rejected.')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByTestId('disabled-hosts')).toHaveTextContent('enabled')
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(screen.getByTestId('disabled-hosts')).toHaveTextContent('enabled')

    expect(updateCompatibilityPolicyMock).toHaveBeenCalledTimes(1)
    expect(saveProjectMock).not.toHaveBeenCalled()
  })

  it('serializes compatibility save A before queued save B and rolls back B alone', async () => {
    const saveA = createDeferred<{ policy: ProjectState['compatibilityPolicy']; revision: number }>()
    updateCompatibilityPolicyMock
      .mockReturnValueOnce(saveA.promise)
      .mockRejectedValueOnce(new Error('Save B rejected.'))
    renderApp()

    expect(await screen.findByTestId('disabled-hosts')).toHaveTextContent('enabled')

    fireEvent.click(screen.getByRole('button', { name: 'Disable compatibility' }))
    await vi.waitFor(() => expect(updateCompatibilityPolicyMock).toHaveBeenCalledTimes(1))
    const policyA = updateCompatibilityPolicyMock.mock.calls[0]?.[1] as ProjectState['compatibilityPolicy']

    fireEvent.click(screen.getByRole('button', { name: 'Enable compatibility' }))

    expect(updateCompatibilityPolicyMock).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('disabled-hosts')).toHaveTextContent('enabled')

    await act(async () => {
      saveA.resolve({ policy: policyA, revision: 2 })
      await Promise.resolve()
      await Promise.resolve()
    })

    await vi.waitFor(() => expect(updateCompatibilityPolicyMock).toHaveBeenCalledTimes(2))
    expect(updateCompatibilityPolicyMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      disabledHosts: [],
    }))
    await vi.waitFor(() => expect(screen.getByTestId('disabled-hosts')).toHaveTextContent('server'))
    expect(screen.getByRole('alert')).toHaveTextContent('Save B rejected.')
    expect(saveProjectMock).not.toHaveBeenCalled()
  })

  it('does not suppress the next edit after consecutive save failures', async () => {
    updateCompatibilityPolicyMock
      .mockRejectedValueOnce(new Error('First save rejected.'))
      .mockRejectedValueOnce(new Error('Second save rejected.'))
      .mockImplementationOnce(async (_projectId: number, policy: ProjectState['compatibilityPolicy']) => ({
        policy,
        revision: 2,
      }))
    renderApp()

    expect(await screen.findByTestId('disabled-hosts')).toHaveTextContent('enabled')

    for (const expectedCallCount of [1, 2]) {
      fireEvent.click(screen.getByRole('button', { name: 'Disable compatibility' }))
      expect(screen.getByTestId('disabled-hosts')).toHaveTextContent('server')

      await vi.waitFor(() => expect(updateCompatibilityPolicyMock).toHaveBeenCalledTimes(expectedCallCount))
      await vi.waitFor(() => expect(screen.getByTestId('disabled-hosts')).toHaveTextContent('enabled'))
    }

    expect(screen.getByRole('alert')).toHaveTextContent('Second save rejected.')

    fireEvent.click(screen.getByRole('button', { name: 'Disable compatibility' }))

    await vi.waitFor(() => expect(updateCompatibilityPolicyMock).toHaveBeenCalledTimes(3))
    await vi.waitFor(() => expect(screen.getByTestId('disabled-hosts')).toHaveTextContent('server'))
    await vi.waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(saveProjectMock).not.toHaveBeenCalled()
  })
})
