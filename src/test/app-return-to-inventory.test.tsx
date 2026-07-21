import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { ProjectState } from '@/types/inventory'

const { saveProjectMock } = vi.hoisted(() => ({
  saveProjectMock: vi.fn(async (project: ProjectState) => project),
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
      project,
      selectedItemId,
      canUndo,
      canRedo,
      onSelect,
      onUndo,
      onRedo,
    }: {
      project: ProjectState
      selectedItemId: string | null
      canUndo: boolean
      canRedo: boolean
      onSelect: (itemId: string) => void
      onUndo: () => void
      onRedo: () => void
    }) => (
      <div>
        <div data-testid="placements">
          {project.placements.map((placement) => placement.serverId).join(',') || 'none'}
        </div>
        <div data-testid="assignments">{project.assignments.length}</div>
        <div data-testid="connections">{project.connections.length}</div>
        <div data-testid="inventory-records">{Object.keys(project.items).length}</div>
        <div data-testid="canvas-selection">{selectedItemId ?? 'none'}</div>
        <button type="button" onClick={() => onSelect('server:1')}>Select host</button>
        <button type="button" disabled={!canUndo} onClick={onUndo}>Undo</button>
        <button type="button" disabled={!canRedo} onClick={onRedo}>Redo</button>
      </div>
    ),
  }
})

vi.mock('@/components/inspector-panel', () => ({
  InspectorPanel: ({
    open,
    selectedItemId,
    onReturnItemToInventory,
  }: {
    open: boolean
    selectedItemId: string | null
    onReturnItemToInventory: (itemId: string) => void
  }) => open && selectedItemId ? (
    <div data-testid="inspector-selection">
      {selectedItemId}
      <button type="button" onClick={() => onReturnItemToInventory(selectedItemId)}>
        Request return
      </button>
    </div>
  ) : null,
}))

vi.mock('@/components/audit-drawer', () => ({ AuditDrawer: () => null }))
vi.mock('@/components/demo-session-dialog', () => ({ DemoSessionDialog: () => null }))
vi.mock('@/components/global-item-search', () => ({ GlobalItemSearch: () => null }))
vi.mock('@/components/inventory-lifecycle-dialog', () => ({ InventoryLifecycleDialog: () => null }))
vi.mock('@/components/settings-dialog', () => ({ SettingsDialog: () => null }))
vi.mock('@/components/update-dialog', () => ({ UpdateDialog: () => null }))
vi.mock('@/components/whats-new-dialog', () => ({ WhatsNewDialog: () => null }))

const project: ProjectState = {
  id: 'default',
  metadata: {
    name: 'Return test',
    version: 1,
    updatedAt: '2026-07-20T12:00:00.000Z',
  },
  items: {
    'server:1': { id: 1, key: 'server:1', type: 'server', name: 'Host server' },
    'network:1': { id: 1, key: 'network:1', type: 'network', name: 'Hosted NIC' },
    'gpu:1': { id: 1, key: 'gpu:1', type: 'gpu', name: 'Hosted GPU' },
    'switch:1': { id: 1, key: 'switch:1', type: 'switch', name: 'Switch' },
  },
  placements: [
    { serverId: 'server:1', x: 0, y: 0 },
    { serverId: 'switch:1', x: 400, y: 0 },
  ],
  assignments: [
    {
      id: 1,
      serverId: 'server:1',
      itemId: 'network:1',
      type: 'network',
      assignedAt: '2026-07-20T12:00:00.000Z',
    },
    {
      id: 2,
      serverId: 'server:1',
      itemId: 'gpu:1',
      type: 'gpu',
      assignedAt: '2026-07-20T12:00:00.000Z',
    },
  ],
  connections: [
    {
      id: 1,
      from: { itemId: 'server:1', hostedItemId: 'network:1', portId: 1 },
      to: { itemId: 'switch:1', portId: 1 },
      type: 'network',
      createdAt: '2026-07-20T12:00:00.000Z',
    },
    {
      id: 2,
      from: { itemId: 'server:1', hostedItemId: 'gpu:1', portId: 1 },
      to: { itemId: 'switch:1', portId: 2 },
      type: 'display',
      createdAt: '2026-07-20T12:00:00.000Z',
    },
  ],
}

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  })
  queryClient.setQueryData(['project'], project)
  queryClient.setQueryData(['agent-status'], { servers: {}, registeredServerIds: [] })
  queryClient.setQueryData(['demo-session'], { mode: 'production' })
  queryClient.setQueryData(['release-notes-status'], {
    currentVersion: '0.1.32',
    lastSeenVersion: '0.1.32',
    hasUnseen: false,
    entries: [],
  })
  queryClient.setQueryData(['update-status'], {
    enabled: false,
    channel: 'stable',
    runningVersion: '0.1.32',
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
})

describe('App return to inventory workflow', () => {
  it('cancels safely and applies the complete host transition as one undoable change', async () => {
    renderApp()

    fireEvent.click(await screen.findByRole('button', { name: 'Select host' }))
    expect(screen.getByTestId('inspector-selection')).toHaveTextContent('server:1')

    fireEvent.click(screen.getByRole('button', { name: 'Request return' }))
    expect(screen.getByRole('heading', { name: 'Return Host server to inventory?' })).toBeInTheDocument()
    expect(screen.getByText('Hosted components released').nextSibling).toHaveTextContent('2')
    expect(screen.getByText('Cable connections removed').nextSibling).toHaveTextContent('2')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByTestId('placements')).toHaveTextContent('server:1,switch:1')
    expect(screen.getByTestId('assignments')).toHaveTextContent('2')
    expect(screen.getByTestId('connections')).toHaveTextContent('2')

    fireEvent.click(screen.getByRole('button', { name: 'Request return' }))
    fireEvent.click(screen.getByRole('button', { name: 'Return to inventory' }))

    expect(screen.getByTestId('placements')).toHaveTextContent('switch:1')
    expect(screen.getByTestId('assignments')).toHaveTextContent('0')
    expect(screen.getByTestId('connections')).toHaveTextContent('0')
    expect(screen.getByTestId('inventory-records')).toHaveTextContent('4')
    expect(screen.getByTestId('canvas-selection')).toHaveTextContent('none')
    expect(screen.queryByTestId('inspector-selection')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByTestId('placements')).toHaveTextContent('server:1,switch:1')
    expect(screen.getByTestId('assignments')).toHaveTextContent('2')
    expect(screen.getByTestId('connections')).toHaveTextContent('2')

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(screen.getByTestId('placements')).toHaveTextContent('switch:1')
    expect(screen.getByTestId('assignments')).toHaveTextContent('0')
    expect(screen.getByTestId('connections')).toHaveTextContent('0')
  })
})
