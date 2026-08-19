import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SystemsWorkspace } from '@/components/workbook/systems-workspace'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DEFAULT_SYSTEMS_TABLE_PREFERENCES, writeSystemsTablePreferences } from '@/lib/systems-preferences'
import type { ProjectState } from '@/types/inventory'
import type { SystemsHostRow } from '@/types/systems'

const useSystemsMock = vi.fn()
const useSystemsViewsMock = vi.fn()
const useInventoryMetadataCatalogMock = vi.fn()
const useInventoryMetadataProjectProjectionMock = vi.fn()

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ status: { account: { id: 7 } } }),
}))
vi.mock('@/hooks/use-systems', () => ({
  useSystems: (...args: unknown[]) => useSystemsMock(...args),
  useSystemsViews: (...args: unknown[]) => useSystemsViewsMock(...args),
}))
vi.mock('@/lib/inventory-metadata-query', () => ({
  useInventoryMetadataCatalog: (...args: unknown[]) => useInventoryMetadataCatalogMock(...args),
  useInventoryMetadataProjectProjection: (...args: unknown[]) => useInventoryMetadataProjectProjectionMock(...args),
}))

const project: ProjectState = {
  id: 'project-1',
  metadata: { name: 'Default Project', version: 1, updatedAt: '2026-08-11T00:00:00.000Z', projectId: 1, workspaceId: 1 },
  items: {},
  placements: [],
  assignments: [],
  connections: [],
}

const systems: SystemsHostRow[] = [
  {
    itemId: 1,
    itemKey: 'server:1',
    type: 'server',
    legacyId: 1,
    name: 'HP EliteDesk 800 G6',
    manufacturer: 'HP',
    model: 'EliteDesk 800 G6',
    hardwareClass: 'desktop',
    usageRole: 'server',
    cpuLabel: 'Intel i5-10500T',
    memoryLabel: '32GB DDR4 2933MHz',
    storageLabel: '1TB NVMe',
    operatingSystem: 'Ubuntu 24.04',
    lanIp: '192.0.2.10',
    agentRegistered: true,
    agentState: 'online',
    agentVersion: '0.1.0',
    agentUpdateAvailable: false,
    registryLinked: true,
    cpuPercent: 20,
    memoryPercent: 40,
    storagePercent: 60,
    uptimeSeconds: 3600,
    attentionCount: 2,
    attentionState: 'current',
    attentionRevision: 1,
    metadataTags: [],
    metadataValues: {},
    metadataSearchText: '',
  },
  {
    itemId: 2,
    itemKey: 'nas:1',
    type: 'nas',
    legacyId: 1,
    name: 'Synology DS620slim',
    manufacturer: 'Synology',
    model: 'DS620slim',
    hardwareClass: null,
    usageRole: null,
    cpuLabel: null,
    memoryLabel: '8GB DDR3L 1600MHz',
    storageLabel: '4TB SATA',
    operatingSystem: null,
    lanIp: null,
    agentRegistered: false,
    agentState: 'unregistered',
    agentVersion: null,
    agentUpdateAvailable: false,
    registryLinked: false,
    cpuPercent: null,
    memoryPercent: null,
    storagePercent: null,
    uptimeSeconds: null,
    attentionCount: 0,
    attentionState: 'current',
    attentionRevision: 1,
    metadataTags: [],
    metadataValues: {},
    metadataSearchText: '',
  },
]

function renderWorkspace(props: Partial<ComponentProps<typeof SystemsWorkspace>> = {}) {
  return render(
    <TooltipProvider>
      <SystemsWorkspace
        project={project}
        selectedItemId={null}
        onSelectItem={() => {}}
        onCloseInspector={() => {}}
        {...props}
      />
    </TooltipProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  useSystemsMock.mockReturnValue({
    initial: { data: { systems }, isPending: false, isError: false },
    live: { data: null },
  })
  useSystemsViewsMock.mockReturnValue({
    views: { data: [], isSuccess: true },
    create: { mutateAsync: vi.fn(), isPending: false },
    replace: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setDefault: { mutateAsync: vi.fn(), isPending: false },
  })
  useInventoryMetadataCatalogMock.mockReturnValue({
    data: { revision: 1, definitions: [], tags: [] },
    isSuccess: true,
  })
  useInventoryMetadataProjectProjectionMock.mockReturnValue({
    data: { projectId: 1, rows: [], matchingItemIds: [1, 2] },
    isSuccess: true,
  })
})

describe('SystemsWorkspace', () => {
  it('renders dense operational columns and host states', () => {
    renderWorkspace()
    expect(screen.getByRole('heading', { name: 'Systems' })).toBeVisible()
    expect(screen.queryByText('Compute hosts available to this project.')).not.toBeInTheDocument()
    expect(screen.getByText('Intel i5-10500T')).toBeVisible()
    expect(screen.getByLabelText('Agent online')).toBeVisible()
    expect(screen.getByLabelText('Synology DS620slim is not linked to the registry')).toBeVisible()
    expect(screen.queryByText('Physical class')).not.toBeInTheDocument()
  })

  it('keeps controls together and rows in a separate scroll region below the header', () => {
    renderWorkspace()
    const search = screen.getByPlaceholderText('Search systems')
    const controls = search.parentElement?.parentElement
    expect(controls).toContainElement(screen.getByRole('button', { name: 'System type' }))
    expect(controls).toContainElement(screen.getByRole('button', { name: 'Agent' }))
    expect(controls).toContainElement(screen.getByRole('button', { name: 'Registry' }))

    const header = screen.getByTestId('systems-table-header')
    const body = screen.getByTestId('systems-table-body')
    expect(header).not.toContainElement(body)
    Object.defineProperty(body, 'scrollLeft', { configurable: true, value: 72, writable: true })
    fireEvent.scroll(body)
    expect(header.scrollLeft).toBe(72)
  })

  it('pins identity columns only at the desktop breakpoint', () => {
    renderWorkspace()
    const nameCell = screen.getByText('HP EliteDesk 800 G6').closest('[role="cell"]')
    const row = nameCell?.closest('[role="row"]')
    const typeCell = row?.querySelectorAll('[role="cell"]')[0]
    const typeHeader = screen.getByRole('button', { name: 'Sort by Type' }).closest('[role="columnheader"]')
    const nameHeader = screen.getByRole('button', { name: 'Sort by Name' }).closest('[role="columnheader"]')
    const manufacturerCell = screen.getByText('HP', { exact: true }).closest('[role="cell"]')

    expect(typeCell).toHaveClass('md:sticky', 'md:z-[2]')
    expect(typeHeader).toHaveClass('md:sticky', 'md:z-[2]')
    expect(nameCell).toHaveClass('md:sticky', 'md:z-[2]')
    expect(nameHeader).toHaveClass('md:sticky', 'md:z-[2]')
    expect(typeCell).not.toHaveStyle({ position: 'sticky' })
    expect(nameCell).not.toHaveStyle({ position: 'sticky' })
    expect(manufacturerCell).not.toHaveClass('md:sticky')
  })

  it('centers compact type and status columns', () => {
    renderWorkspace()
    expect(screen.getByLabelText('Agent online').closest('[role="cell"]')).toHaveClass('text-center')
    expect(screen.getByLabelText('HP EliteDesk 800 G6 is linked to the registry').closest('[role="cell"]')).toHaveClass('text-center')
    expect(screen.getByLabelText('Agent online').parentElement).toHaveClass('justify-center')
  })

  it('searches hosts and opens the inspector from the full row', () => {
    const onSelectItem = vi.fn()
    renderWorkspace({ onSelectItem })
    fireEvent.change(screen.getByPlaceholderText('Search systems'), { target: { value: 'Synology' } })
    expect(screen.queryByText('HP EliteDesk 800 G6')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Synology DS620slim'))
    expect(onSelectItem).toHaveBeenCalledWith('nas:1')
  })

  it('closes the selected inspector with Escape', () => {
    const onCloseInspector = vi.fn()
    renderWorkspace({ selectedItemId: 'server:1', onCloseInspector })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCloseInspector).toHaveBeenCalledOnce()
  })

  it('filters the built-in attention view without treating an unregistered agent as an issue', () => {
    renderWorkspace()
    fireEvent.pointerDown(screen.getByRole('button', { name: /All Systems/ }), { button: 0, ctrlKey: false })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Needs Attention' }))
    expect(screen.getByText('HP EliteDesk 800 G6')).toBeVisible()
    expect(screen.queryByText('Synology DS620slim')).not.toBeInTheDocument()
  })

  it('opens the host attention tab from a nonzero count', () => {
    const onSelectItem = vi.fn()
    const dispatch = vi.spyOn(window, 'dispatchEvent')
    renderWorkspace({ onSelectItem })
    fireEvent.click(screen.getByRole('button', { name: 'Open 2 attention items for HP EliteDesk 800 G6' }))
    expect(onSelectItem).toHaveBeenCalledWith('server:1')
    return Promise.resolve().then(() => {
      expect(dispatch.mock.calls.some(([event]) => event.type === 'homelab-inventory:inspector-tab')).toBe(true)
    })
  })

  it('focuses search with slash outside editable controls', () => {
    renderWorkspace()
    fireEvent.keyDown(window, { key: '/' })
    expect(screen.getByPlaceholderText('Search systems')).toHaveFocus()
  })

  it('shows tag previews below Name while the Tags column is hidden', () => {
    useInventoryMetadataProjectProjectionMock.mockReturnValue({
      data: {
        projectId: 1,
        matchingItemIds: [1, 2],
        rows: [{
          itemId: 1,
          itemType: 'server',
          legacyId: 1,
          tags: [{ id: 1, name: 'Production', colorToken: 'green' }],
          values: {},
          searchText: 'production',
        }],
      },
      isSuccess: true,
    })
    renderWorkspace()
    const nameCell = screen.getByText('HP EliteDesk 800 G6').closest('[role="cell"]')
    expect(nameCell).toContainElement(screen.getByText('Production'))
    expect(screen.queryByRole('columnheader', { name: 'Tags' })).not.toBeInTheDocument()
  })

  it('moves tags into their column and renders a selected custom-field column', () => {
    const definition = {
      id: 1,
      name: 'Support tier',
      description: null,
      fieldType: 'shortText' as const,
      unit: null,
      numberMinimum: null,
      numberMaximum: null,
      numberPrecision: null,
      displayOrder: 0,
      revision: 1,
      archivedAt: null,
      createdAt: '2026-08-19T00:00:00.000Z',
      updatedAt: '2026-08-19T00:00:00.000Z',
      applicableItemTypes: ['server'],
      options: [],
    }
    useInventoryMetadataCatalogMock.mockReturnValue({ data: { revision: 1, definitions: [definition], tags: [] }, isSuccess: true })
    useInventoryMetadataProjectProjectionMock.mockReturnValue({
      data: {
        projectId: 1,
        matchingItemIds: [1, 2],
        rows: [{
          itemId: 1,
          itemType: 'server',
          legacyId: 1,
          tags: [{ id: 1, name: 'Production', colorToken: 'green' }],
          values: { 1: { value: 'Critical', optionIds: [], display: 'Critical' } },
          searchText: 'production critical',
        }],
      },
      isSuccess: true,
    })
    const columns = DEFAULT_SYSTEMS_TABLE_PREFERENCES.columns.map((column) => (
      column.key === 'tags' ? { ...column, visible: true } : column
    ))
    writeSystemsTablePreferences('account:7:project:1', {
      ...DEFAULT_SYSTEMS_TABLE_PREFERENCES,
      columns: [...columns, { key: 'custom-field:1', visible: true, order: columns.length }],
    })
    renderWorkspace()
    expect(screen.getByRole('columnheader', { name: 'Tags' })).toBeVisible()
    expect(screen.getByRole('columnheader', { name: 'Support tier' })).toBeVisible()
    expect(screen.getByText('Critical')).toBeVisible()
    const nameCell = screen.getByText('HP EliteDesk 800 G6').closest('[role="cell"]')
    expect(nameCell).not.toContainElement(screen.getByText('Production'))
  })
})
