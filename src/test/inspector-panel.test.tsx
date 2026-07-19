import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InspectorPanel } from '@/components/inspector-panel'
import {
  clearAgentStatus,
  createAgentEnrollment,
  revokeAgentRegistration,
} from '@/lib/agent-api'
import type { AgentStatusSummary } from '@/types/agent'
import type { ProjectState } from '@/types/inventory'

vi.mock('@/lib/agent-api', () => ({
  clearAgentStatus: vi.fn(),
  createAgentEnrollment: vi.fn(),
  revokeAgentRegistration: vi.fn(),
}))

const project: ProjectState = {
  id: 'default-project',
  metadata: {
    name: 'Test Project',
    version: 1,
    updatedAt: '2026-06-26T00:00:00.000Z',
  },
  items: {
    server: {
      id: 'server',
      name: 'Dell OptiPlex Micro 7090',
      type: 'server',
      manufacturer: 'Dell',
      model: 'OptiPlex Micro 7090',
      specs: {
        formFactor: 'Micro',
        networkSlot: 'M.2 2230 A/E',
        wireless: 'Wi-Fi card supported or installed',
      },
      properties: {
        displayName: 'Proxmox 01',
        lanIp: '192.168.1.20',
        tailscaleIp: '100.64.1.20',
      },
      ports: [
        {
          id: 'lan-01',
          kind: 'server-port',
          type: 'rj45',
          slotNumber: 1,
          label: 'LAN 01',
          speed: '1G',
        },
      ],
    },
    cpu: {
      id: 'cpu',
      name: 'Intel Core i7-7700',
      type: 'cpu',
      manufacturer: 'Intel',
      family: 'Core i7',
      number: 'i7-7700',
      specs: {
        cores: 4,
        threads: 8,
        baseClockGhz: 2.9,
        boostClockGhz: 3.8,
        socket: 'LGA1151',
      },
    },
    ram: {
      id: 'ram',
      name: '32GB RAM',
      type: 'ram',
      manufacturer: 'Crucial',
      secondaryManufacturer: 'Kingston',
      specs: {
        capacityGb: 32,
        generation: 'DDR4',
        speedMt: 3200,
        secondarySpeedMt: 2666,
      },
    },
    storage: {
      id: 'storage',
      name: '1TB NVMe SSD',
      type: 'storage',
      manufacturer: 'Samsung',
      specs: {
        capacityTb: 1,
        interface: 'NVMe',
        formFactor: '2280',
      },
    },
    gpu: {
      id: 'gpu',
      name: 'Intel Arc A310 LP',
      type: 'gpu',
      manufacturer: 'Intel',
      model: 'Arc A310 LP',
      specs: {
        formFactor: 'Low profile',
        vramGb: 4,
        memoryType: 'GDDR6',
        memoryBusBit: 64,
      },
    },
    switch: {
      id: 'switch',
      name: 'Omada ES210X-M2 #1',
      type: 'switch',
      manufacturer: 'TP-Link Omada',
      model: 'ES210X-M2',
      specs: {
        management: 'Omada managed',
        switchingCapacityGbps: 80,
        fanless: true,
      },
      ports: Array.from({ length: 5 }, (_, index) => ({
        id: `rj45-${String(index + 1).padStart(2, '0')}`,
        kind: 'switch-port',
        type: 'rj45',
        slotNumber: index + 1,
        label: '',
        speed: '2.5G',
        role: 'access',
      })),
    },
    patch: {
      id: 'patch',
      name: 'VCELINK 24 Port Cat6A Patch Panel',
      type: 'patchPanel',
      manufacturer: 'VCELINK',
      model: '24 Port Cat6A Shielded Patch Panel',
      specs: {
        rackUnits: 1,
      },
      ports: [
        {
          id: 'keystone-01',
          kind: 'keystone',
          type: 'rj45',
          slotNumber: 1,
          label: '',
          endpoints: [
            { id: 'keystone-01-front', side: 'front' },
            { id: 'keystone-01-back', side: 'back' },
          ],
        },
      ],
    },
    nas: {
      id: 'nas',
      name: 'Synology DS923+',
      type: 'nas',
      manufacturer: 'Synology',
      model: 'DS923+',
      specs: {
        driveBays: 4,
        m2Slots: 2,
      },
      ports: [
        {
          id: 'nas-lan-01',
          kind: 'server-port',
          type: 'rj45',
          slotNumber: 1,
          label: 'LAN 01',
          speed: '1G',
        },
      ],
    },
    nasNic: {
      id: 'nasNic',
      name: 'Synology 10GbE Card',
      type: 'network',
      manufacturer: 'Synology',
      ports: [
        {
          id: 'nas-nic-01',
          kind: 'server-port',
          type: 'rj45',
          slotNumber: 1,
          speed: '10G',
        },
      ],
    },
  },
  placements: [{ serverId: 'server', x: 0, y: 0 }],
  assignments: [
    {
      id: 'nas-storage',
      serverId: 'nas',
      itemId: 'storage',
      type: 'storage',
      assignedAt: '2026-07-13T00:00:00.000Z',
    },
    {
      id: 'nas-network',
      serverId: 'nas',
      itemId: 'nasNic',
      type: 'network',
      assignedAt: '2026-07-13T00:00:00.000Z',
    },
  ],
  connections: [],
}

const compatibilityProject: ProjectState = {
  ...project,
  items: {
    ...project.items,
    server: {
      ...project.items.server,
      compatibility: {
        host: {
          cpu: {
            sockets: ['LGA1151'],
            generations: ['8th Gen'],
          },
          memory: {
            generations: ['DDR4'],
            slots: 2,
            maxCapacityGb: 64,
            maxModuleCapacityGb: 32,
            maxSpeedMt: 2666,
          },
          storageSlots: [{
            id: 'm2-slots',
            label: 'M.2 slots',
            count: 2,
            interfaces: ['NVMe'],
            formFactors: ['2280'],
            pcieGeneration: 3,
          }],
          expansionSlots: [{
            id: 'pcie-slot',
            label: 'PCIe slot',
            count: 1,
            interfaceFamily: 'pcie',
            pcieGeneration: 3,
            mechanicalLanes: 16,
            electricalLanes: 4,
            acceptedHeights: ['low-profile'],
            maxSlotWidth: 1,
            maxPowerWatts: 75,
          }],
          maxExpansionPowerWatts: 75,
        },
      },
    },
    cpu: {
      ...project.items.cpu,
      compatibility: {
        requirements: {
          cpu: {
            socket: 'LGA1151',
            generation: '7th Gen',
            tdpWatts: 65,
          },
        },
      },
    },
    ram: {
      ...project.items.ram,
      specs: {
        ...project.items.ram.specs,
        moduleCount: 2,
      },
    },
    storage: {
      ...project.items.storage,
      specs: {
        ...project.items.storage.specs,
        pcie: 'PCIe 4.0 x4',
      },
    },
    gpu: {
      ...project.items.gpu,
      compatibility: {
        requirements: {
          expansion: {
            interfaceFamily: 'pcie',
            pcieGeneration: 4,
            connectorLanes: 8,
            minimumElectricalLanes: 4,
            height: 'low-profile',
            slotWidth: 1,
            powerWatts: 75,
          },
        },
      },
    },
    nas: {
      ...project.items.nas,
      compatibility: {
        host: {
          memory: {
            generations: ['DDR4'],
            slots: 2,
            maxCapacityGb: 32,
            maxModuleCapacityGb: 16,
            maxSpeedMt: 2666,
          },
          storageSlots: [{
            id: 'drive-bays',
            label: 'Drive bays',
            count: 4,
            interfaces: ['SATA'],
            formFactors: ['2.5-inch', '3.5-inch'],
          }],
          expansionSlots: [{
            id: 'network-slot',
            label: 'Network slot',
            count: 1,
            interfaceFamily: 'pcie',
          }],
        },
      },
    },
  },
  assignments: [
    ...project.assignments,
    {
      id: 'server-cpu',
      serverId: 'server',
      itemId: 'cpu',
      type: 'cpu',
      assignedAt: '2026-07-19T00:00:00.000Z',
    },
    {
      id: 'server-ram',
      serverId: 'server',
      itemId: 'ram',
      type: 'ram',
      assignedAt: '2026-07-19T00:00:01.000Z',
      allocation: {
        resourceType: 'memory',
        positions: [0, 1],
      },
    },
    {
      id: 'server-storage',
      serverId: 'server',
      itemId: 'storage',
      type: 'storage',
      assignedAt: '2026-07-19T00:00:02.000Z',
      allocation: {
        resourceType: 'storage',
        groupId: 'm2-slots',
        positions: [0],
      },
    },
    {
      id: 'server-gpu',
      serverId: 'server',
      itemId: 'gpu',
      type: 'gpu',
      assignedAt: '2026-07-19T00:00:03.000Z',
      allocation: {
        resourceType: 'expansion',
        groupId: 'pcie-slot',
        positions: [0],
      },
    },
  ],
}

const collidingCompatibilityProject: ProjectState = {
  ...compatibilityProject,
  items: {
    'server:1': {
      ...compatibilityProject.items.server,
      id: 1,
      key: 'server:1',
      name: 'Typed server host',
    },
    'nas:1': {
      ...compatibilityProject.items.nas,
      id: 1,
      key: 'nas:1',
      name: 'Colliding NAS',
    },
    'cpu:1': {
      ...compatibilityProject.items.cpu,
      id: 1,
      key: 'cpu:1',
      name: 'Typed CPU',
    },
    'ram:1': {
      ...compatibilityProject.items.ram,
      id: 1,
      key: 'ram:1',
      name: 'Typed RAM',
    },
    'storage:1': {
      ...compatibilityProject.items.storage,
      id: 1,
      key: 'storage:1',
      name: 'Typed storage',
    },
    'gpu:1': {
      ...compatibilityProject.items.gpu,
      id: 1,
      key: 'gpu:1',
      name: 'Typed GPU',
    },
  },
  assignments: (['cpu', 'ram', 'storage', 'gpu'] as const).map((type, index) => ({
    id: index + 1,
    serverId: '1',
    hostType: 'server',
    hostId: 1,
    itemId: '1',
    itemType: type,
    type,
    assignedAt: `2026-07-19T00:00:0${index}.000Z`,
    ...(type === 'ram' ? {
      allocation: { resourceType: 'memory' as const, positions: [0, 1] },
    } : type === 'storage' ? {
      allocation: {
        resourceType: 'storage' as const,
        groupId: 'm2-slots',
        positions: [0],
      },
    } : type === 'gpu' ? {
      allocation: {
        resourceType: 'expansion' as const,
        groupId: 'pcie-slot',
        positions: [0],
      },
    } : {}),
  } as ProjectState['assignments'][number] & {
    hostType: 'server'
    hostId: number
    itemType: typeof type
  })),
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

type InspectorPanelProps = ComponentProps<typeof InspectorPanel>

type RenderInspectorOptions = Partial<Pick<InspectorPanelProps,
  | 'onUpdateItem'
  | 'onCreateConnection'
  | 'onSelectNetworkTrace'
  | 'onUpdateConnectionLabel'
  | 'onUpdateConnectionRoute'
  | 'onRemoveConnection'
  | 'onEndpointConnectionClick'
  | 'onCancelPendingConnection'
>> & {
  selectedItemId?: string | null
  selectedConnectionId?: string | null
  agentStatus?: AgentStatusSummary
  project?: ProjectState
  demoMode?: boolean
  validationMessage?: string | null
  validationSeverity?: 'error' | 'unknown'
}

function renderInspector({
  selectedItemId = null,
  selectedConnectionId = null,
  agentStatus = { servers: {}, registeredServerIds: [] },
  project: projectOverride = project,
  demoMode = false,
  validationMessage = null,
  validationSeverity = 'error',
  onUpdateItem = vi.fn(),
  onCreateConnection = vi.fn(),
  onSelectNetworkTrace = vi.fn(),
  onUpdateConnectionLabel = vi.fn(),
  onUpdateConnectionRoute = vi.fn(),
  onRemoveConnection = vi.fn(),
  onEndpointConnectionClick = vi.fn(),
  onCancelPendingConnection = vi.fn(),
}: RenderInspectorOptions = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  const renderResult = render(
    <QueryClientProvider client={queryClient}>
      <InspectorPanel
        project={projectOverride}
        agentStatus={agentStatus}
        demoMode={demoMode}
        selectedItemId={selectedItemId}
        selectedConnectionId={selectedConnectionId}
        activeNetworkTraceKey={null}
        pendingConnectionEndpoint={null}
        validationMessage={validationMessage}
        validationSeverity={validationSeverity}
        persistenceWarning={null}
        open
        onClose={() => {}}
        onUpdateItem={onUpdateItem}
        onCreateConnection={onCreateConnection}
        onSelectNetworkTrace={onSelectNetworkTrace}
        onEndpointConnectionClick={onEndpointConnectionClick}
        onCancelPendingConnection={onCancelPendingConnection}
        onUpdateConnectionLabel={onUpdateConnectionLabel}
        onUpdateConnectionRoute={onUpdateConnectionRoute}
        onRemoveConnection={onRemoveConnection}
      />
    </QueryClientProvider>,
  )

  return {
    ...renderResult,
    onUpdateItem,
    onCreateConnection,
    onSelectNetworkTrace,
    onUpdateConnectionLabel,
    onUpdateConnectionRoute,
    onRemoveConnection,
    onEndpointConnectionClick,
    onCancelPendingConnection,
  }
}

describe('InspectorPanel', () => {
  it('renders unknown compatibility feedback as amber status while errors remain alerts', () => {
    const { unmount } = renderInspector({
      selectedItemId: 'server',
      validationMessage: 'Compatibility could not be fully verified.',
      validationSeverity: 'unknown',
    })

    const unknownNotice = screen.getByTestId('inspector-validation-message')
    expect(unknownNotice).toHaveAttribute('role', 'status')
    expect(unknownNotice).toHaveAttribute('data-severity', 'unknown')
    expect(unknownNotice).toHaveClass('bg-[#fff8df]')

    unmount()
    renderInspector({
      selectedItemId: 'server',
      validationMessage: 'The component is incompatible.',
    })

    const errorNotice = screen.getByTestId('inspector-validation-message')
    expect(errorNotice).toHaveAttribute('role', 'alert')
    expect(errorNotice).toHaveAttribute('data-severity', 'error')
    expect(errorNotice).toHaveClass('bg-[#fff4ee]')
  })
  it.each([
    ['server', ['Specs', 'Slots', 'Ports', 'Network', 'Services', 'Agent', 'Compatibility']],
    ['switch', ['Specs', 'Ports', 'Connections']],
    ['nas', ['Specs', 'Slots', 'Ports', 'Network', 'Agent', 'Compatibility']],
    ['patch', ['Specs', 'Ports', 'Connections', 'Network']],
  ] as const)('renders the approved %s tab order', (selectedItemId, labels) => {
    renderInspector({ selectedItemId })

    expect(screen.getAllByRole('tab').slice(0, labels.length).map((tab) => tab.textContent)).toEqual(labels)
  })

  it('explains server compatibility, utilization, allocations, and grouped findings', async () => {
    const user = userEvent.setup()
    renderInspector({ selectedItemId: 'server', project: compatibilityProject })

    await user.click(screen.getByRole('tab', { name: 'Compatibility' }))

    expect(screen.getByRole('status')).toHaveTextContent('Needs attention')
    const utilization = screen.getByRole('heading', { name: 'Resource utilization' }).closest('section')
    expect(utilization).not.toBeNull()
    const utilizationView = within(utilization as HTMLElement)
    expect(utilizationView.getByText('Memory')).toBeVisible()
    expect(utilizationView.getByText('2 of 2 positions')).toBeVisible()
    expect(utilizationView.getByText('Storage')).toBeVisible()
    expect(utilizationView.getByText('1 of 2 positions')).toBeVisible()
    expect(utilizationView.getByText('Expansion')).toBeVisible()
    expect(utilizationView.getByText('1 of 1 positions')).toBeVisible()
    expect(screen.getAllByText('32GB RAM')).not.toHaveLength(0)
    expect(screen.getByText('Memory positions 1-2')).toBeVisible()
    expect(screen.getByText('M.2 slots, position 1')).toBeVisible()
    expect(screen.getByText('PCIe slot, position 1')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Errors' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Warnings' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Unknowns' })).toBeVisible()
  })

  it('shows NAS compatibility resources without server-only slot assumptions', async () => {
    const user = userEvent.setup()
    renderInspector({ selectedItemId: 'nas', project: compatibilityProject })

    await user.click(screen.getByRole('tab', { name: 'Compatibility' }))

    expect(screen.getByRole('heading', { name: 'Resource utilization' })).toBeVisible()
    expect(screen.getByText('Drive bays')).toBeVisible()
  })

  it('resolves typed hosts and component names when category-scoped numeric IDs collide', async () => {
    const user = userEvent.setup()
    renderInspector({
      selectedItemId: 'server:1',
      project: collidingCompatibilityProject,
    })

    await user.click(screen.getByRole('tab', { name: 'Compatibility' }))

    expect(screen.getByText('Typed CPU')).toBeVisible()
    expect(screen.getByText('Typed RAM')).toBeVisible()
    expect(screen.getByText('Typed storage')).toBeVisible()
    expect(screen.getByText('Typed GPU')).toBeVisible()
    expect(screen.queryByText('Colliding NAS')).not.toBeInTheDocument()
  })

  it('edits NAS specs through a complete item payload', async () => {
    vi.useFakeTimers()
    const { onUpdateItem } = renderInspector({ selectedItemId: 'nas' })

    expect(screen.getByLabelText('Drive Bays')).toHaveValue(4)
    expect(screen.getByLabelText('M.2 Slots')).toHaveValue(2)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Backup NAS' } })
    fireEvent.change(screen.getByLabelText('Drive Bays'), { target: { value: '6' } })
    await act(async () => vi.advanceTimersByTimeAsync(500))

    expect(onUpdateItem).toHaveBeenCalledWith('nas', {
      type: 'nas',
      name: 'Backup NAS',
      manufacturer: 'Synology',
      model: 'DS923+',
      specs: {
        driveBays: 6,
        m2Slots: 2,
      },
      ports: project.items.nas.ports,
    })
  })

  it('limits NAS slots and keeps agent enrollment unavailable', () => {
    renderInspector({ selectedItemId: 'nas' })

    fireEvent.click(screen.getByRole('tab', { name: 'Slots' }))
    expect(screen.getByText('NAS Slots')).toBeInTheDocument()
    expect(screen.getAllByText('Storage').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Network').length).toBeGreaterThan(0)
    expect(screen.queryByText('CPU')).not.toBeInTheDocument()
    expect(screen.queryByText('RAM')).not.toBeInTheDocument()
    expect(screen.queryByText('GPU')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Agent' }))
    expect(screen.getByText('Agent setup is not available for NAS yet.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Agent endpoint')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Setup Agent' })).not.toBeInTheDocument()
    expect(createAgentEnrollment).not.toHaveBeenCalled()
  })

  it('renders storage in the reusable tabbed editor with simplified chrome', () => {
    renderInspector({ selectedItemId: 'storage' })

    expect(screen.queryByText('Specs, slot status, and project save controls.')).not.toBeInTheDocument()
    expect(screen.queryByText('Ready for drag and drop.')).not.toBeInTheDocument()
    expect(screen.queryByText('Selected Item')).not.toBeInTheDocument()
    expect(screen.queryByText('Assigned')).not.toBeInTheDocument()
    expect(screen.queryByText('Server Slots')).not.toBeInTheDocument()
    expect(screen.queryByText('Inventory item')).not.toBeInTheDocument()

    expect(screen.getByText('1TB NVMe SSD')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Specs' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: 'Ports' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('1TB NVMe SSD')
    expect(screen.getByLabelText('Manufacturer')).toHaveValue('Samsung')
    expect(screen.getByLabelText('Capacity')).toHaveValue(1)
    expect(screen.getByRole('combobox', { name: 'Unit' })).toHaveTextContent('TB')
    expect(screen.getByRole('combobox', { name: 'Interface' })).toHaveTextContent('NVMe')
    expect(screen.getByRole('combobox', { name: 'Form Factor' })).toHaveTextContent('2280')
  })

  it('debounces storage text edits and emits the complete item input', async () => {
    vi.useFakeTimers()
    const { onUpdateItem } = renderInspector({ selectedItemId: 'storage' })

    fireEvent.change(screen.getByLabelText('Manufacturer'), { target: { value: 'Crucial' } })
    await act(async () => vi.advanceTimersByTimeAsync(499))
    expect(onUpdateItem).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(onUpdateItem).toHaveBeenCalledWith('storage', {
      type: 'storage',
      name: '1TB NVMe SSD',
      manufacturer: 'Crucial',
      specs: {
        capacityTb: 1,
        interface: 'NVMe',
        formFactor: '2280',
      },
    })
  })

  it('renders GPU tabs and debounces a complete model update', async () => {
    vi.useFakeTimers()
    const { onUpdateItem } = renderInspector({ selectedItemId: 'gpu' })

    expect(screen.getByRole('tab', { name: 'Specs' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Ports' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Manufacturer' })).toHaveTextContent('Intel')
    expect(screen.getByLabelText('Model')).toHaveValue('Arc A310 LP')
    expect(screen.getByLabelText('VRAM GB')).toHaveValue(4)
    expect(screen.getByRole('combobox', { name: 'Form Factor' })).toHaveTextContent('Low profile')

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'Arc A310 ECO' } })
    await act(async () => vi.advanceTimersByTimeAsync(499))
    expect(onUpdateItem).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(onUpdateItem).toHaveBeenCalledWith('gpu', {
      type: 'gpu',
      name: 'Intel Arc A310 LP',
      manufacturer: 'Intel',
      model: 'Arc A310 ECO',
      specs: {
        formFactor: 'Low profile',
        vramGb: 4,
        memoryType: 'GDDR6',
        memoryBusBit: 64,
      },
    })
  })

  it('renders editable switch details and emits one complete item update', () => {
    const { onUpdateItem } = renderInspector({ selectedItemId: 'switch' })

    expect(screen.getByRole('tab', { name: 'Specs' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Switching Gbps')).toHaveValue(80)
    expect(screen.getByRole('checkbox', { name: 'Fanless' })).toBeChecked()

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Core switch' },
    })
    fireEvent.change(screen.getByLabelText('Switching Gbps'), {
      target: { value: '60' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Fanless' }))

    expect(onUpdateItem).toHaveBeenCalledWith('switch', {
      type: 'switch',
      name: 'Core switch',
      manufacturer: 'TP-Link Omada',
      model: 'ES210X-M2',
      specs: {
        management: 'Omada managed',
        switchingCapacityGbps: 60,
        fanless: false,
      },
      ports: project.items.switch.ports,
    })
  })

  it('uses canonical switch management choices while preserving a legacy value', async () => {
    const user = userEvent.setup()
    const { onUpdateItem } = renderInspector({ selectedItemId: 'switch' })

    expect(screen.getByRole('combobox', { name: 'Management' })).toHaveTextContent('Omada managed (Legacy)')
    await user.click(screen.getByRole('combobox', { name: 'Management' }))
    expect(screen.getByRole('option', { name: 'Omada managed (Legacy)' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Layer 2 Managed' }))

    expect(onUpdateItem).toHaveBeenCalledWith('switch', expect.objectContaining({
      type: 'switch',
      name: 'Omada ES210X-M2 #1',
      specs: expect.objectContaining({ management: 'Layer 2 Managed' }),
      ports: project.items.switch.ports,
    }))
  })

  it('edits switch port groups and individual port details', async () => {
    const user = userEvent.setup()
    const { onUpdateItem, onEndpointConnectionClick } = renderInspector({ selectedItemId: 'switch' })

    await user.click(screen.getByRole('tab', { name: 'Ports' }))

    expect(screen.getByRole('heading', { name: 'Ports' })).toBeInTheDocument()
    expect(screen.getByText('Port occupancy')).toBeInTheDocument()
    expect(screen.getAllByText('Open').length).toBeGreaterThan(0)

    fireEvent.change(screen.getByLabelText('Port group 1 count'), {
      target: { value: '4' },
    })

    expect(onUpdateItem).toHaveBeenCalledWith(
      'switch',
      expect.objectContaining({
        type: 'switch',
        ports: expect.arrayContaining([
          expect.objectContaining({ id: 'rj45-01' }),
          expect.objectContaining({ id: 'rj45-04' }),
        ]),
      }),
    )
    expect(vi.mocked(onUpdateItem).mock.calls[0][1].ports).toHaveLength(4)

    fireEvent.click(screen.getByRole('button', { name: 'Connect Port 1' }))

    expect(onEndpointConnectionClick).toHaveBeenCalledWith({
      itemId: 'switch',
      portId: 'rj45-01',
    })

    fireEvent.change(screen.getByLabelText('Port 1 label'), {
      target: { value: 'Office uplink' },
    })
    await user.click(screen.getByRole('combobox', { name: 'Port 1 role' }))
    await user.click(screen.getByRole('option', { name: 'Uplink' }))

    expect(onUpdateItem).toHaveBeenCalledWith(
      'switch',
      expect.objectContaining({
        ports: expect.arrayContaining([
          expect.objectContaining({ id: 'rj45-01', label: 'Office uplink' }),
        ]),
      }),
    )
    expect(onUpdateItem).toHaveBeenCalledWith(
      'switch',
      expect.objectContaining({
        ports: expect.arrayContaining([
          expect.objectContaining({ id: 'rj45-01', role: 'uplink' }),
        ]),
      }),
    )
  })

  it('requires a supported speed for malformed imported switch network groups', async () => {
    const user = userEvent.setup()
    const originalPorts = project.items.switch.ports
    project.items.switch.ports = originalPorts?.map((port) => ({ ...port, speed: undefined }))

    try {
      const { onUpdateItem } = renderInspector({ selectedItemId: 'switch' })

      await user.click(screen.getByRole('tab', { name: 'Ports' }))

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Select a supported speed for this RJ45 switch port group.',
      )

      await user.click(screen.getByRole('combobox', { name: 'Port group 1 speed' }))
      expect(screen.queryByRole('option', { name: 'No speed' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('option', { name: '10G' }))

      expect(onUpdateItem).toHaveBeenCalledWith(
        'switch',
        expect.objectContaining({
          ports: expect.arrayContaining([
            expect.objectContaining({ speed: '10G' }),
          ]),
        }),
      )
    } finally {
      project.items.switch.ports = originalPorts
    }
  })

  it('offers only compatible available host endpoints in the connection editor', async () => {
    const user = userEvent.setup()
    const connectionProject: ProjectState = {
      ...project,
      items: {
        ...project.items,
        server: {
          ...project.items.server,
          ports: [
            ...(project.items.server.ports ?? []),
            {
              id: 'display-01',
              kind: 'server-port',
              type: 'displayport',
              slotNumber: 2,
              label: 'Display 01',
            },
          ],
        },
        nic: {
          id: 'nic',
          name: 'Intel I350-T4',
          type: 'network',
          ports: [
            {
              id: 'nic-rj45-01',
              kind: 'server-port',
              type: 'rj45',
              slotNumber: 1,
              speed: '1G',
            },
          ],
        },
        looseNic: {
          id: 'looseNic',
          name: 'Loose NIC',
          type: 'network',
          ports: [
            {
              id: 'loose-rj45-01',
              kind: 'server-port',
              type: 'rj45',
              slotNumber: 1,
              speed: '2.5G',
            },
          ],
        },
        gpu: {
          ...project.items.gpu,
          ports: [
            {
              id: 'gpu-display-01',
              kind: 'server-port',
              type: 'displayport',
              slotNumber: 1,
            },
          ],
        },
      },
      placements: [
        { serverId: 'server', x: 0, y: 0 },
        { serverId: 'switch', x: 400, y: 0 },
        { serverId: 'patch', x: 800, y: 0 },
      ],
      assignments: [
        {
          id: 1,
          serverId: 'server',
          itemId: 'nic',
          type: 'network',
          assignedAt: '2026-07-13T00:00:00.000Z',
        },
        {
          id: 2,
          serverId: 'server',
          itemId: 'gpu',
          type: 'gpu',
          assignedAt: '2026-07-13T00:00:00.000Z',
        },
      ],
      connections: [],
    }

    renderInspector({
      selectedItemId: 'switch',
      project: connectionProject,
    })

    await user.click(screen.getByRole('tab', { name: 'Connections' }))

    await user.click(screen.getByRole('combobox', { name: 'Destination item' }))
    expect(screen.getByRole('option', { name: 'Dell OptiPlex Micro 7090' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'VCELINK 24 Port Cat6A Patch Panel' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Loose NIC' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Intel Arc A310 LP' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Dell OptiPlex Micro 7090' }))

    await user.click(screen.getByRole('combobox', { name: 'Destination port' }))
    expect(screen.getByRole('option', { name: 'Board / RJ45 01 / 1G' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Intel I350-T4 / RJ45 01 / 1G' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /AMD Radeon RX 640/ })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('combobox', { name: 'Destination item' }))
    await user.click(screen.getByRole('option', { name: 'VCELINK 24 Port Cat6A Patch Panel' }))
    await user.click(screen.getByRole('combobox', { name: 'Destination port' }))
    expect(screen.getByRole('option', { name: 'Port 01 / Back / RJ45' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Port 01 / Front / RJ45' })).toBeInTheDocument()
  })

  it('renders patch panel ports and emits type updates', async () => {
    const user = userEvent.setup()
    const { onUpdateItem, onEndpointConnectionClick } = renderInspector({ selectedItemId: 'patch' })

    await user.click(screen.getByRole('tab', { name: 'Ports' }))
    expect(screen.getByLabelText('Port group 1 count')).toHaveValue(1)
    fireEvent.click(screen.getByRole('button', { name: 'Connect 01 back' }))

    expect(onEndpointConnectionClick).toHaveBeenCalledWith({
      itemId: 'patch',
      portId: 'keystone-01',
      endpointId: 'keystone-01-back',
    })

    await user.click(screen.getByRole('combobox', { name: 'Port 1 type' }))
    await user.click(screen.getByRole('option', { name: 'HDMI' }))

    expect(onUpdateItem).toHaveBeenCalledWith('patch', expect.objectContaining({
      type: 'patchPanel',
      name: 'VCELINK 24 Port Cat6A Patch Panel',
      specs: { rackUnits: 1 },
      ports: [expect.objectContaining({
        id: 'keystone-01',
        kind: 'keystone',
        type: 'hdmi',
        slotNumber: 1,
        endpoints: [
          { id: 'keystone-01-front', side: 'front' },
          { id: 'keystone-01-back', side: 'back' },
        ],
      })],
    }))
  })

  it('edits patch panel labels in the compact grid and port notes in occupancy', () => {
    const { onUpdateItem } = renderInspector({ selectedItemId: 'patch' })

    fireEvent.click(screen.getByRole('tab', { name: 'Ports' }))

    fireEvent.change(screen.getByLabelText('Keystone 1 label'), {
      target: { value: 'Proxmox 01' },
    })
    fireEvent.change(screen.getByLabelText('Port 1 notes'), {
      target: { value: 'Rack A short cable' },
    })

    expect(onUpdateItem).toHaveBeenCalledWith('patch', expect.objectContaining({
      ports: [expect.objectContaining({
        id: 'keystone-01',
        label: 'Proxmox 01',
      })],
    }))
    expect(onUpdateItem).toHaveBeenCalledWith('patch', expect.objectContaining({
      ports: [expect.objectContaining({
        id: 'keystone-01',
        label: 'Proxmox 01',
        notes: 'Rack A short cable',
      })],
    }))
  })

  it('saves patch panel row order through the complete draft', () => {
    const { onUpdateItem } = renderInspector({ selectedItemId: 'patch' })

    fireEvent.click(screen.getByRole('tab', { name: 'Ports' }))
    fireEvent.click(screen.getByRole('button', { name: 'Swap Rows' }))

    expect(onUpdateItem).toHaveBeenCalledWith('patch', expect.objectContaining({
      type: 'patchPanel',
      properties: { patchPanelRowOrder: 'front-back' },
      ports: project.items.patch.ports,
    }))
  })

  it('renders RAM in the reusable tabbed editor', () => {
    renderInspector({ selectedItemId: 'ram' })

    expect(screen.getByText('32GB RAM')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Specs' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: 'Ports' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Manufacturer')).toHaveValue('Crucial')
    expect(screen.getByLabelText('Stick 2 Manufacturer')).toHaveValue('Kingston')
    expect(screen.getByLabelText('Capacity GB')).toHaveValue(32)
    expect(screen.getByRole('combobox', { name: 'Generation' })).toHaveTextContent('DDR4')
    expect(screen.getByRole('combobox', { name: 'Stick 1 Speed' })).toHaveTextContent('3200')
    expect(screen.getByRole('combobox', { name: 'Stick 2 Speed' })).toHaveTextContent('2666')
    expect(screen.queryByText('Server Slots')).not.toBeInTheDocument()
  })

  it('debounces RAM manufacturer edits into one complete item update', async () => {
    vi.useFakeTimers()
    const { onUpdateItem } = renderInspector({ selectedItemId: 'ram' })

    fireEvent.change(screen.getByLabelText('Manufacturer'), { target: { value: 'G.Skill' } })
    fireEvent.change(screen.getByLabelText('Stick 2 Manufacturer'), { target: { value: 'Corsair' } })
    await act(async () => vi.advanceTimersByTimeAsync(499))
    expect(onUpdateItem).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(onUpdateItem).toHaveBeenCalledWith('ram', {
      type: 'ram',
      name: '32GB RAM',
      manufacturer: 'G.Skill',
      secondaryManufacturer: 'Corsair',
      specs: {
        capacityGb: 32,
        generation: 'DDR4',
        speedMt: 3200,
        secondarySpeedMt: 2666,
      },
    })
  })

  it('renders RAM speed options by generation and emits selected speed', async () => {
    const user = userEvent.setup()
    const { onUpdateItem } = renderInspector({ selectedItemId: 'ram' })

    await user.click(screen.getByRole('combobox', { name: 'Stick 1 Speed' }))
    expect(screen.getByRole('option', { name: '2666' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '3200' })).toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: '2666' }))

    expect(onUpdateItem).toHaveBeenCalledWith('ram', expect.objectContaining({
      specs: expect.objectContaining({ speedMt: 2666 }),
    }))
  })

  it('renders RAM stick 2 speed options and emits secondary speed', async () => {
    const user = userEvent.setup()
    const { onUpdateItem } = renderInspector({ selectedItemId: 'ram' })

    await user.click(screen.getByRole('combobox', { name: 'Stick 2 Speed' }))
    await user.click(screen.getByRole('option', { name: '2933' }))

    expect(onUpdateItem).toHaveBeenCalledWith('ram', expect.objectContaining({
      specs: expect.objectContaining({ secondarySpeedMt: 2933 }),
    }))
  })

  it('corrects a CPU number after 500ms and preserves unrelated specs', async () => {
    vi.useFakeTimers()
    const { onUpdateItem } = renderInspector({ selectedItemId: 'cpu' })

    expect(screen.getByRole('tab', { name: 'Specs' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('combobox', { name: 'Manufacturer' })).toHaveTextContent('Intel')
    expect(screen.getByLabelText('Family')).toHaveValue('Core i7')
    expect(screen.getByLabelText('Number')).toHaveValue('i7-7700')
    expect(screen.getByLabelText('Base Clock')).toHaveValue(2.9)
    expect(screen.getByLabelText('Boost Clock')).toHaveValue(3.8)

    fireEvent.change(screen.getByLabelText('Number'), { target: { value: 'i7-7700T' } })
    expect(screen.getByLabelText('Number')).toHaveValue('i7-7700T')
    await act(async () => vi.advanceTimersByTimeAsync(499))
    expect(onUpdateItem).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(onUpdateItem).toHaveBeenCalledWith('cpu', {
      type: 'cpu',
      name: 'Intel Core i7-7700',
      manufacturer: 'Intel',
      family: 'Core i7',
      number: 'i7-7700T',
      specs: {
        cores: 4,
        threads: 8,
        baseClockGhz: 2.9,
        boostClockGhz: 3.8,
        socket: 'LGA1151',
      },
    })
  })

  it('shows server slots only when a server is selected', () => {
    renderInspector({ selectedItemId: 'cpu' })
    expect(screen.queryByText('Server Slots')).not.toBeInTheDocument()

    cleanup()
    renderInspector({ selectedItemId: 'server' })

    expect(screen.getByText('Server Slots')).toBeInTheDocument()
    expect(screen.getAllByText('Dell OptiPlex Micro 7090').length).toBeGreaterThan(0)
  })

  it('renders shared server fields and emits a complete debounced update', async () => {
    vi.useFakeTimers()
    const { onUpdateItem } = renderInspector({ selectedItemId: 'server' })

    const inventoryNameInput = screen.getByLabelText('Name')
    const displayNameInput = screen.getByLabelText('Display name')
    const manufacturerInput = screen.getByLabelText('Manufacturer')

    expect(inventoryNameInput).toHaveValue('Dell OptiPlex Micro 7090')
    expect(displayNameInput).toHaveValue('Proxmox 01')
    expect(manufacturerInput).toHaveValue('Dell')
    expect(screen.queryByLabelText('LAN IP')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Tailscale IP')).not.toBeInTheDocument()

    fireEvent.change(displayNameInput, { target: { value: 'Proxmox 02' } })
    fireEvent.change(manufacturerInput, { target: { value: 'HP' } })
    await act(async () => vi.advanceTimersByTimeAsync(500))

    expect(onUpdateItem).toHaveBeenCalledWith('server', {
      type: 'server',
      name: 'Dell OptiPlex Micro 7090',
      manufacturer: 'HP',
      model: 'OptiPlex Micro 7090',
      specs: {
        formFactor: 'Micro',
        networkSlot: 'M.2 2230 A/E',
        wireless: 'Wi-Fi card supported or installed',
      },
      properties: {
        displayName: 'Proxmox 02',
        lanIp: '192.168.1.20',
        tailscaleIp: '100.64.1.20',
      },
      ports: project.items.server.ports,
    })
  })

  it('merges a pending display name into an immediate board port IP update', async () => {
    vi.useFakeTimers()
    const { onUpdateItem } = renderInspector({ selectedItemId: 'server' })

    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'Proxmox pending' },
    })
    fireEvent.click(screen.getByRole('tab', { name: 'Network' }))
    fireEvent.change(screen.getByLabelText('Port 1 IP address'), {
      target: { value: '192.168.1.55' },
    })

    expect(onUpdateItem).toHaveBeenCalledTimes(1)
    expect(onUpdateItem).toHaveBeenCalledWith('server', expect.objectContaining({
      properties: expect.objectContaining({ displayName: 'Proxmox pending' }),
      ports: [expect.objectContaining({
        id: 'lan-01',
        ipAddress: '192.168.1.55',
      })],
    }))

    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(onUpdateItem).toHaveBeenCalledTimes(1)
  })

  it('saves a hosted NIC IP separately without overwriting the server draft', async () => {
    const user = userEvent.setup()
    const hostedNicProject: ProjectState = {
      ...project,
      items: {
        ...project.items,
        serverNic: {
          id: 'serverNic',
          name: 'Intel I350-T4',
          type: 'network',
          manufacturer: 'Intel',
          specs: {
            interface: 'PCIe 3.0 x4',
            formFactor: 'Low profile',
          },
          ports: [
            {
              id: 'server-nic-01',
              kind: 'server-port',
              type: 'rj45',
              slotNumber: 1,
              speed: '1G',
            },
          ],
        },
      },
      assignments: [
        ...project.assignments,
        {
          id: 'server-network',
          serverId: 'server',
          itemId: 'serverNic',
          type: 'network',
          assignedAt: '2026-07-13T00:00:00.000Z',
        },
      ],
    }
    const { onUpdateItem } = renderInspector({
      selectedItemId: 'server',
      project: hostedNicProject,
    })

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Pending server name' },
    })
    await user.click(screen.getByRole('tab', { name: 'Network' }))
    const interfaceTabs = screen.getAllByRole('tab', { name: 'RJ4501' })
    const hostedInterfaceTab = interfaceTabs.find((tab) => tab.id.includes('serverNic'))
    expect(hostedInterfaceTab).toBeDefined()
    await user.click(hostedInterfaceTab!)
    expect(screen.getByText('Intel I350-T4 / RJ45 1G')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Port 1 IP address'), {
      target: { value: '10.0.0.15' },
    })

    expect(onUpdateItem).toHaveBeenCalledTimes(1)
    expect(onUpdateItem).toHaveBeenLastCalledWith('serverNic', {
      type: 'network',
      name: 'Intel I350-T4',
      manufacturer: 'Intel',
      specs: {
        ports: 1,
        speedMbps: 1000,
        interface: 'PCIe 3.0 x4',
        formFactor: 'Low profile',
      },
      ports: [expect.objectContaining({
        id: 'server-nic-01',
        ipAddress: '10.0.0.15',
      })],
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 550))
    })
    expect(onUpdateItem).toHaveBeenCalledTimes(2)
    expect(onUpdateItem).toHaveBeenLastCalledWith('server', expect.objectContaining({
      name: 'Pending server name',
      properties: expect.objectContaining({ displayName: 'Proxmox 01' }),
    }))
  })

  it('renders agent operational telemetry for a selected server', () => {
    renderInspector({
      selectedItemId: 'server',
      agentStatus: {
        registeredServerIds: ['server'],
        servers: {
          server: {
            serverId: 'server',
            state: 'online',
            connected: true,
            ageMs: 8_000,
            hostname: 'lab-node',
            loadAverage: [0.15, 0.2, 0.3],
            memory: {
              totalBytes: 16 * 1024 * 1024 * 1024,
              usedBytes: 8 * 1024 * 1024 * 1024,
            },
            containers: [
              {
                name: 'uptime-kuma',
                image: 'louislam/uptime-kuma:1',
                status: 'Up 2 hours',
              },
            ],
            kubernetes: {
              role: 'worker',
              version: 'k3s version v1.30.0+k3s1',
            },
            listeningPorts: [
              {
                protocol: 'tcp',
                address: '0.0.0.0',
                port: 3001,
                process: 'users:(("node",pid=100,fd=22))',
              },
            ],
            services: [
              {
                unit: 'docker.service',
                description: 'Docker Application Container Engine',
              },
            ],
          },
        },
      },
    })

    fireEvent.click(screen.getByRole('tab', { name: 'Services' }))

    expect(screen.getByText('online')).toBeInTheDocument()
    expect(screen.getByText('lab-node')).toBeInTheDocument()
    expect(screen.getByText('Load Avg')).toBeInTheDocument()
    expect(screen.getByText('0.15 / 0.20 / 0.30')).toBeInTheDocument()
    expect(screen.getByText('Containers')).toBeInTheDocument()
    expect(screen.getByText('uptime-kuma')).toBeInTheDocument()
    expect(screen.getByText('K3s')).toBeInTheDocument()
    expect(screen.getByText('Worker')).toBeInTheDocument()
    expect(screen.getByText('LAN Listening Ports')).toBeInTheDocument()
    expect(screen.getByText('TCP 0.0.0.0:3001')).toBeInTheDocument()
    expect(screen.getByText('Running Services')).toBeInTheDocument()
    expect(screen.getByText('docker.service')).toBeInTheDocument()
  })

  it('allows registered agents to be revoked from the Agent tab', async () => {
    const user = userEvent.setup()
    vi.mocked(revokeAgentRegistration).mockResolvedValue()
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderInspector({
      selectedItemId: 'server',
      agentStatus: {
        registeredServerIds: ['server'],
        servers: {
          server: {
            serverId: 'server',
            state: 'offline',
            connected: true,
            ageMs: 600_000,
            lastSeenAt: '2026-07-18T00:00:00.000Z',
          },
        },
      },
    })

    await user.click(screen.getByRole('tab', { name: 'Agent' }))
    await user.click(screen.getByRole('button', { name: 'Revoke Registration' }))

    await vi.waitFor(() => {
      expect(revokeAgentRegistration).toHaveBeenCalledWith('server')
    })
    expect(screen.getByRole('button', { name: 'Clear Saved Telemetry' })).toBeDisabled()
  })

  it('allows saved telemetry to be cleared after registration is revoked', async () => {
    const user = userEvent.setup()
    vi.mocked(clearAgentStatus).mockResolvedValue({ servers: {}, registeredServerIds: [] })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderInspector({
      selectedItemId: 'server',
      agentStatus: {
        registeredServerIds: [],
        servers: {
          server: {
            serverId: 'server',
            state: 'unregistered',
            connected: false,
            ageMs: 600_000,
            lastSeenAt: '2026-07-18T00:00:00.000Z',
          },
        },
      },
    })

    await user.click(screen.getByRole('tab', { name: 'Agent' }))
    await user.click(screen.getByRole('button', { name: 'Clear Saved Telemetry' }))

    await vi.waitFor(() => {
      expect(clearAgentStatus).toHaveBeenCalledWith('server')
    })
    expect(screen.queryByRole('button', { name: 'Revoke Registration' })).not.toBeInTheDocument()
  })

  it('explains that agent setup is unavailable in demo mode', () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <InspectorPanel
          project={project}
          agentStatus={{ servers: {}, registeredServerIds: [] }}
          demoMode
          selectedItemId="server"
          selectedConnectionId={null}
          activeNetworkTraceKey={null}
          pendingConnectionEndpoint={null}
          validationMessage={null}
          persistenceWarning={null}
          open
          onClose={() => {}}
          onUpdateItem={vi.fn()}
          onCreateConnection={vi.fn()}
          onSelectNetworkTrace={vi.fn()}
          onEndpointConnectionClick={vi.fn()}
          onCancelPendingConnection={vi.fn()}
          onUpdateConnectionLabel={vi.fn()}
          onUpdateConnectionRoute={vi.fn()}
          onRemoveConnection={vi.fn()}
        />
      </QueryClientProvider>,
    )

    expect(screen.getByText('Agent setup is disabled in public demo mode.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Agent endpoint')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Setup Agent' })).not.toBeInTheDocument()
  })

  it('does not render server audit warnings for unplanned open LAN ports', () => {
    renderInspector({ selectedItemId: 'server' })

    expect(screen.queryByText('Audit')).not.toBeInTheDocument()
    expect(screen.queryByText('LAN port 01 is open.')).not.toBeInTheDocument()
  })

  it('renders selected cable details and removes the cable', () => {
    const onRemoveConnection = vi.fn()
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const projectWithConnection: ProjectState = {
      ...project,
      connections: [
        {
          id: 'conn-1',
          type: 'network',
          negotiatedSpeedMbps: 1000,
          createdAt: '2026-06-26T00:00:00.000Z',
          from: { itemId: 'server', portId: 'lan-01' },
          to: { itemId: 'patch', portId: 'keystone-01', endpointId: 'keystone-01-back' },
        },
      ],
    }

    render(
      <QueryClientProvider client={queryClient}>
        <InspectorPanel
          project={projectWithConnection}
          agentStatus={{ servers: {}, registeredServerIds: [] }}
          selectedItemId={null}
          selectedConnectionId="conn-1"
          activeNetworkTraceKey={null}
          pendingConnectionEndpoint={null}
          validationMessage={null}
          persistenceWarning={null}
          open
          onClose={() => {}}
          onUpdateItem={vi.fn()}
          onCreateConnection={vi.fn()}
          onSelectNetworkTrace={vi.fn()}
          onEndpointConnectionClick={vi.fn()}
          onCancelPendingConnection={vi.fn()}
          onUpdateConnectionLabel={vi.fn()}
          onUpdateConnectionRoute={vi.fn()}
          onRemoveConnection={onRemoveConnection}
        />
      </QueryClientProvider>,
    )

    expect(screen.getByText('Cable')).toBeInTheDocument()
    expect(screen.getByText('1G')).toBeInTheDocument()
    expect(screen.getByText('Dell OptiPlex Micro 7090 / LAN 01 / RJ45 1G')).toBeInTheDocument()
    expect(screen.getByText('VCELINK 24 Port Cat6A Patch Panel / 01 back / RJ45')).toBeInTheDocument()
    expect(screen.getByText('Route')).toBeInTheDocument()
    expect(screen.getByText('From side')).toBeInTheDocument()
    expect(screen.getByText('To side')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Cable' }))

    expect(onRemoveConnection).toHaveBeenCalledWith('conn-1')
  })
})
