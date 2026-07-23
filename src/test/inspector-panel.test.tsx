import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
import type { InventoryItem, ProjectState } from '@/types/inventory'

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
    'server:1': {
      id: 1,
      key: 'server:1',
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
          id: 1,
          kind: 'server-port',
          type: 'rj45',
          slotNumber: 1,
          label: 'LAN 01',
          speed: '1G',
        },
      ],
    },
    'cpu:1': {
      id: 1,
      key: 'cpu:1',
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
    'ram:1': {
      id: 1,
      key: 'ram:1',
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
    'storage:1': {
      id: 1,
      key: 'storage:1',
      name: '1TB NVMe SSD',
      type: 'storage',
      manufacturer: 'Samsung',
      specs: {
        capacityTb: 1,
        interface: 'NVMe',
        formFactor: '2280',
      },
    },
    'gpu:1': {
      id: 1,
      key: 'gpu:1',
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
    'switch:1': {
      id: 1,
      key: 'switch:1',
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
        id: index + 1,
        kind: 'switch-port',
        type: 'rj45',
        slotNumber: index + 1,
        label: '',
        speed: '2.5G',
        role: 'access',
      })),
    },
    'patchPanel:1': {
      id: 1,
      key: 'patchPanel:1',
      name: 'VCELINK 24 Port Cat6A Patch Panel',
      type: 'patchPanel',
      manufacturer: 'VCELINK',
      model: '24 Port Cat6A Shielded Patch Panel',
      specs: {
        rackUnits: 1,
      },
      ports: [
        {
          id: 1,
          kind: 'keystone',
          type: 'rj45',
          slotNumber: 1,
          label: '',
          endpoints: [
            { id: 1, side: 'front' },
            { id: 2, side: 'back' },
          ],
        },
      ],
    },
    'nas:1': {
      id: 1,
      key: 'nas:1',
      name: 'Synology DS923+',
      type: 'nas',
      manufacturer: 'Synology',
      model: 'DS923+',
      specs: {
        driveBays: 4,
        m2Slots: 2,
        powerConfiguration: 'external-adapter',
      },
      ports: [
        {
          id: 1,
          kind: 'server-port',
          type: 'rj45',
          slotNumber: 1,
          label: 'LAN 01',
          speed: '1G',
        },
      ],
    },
    'network:1': {
      id: 1,
      key: 'network:1',
      name: 'Synology 10GbE Card',
      type: 'network',
      manufacturer: 'Synology',
      ports: [
        {
          id: 1,
          kind: 'server-port',
          type: 'rj45',
          slotNumber: 1,
          speed: '10G',
        },
      ],
    },
  },
  placements: [{ serverId: 'server:1', x: 0, y: 0 }],
  assignments: [
    {
      id: 1,
      serverId: 'nas:1',
      itemId: 'storage:1',
      type: 'storage',
      assignedAt: '2026-07-13T00:00:00.000Z',
    },
    {
      id: 2,
      serverId: 'nas:1',
      itemId: 'network:1',
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
    'server:1': {
      ...project.items['server:1'],
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
            id: 5, key: 'm2-slots',
            label: 'M.2 slots',
            count: 2,
            interfaces: ['NVMe'],
            formFactors: ['2280'],
            pcieGeneration: 3,
          }],
          expansionSlots: [{
            id: 6, key: 'pcie-slot',
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
    'cpu:1': {
      ...project.items['cpu:1'],
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
    'ram:1': {
      ...project.items['ram:1'],
      specs: {
        ...project.items['ram:1'].specs,
        moduleCount: 2,
      },
    },
    'storage:1': {
      ...project.items['storage:1'],
      specs: {
        ...project.items['storage:1'].specs,
        pcie: 'PCIe 4.0 x4',
      },
    },
    'gpu:1': {
      ...project.items['gpu:1'],
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
    'nas:1': {
      ...project.items['nas:1'],
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
            id: 7, key: 'drive-bays',
            label: 'Drive bays',
            count: 4,
            interfaces: ['SATA'],
            formFactors: ['2.5-inch', '3.5-inch'],
          }],
          expansionSlots: [{
            id: 8, key: 'network-slot',
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
      id: 3,
      serverId: 'server:1',
      itemId: 'cpu:1',
      type: 'cpu',
      assignedAt: '2026-07-19T00:00:00.000Z',
    },
    {
      id: 4,
      serverId: 'server:1',
      itemId: 'ram:1',
      type: 'ram',
      assignedAt: '2026-07-19T00:00:01.000Z',
      allocation: {
        resourceType: 'memory',
        positions: [0, 1],
      },
    },
    {
      id: 5,
      serverId: 'server:1',
      itemId: 'storage:1',
      type: 'storage',
      assignedAt: '2026-07-19T00:00:02.000Z',
      allocation: {
        resourceType: 'storage',
        groupId: 5,
        positions: [0],
      },
    },
    {
      id: 6,
      serverId: 'server:1',
      itemId: 'gpu:1',
      type: 'gpu',
      assignedAt: '2026-07-19T00:00:03.000Z',
      allocation: {
        resourceType: 'expansion',
        groupId: 6,
        positions: [0],
      },
    },
  ],
}

const collidingCompatibilityProject: ProjectState = {
  ...compatibilityProject,
  items: {
    'server:1': {
      ...compatibilityProject.items['server:1'],
      id: 1,
      key: 'server:1',
      name: 'Typed server host',
    },
    'nas:1': {
      ...compatibilityProject.items['nas:1'],
      id: 1,
      key: 'nas:1',
      name: 'Colliding NAS',
    },
    'cpu:1': {
      ...compatibilityProject.items['cpu:1'],
      id: 1,
      key: 'cpu:1',
      name: 'Typed CPU',
    },
    'ram:1': {
      ...compatibilityProject.items['ram:1'],
      id: 1,
      key: 'ram:1',
      name: 'Typed RAM',
    },
    'storage:1': {
      ...compatibilityProject.items['storage:1'],
      id: 1,
      key: 'storage:1',
      name: 'Typed storage',
    },
    'gpu:1': {
      ...compatibilityProject.items['gpu:1'],
      id: 1,
      key: 'gpu:1',
      name: 'Typed GPU',
    },
  },
  assignments: (['cpu', 'ram', 'storage', 'gpu'] as const).map((type, index) => ({
    id: index + 1,
    serverId: 'server:1',
    hostType: 'server',
    hostId: 1,
    itemId: `${type}:1`,
    itemType: type,
    type,
    assignedAt: `2026-07-19T00:00:0${index}.000Z`,
    ...(type === 'ram' ? {
      allocation: { resourceType: 'memory' as const, positions: [0, 1] },
    } : type === 'storage' ? {
      allocation: {
        resourceType: 'storage' as const,
        groupId: 5,
        positions: [0],
      },
    } : type === 'gpu' ? {
      allocation: {
        resourceType: 'expansion' as const,
        groupId: 6,
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
  | 'onUpdateProject'
  | 'onUpdateItem'
  | 'onUpdateItemProperties'
  | 'onCreateConnection'
  | 'onSelectNetworkTrace'
  | 'onUpdateConnectionLabel'
  | 'onUpdateConnectionRoute'
  | 'onRemoveConnection'
  | 'onEndpointConnectionClick'
  | 'onCancelPendingConnection'
  | 'onReturnItemToInventory'
  | 'onRequestNasPowerConfigurationChange'
  | 'onSetWarningIgnored'
>> & {
  selectedItemId?: string | null
  selectedConnectionId?: string | number | null
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
  onUpdateProject = vi.fn(),
  onUpdateItem = vi.fn(),
  onUpdateItemProperties = vi.fn(),
  onCreateConnection = vi.fn(),
  onSelectNetworkTrace = vi.fn(),
  onUpdateConnectionLabel = vi.fn(),
  onUpdateConnectionRoute = vi.fn(),
  onRemoveConnection = vi.fn(),
  onEndpointConnectionClick = vi.fn(),
  onCancelPendingConnection = vi.fn(),
  onReturnItemToInventory = vi.fn(),
  onRequestNasPowerConfigurationChange = vi.fn(),
  onSetWarningIgnored = vi.fn(),
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
        onUpdateProject={onUpdateProject}
        onUpdateItem={onUpdateItem}
        onUpdateItemProperties={onUpdateItemProperties}
        onReturnItemToInventory={onReturnItemToInventory}
        onCreateConnection={onCreateConnection}
        onSelectNetworkTrace={onSelectNetworkTrace}
        onEndpointConnectionClick={onEndpointConnectionClick}
        onCancelPendingConnection={onCancelPendingConnection}
        onUpdateConnectionLabel={onUpdateConnectionLabel}
        onUpdateConnectionRoute={onUpdateConnectionRoute}
        onRemoveConnection={onRemoveConnection}
        onRequestNasPowerConfigurationChange={onRequestNasPowerConfigurationChange}
        onSetWarningIgnored={onSetWarningIgnored}
      />
    </QueryClientProvider>,
  )

  return {
    ...renderResult,
    onUpdateProject,
    onUpdateItem,
    onUpdateItemProperties,
    onCreateConnection,
    onSelectNetworkTrace,
    onUpdateConnectionLabel,
    onUpdateConnectionRoute,
    onRemoveConnection,
    onEndpointConnectionClick,
    onCancelPendingConnection,
    onReturnItemToInventory,
    onRequestNasPowerConfigurationChange,
    onSetWarningIgnored,
  }
}

function standalonePowerEquipmentProject(): ProjectState {
  const ups: InventoryItem = {
    id: 1,
    key: 'ups:1',
    name: 'Rack UPS',
    type: 'ups',
    manufacturer: 'APC',
    specs: { capacityVa: 1500, batteryBackupOutlets: 2, surgeProtectedOutlets: 1, outlets: 3 },
    ports: [
      { id: 1, key: 'battery-outlet-1', kind: 'power-port', type: 'ac-outlet', slotNumber: 1, label: 'Battery outlet 1' },
      { id: 2, key: 'battery-outlet-2', kind: 'power-port', type: 'ac-outlet', slotNumber: 2, label: 'Battery outlet 2' },
      { id: 3, key: 'surge-outlet-1', kind: 'power-port', type: 'ac-outlet', slotNumber: 3, label: 'Surge outlet 1' },
    ],
  }
  const monitor: InventoryItem = {
    id: 1,
    key: 'monitor:1',
    name: 'Studio Display',
    type: 'monitor',
    specs: { sizeInches: 27, resolution: '4K', refreshRateHz: 60 },
    ports: [
      { id: 1, kind: 'server-port', type: 'displayport', slotNumber: 1 },
      { id: 2, key: 'ac-input', kind: 'power-port', type: 'ac-input', slotNumber: 1 },
    ],
  }
  const powerStrip: InventoryItem = {
    id: 1,
    key: 'powerStrip:1',
    name: 'Desk Power Strip',
    type: 'powerStrip',
    specs: { outlets: 2, surgeProtected: true },
    ports: [
      { id: 1, key: 'ac-input', kind: 'power-port', type: 'ac-input', slotNumber: 0, label: 'AC input' },
      { id: 2, key: 'outlet-1', kind: 'power-port', type: 'ac-outlet', slotNumber: 1, label: 'Outlet 1' },
      { id: 3, key: 'outlet-2', kind: 'power-port', type: 'ac-outlet', slotNumber: 2, label: 'Outlet 2' },
    ],
  }

  return {
    ...project,
    items: { 'ups:1': ups, 'monitor:1': monitor, 'powerStrip:1': powerStrip },
    placements: [],
    assignments: [],
    connections: [],
  }
}

describe('InspectorPanel', () => {
  it('offers return to inventory only for an item placed on the canvas', async () => {
    const user = userEvent.setup()
    const { onReturnItemToInventory, rerender } = renderInspector({ selectedItemId: 'server:1' })

    await user.click(screen.getByRole('button', { name: 'Actions for Dell OptiPlex Micro 7090' }))
    await user.click(screen.getByRole('menuitem', { name: 'Return to inventory' }))
    expect(onReturnItemToInventory).toHaveBeenCalledWith('server:1')

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <InspectorPanel
          project={{ ...project, placements: [] }}
          agentStatus={{ servers: {}, registeredServerIds: [] }}
          selectedItemId="server:1"
          selectedConnectionId={null}
          activeNetworkTraceKey={null}
          pendingConnectionEndpoint={null}
          validationMessage={null}
          persistenceWarning={null}
          open
          onClose={() => {}}
          onUpdateProject={() => {}}
          onUpdateItem={() => {}}
          onReturnItemToInventory={onReturnItemToInventory}
          onCreateConnection={() => {}}
          onSelectNetworkTrace={() => {}}
          onEndpointConnectionClick={() => {}}
          onCancelPendingConnection={() => {}}
          onUpdateConnectionLabel={() => {}}
          onUpdateConnectionRoute={() => {}}
          onRemoveConnection={() => {}}
        />
      </QueryClientProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Actions for Dell OptiPlex Micro 7090' }))
    expect(screen.queryByRole('menuitem', { name: 'Return to inventory' })).not.toBeInTheDocument()
  })

  it('renders dedicated PC Build tabs with assigned components, hosted ports, and power input', async () => {
    const user = userEvent.setup()
    const pcBuild: InventoryItem = {
      id: 1,
      key: 'pcBuild:1',
      name: 'Gaming Workstation',
      type: 'pcBuild',
      specs: { operatingSystem: 'Windows 11 Pro', role: 'Gaming' },
      properties: { displayName: 'Aurora' },
    }
    const motherboard: InventoryItem = {
      id: 1,
      key: 'motherboard:1',
      name: 'ASUS ProArt X670E',
      type: 'motherboard',
      manufacturer: 'ASUS',
      specs: { formFactor: 'ATX' },
      ports: [{ id: 1, kind: 'server-port', type: 'displayport', slotNumber: 1 }],
    }
    const network: InventoryItem = {
      id: 1,
      key: 'network:1',
      name: 'Intel X550-T2',
      type: 'network',
      ports: [{ id: 1, kind: 'server-port', type: 'rj45', slotNumber: 1, speed: '10G' }],
    }
    const powerSupply: InventoryItem = {
      id: 1,
      key: 'powerSupply:1',
      name: 'Corsair RM750x',
      type: 'powerSupply',
      specs: { ratedWatts: 750, formFactor: 'ATX' },
      ports: [{ id: 1, key: 'ac-input', kind: 'power-port', type: 'ac-input', slotNumber: 1 }],
    }
    const pcProject: ProjectState = {
      ...project,
      items: {
        'pcBuild:1': pcBuild,
        'motherboard:1': motherboard,
        'network:1': network,
        'powerSupply:1': powerSupply,
      },
      placements: [{ serverId: 'pcBuild:1', x: 0, y: 0 }],
      assignments: [motherboard, network, powerSupply].map((item, index) => ({
        id: index + 1,
        serverId: 'pcBuild:1',
        itemId: item.key!,
        type: item.type as 'motherboard' | 'network' | 'powerSupply',
        assignedAt: '2026-07-20T00:00:00.000Z',
      })),
      connections: [],
    }

    renderInspector({ selectedItemId: 'pcBuild:1', project: pcProject })

    expect(screen.getByRole('tab', { name: 'Specs' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Name')).toHaveValue('Gaming Workstation')
    expect(screen.getByLabelText(/display name/i)).toHaveValue('Aurora')
    expect(screen.getByLabelText('Operating System')).toHaveValue('Windows 11 Pro')

    await user.click(screen.getByRole('tab', { name: 'Slots' }))
    expect(screen.getByText('ASUS ProArt X670E')).toBeInTheDocument()
    expect(screen.getByText('Corsair RM750x')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Ports' }))
    expect(screen.getByText('PC Build Ports')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Network' }))
    expect(screen.getByText('Network Interfaces')).toBeInTheDocument()
    expect(screen.getByText(/Intel X550-T2 \/ RJ45 10G/)).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Power' }))
    expect(screen.getByText('Gaming Workstation / Corsair RM750x / AC input')).toBeInTheDocument()
  })

  it('reuses inventory form fields for new assignable component inspectors', () => {
    const cooler: InventoryItem = {
      id: 1,
      key: 'cpuCooler:1',
      name: 'Noctua NH-D15',
      type: 'cpuCooler',
      manufacturer: 'Noctua',
      model: 'NH-D15',
      specs: { coolerType: 'Air' },
    }

    renderInspector({
      selectedItemId: 'cpuCooler:1',
      project: { ...project, items: { 'cpuCooler:1': cooler } },
    })

    expect(screen.getByText('CPU Cooler Details')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Noctua NH-D15')
    expect(screen.getByLabelText('Manufacturer')).toHaveValue('Noctua')
    expect(screen.getByLabelText('Cooler Type')).toBeInTheDocument()
  })

  it('renders editable standalone power equipment with outlet and monitor port tabs', async () => {
    const user = userEvent.setup()
    const powerProject = standalonePowerEquipmentProject()

    const upsRender = renderInspector({ selectedItemId: 'ups:1', project: powerProject })
    expect(screen.getByLabelText('Name')).toHaveValue('Rack UPS')
    await user.click(screen.getByRole('tab', { name: 'Outlets' }))
    expect(screen.getByText('Rack UPS / Battery outlet 1')).toBeInTheDocument()

    upsRender.unmount()
    renderInspector({ selectedItemId: 'monitor:1', project: powerProject })
    expect(screen.queryByRole('tab', { name: 'Layout' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Ports' }))
    expect(screen.getByText(/port occupancy/i)).toBeInTheDocument()
    expect(screen.getByText('Studio Display / AC input')).toBeInTheDocument()
  })

  it('autosaves UPS orientation and uses a context-aware group swap label', async () => {
    const user = userEvent.setup()
    const { onUpdateItem, onUpdateItemProperties } = renderInspector({
      selectedItemId: 'ups:1',
      project: standalonePowerEquipmentProject(),
    })

    expect(screen.queryByText('Canvas Layout')).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Layout' }))
    expect(screen.getByRole('radiogroup', { name: 'Orientation' })).toBeInTheDocument()
    const horizontal = screen.getByRole('radio', { name: 'Horizontal' })
    const vertical = screen.getByRole('radio', { name: 'Vertical' })
    const swapRows = screen.getByRole('button', { name: 'Swap Rows' })
    expect(horizontal).toBeChecked()
    expect(horizontal).toHaveAttribute('name', 'power-equipment-orientation-ups-1')
    expect(vertical).toHaveAttribute('name', 'power-equipment-orientation-ups-1')
    expect(screen.getByText('Horizontal').closest('label')).toHaveClass('h-11')
    expect(swapRows).toHaveClass('h-11')

    horizontal.focus()
    await user.keyboard('{ArrowRight}')
    expect(vertical).toBeChecked()
    expect(onUpdateItemProperties).toHaveBeenLastCalledWith('ups:1', {
      canvasOrientation: 'vertical',
    })
    expect(onUpdateItem).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Swap Columns' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Swap Columns' }))
    expect(onUpdateItemProperties).toHaveBeenLastCalledWith('ups:1', {
      canvasOrientation: 'vertical',
      upsOutletGroupOrder: 'surge-battery',
    })
    expect(onUpdateItem).not.toHaveBeenCalled()
  })

  it('offers power-strip orientation without UPS group controls', async () => {
    const user = userEvent.setup()
    const { onUpdateItem, onUpdateItemProperties } = renderInspector({
      selectedItemId: 'powerStrip:1',
      project: standalonePowerEquipmentProject(),
    })

    await user.click(screen.getByRole('tab', { name: 'Layout' }))
    await user.click(screen.getByRole('radio', { name: 'Vertical' }))

    expect(onUpdateItemProperties).toHaveBeenLastCalledWith('powerStrip:1', {
      canvasOrientation: 'vertical',
    })
    expect(onUpdateItem).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /Swap (Rows|Columns)/ })).not.toBeInTheDocument()
  })

  it('edits smart power-strip metadata and confirms before clearing it', async () => {
    const user = userEvent.setup()
    const powerProject = standalonePowerEquipmentProject()
    powerProject.items['powerStrip:1'] = {
      ...powerProject.items['powerStrip:1'],
      smart: {
        enabled: true,
        displayName: 'Rack power',
        managementIp: '192.168.1.50',
        macAddress: '00:11:22:33:44:55',
        outlets: [{ portId: 2, name: 'Router' }],
      },
    }
    const { onUpdateItem } = renderInspector({
      selectedItemId: 'powerStrip:1',
      project: powerProject,
    })

    await user.click(screen.getByRole('tab', { name: 'Smart' }))
    const smartMode = screen.getByRole('switch', { name: 'Smart power strip' })
    expect(smartMode).toBeChecked()
    expect(screen.getByRole('textbox', { name: 'Device display name' })).toHaveValue('Rack power')
    expect(screen.getByRole('textbox', { name: 'Management IP' })).toHaveValue('192.168.1.50')
    expect(screen.getByRole('textbox', { name: 'Outlet 1 custom name' })).toHaveValue('Router')

    await user.click(smartMode)
    expect(screen.getByRole('heading', { name: 'Disable smart mode?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Disable and remove data' }))

    await waitFor(() => expect(onUpdateItem).toHaveBeenCalled())
    const [itemId, input] = vi.mocked(onUpdateItem).mock.calls.at(-1)!
    expect(itemId).toBe('powerStrip:1')
    expect(input).not.toHaveProperty('smart')
    expect(input).toEqual(expect.objectContaining({
      type: 'powerStrip',
      name: 'Desk Power Strip',
      specs: expect.objectContaining({ outlets: 2 }),
    }))
  })

  it('resets to the first valid tab when power-equipment tabs change in place', async () => {
    const user = userEvent.setup()
    const powerProject = standalonePowerEquipmentProject()
    const { rerender } = renderInspector({ selectedItemId: 'ups:1', project: powerProject })

    await user.click(screen.getByRole('tab', { name: 'Layout' }))
    expect(screen.getByText('Canvas Layout')).toBeInTheDocument()

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <InspectorPanel
          project={powerProject}
          agentStatus={{ servers: {}, registeredServerIds: [] }}
          selectedItemId="monitor:1"
          selectedConnectionId={null}
          activeNetworkTraceKey={null}
          pendingConnectionEndpoint={null}
          validationMessage={null}
          persistenceWarning={null}
          open
          onClose={() => {}}
          onUpdateProject={() => {}}
          onUpdateItem={() => {}}
          onReturnItemToInventory={() => {}}
          onCreateConnection={() => {}}
          onSelectNetworkTrace={() => {}}
          onEndpointConnectionClick={() => {}}
          onCancelPendingConnection={() => {}}
          onUpdateConnectionLabel={() => {}}
          onUpdateConnectionRoute={() => {}}
          onRemoveConnection={() => {}}
        />
      </QueryClientProvider>,
    )

    expect(screen.queryByRole('tab', { name: 'Layout' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Specs' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByDisplayValue('Studio Display')).toBeInTheDocument()
  })

  it('renders unknown compatibility feedback as amber status while errors remain alerts', () => {
    const { unmount } = renderInspector({
      selectedItemId: 'server:1',
      validationMessage: 'Compatibility could not be fully verified.',
      validationSeverity: 'unknown',
    })

    const unknownNotice = screen.getByTestId('inspector-validation-message')
    expect(unknownNotice).toHaveAttribute('role', 'status')
    expect(unknownNotice).toHaveAttribute('data-severity', 'unknown')
    expect(unknownNotice).toHaveClass('bg-[#fff8df]')

    unmount()
    renderInspector({
      selectedItemId: 'server:1',
      validationMessage: 'The component is incompatible.',
    })

    const errorNotice = screen.getByTestId('inspector-validation-message')
    expect(errorNotice).toHaveAttribute('role', 'alert')
    expect(errorNotice).toHaveAttribute('data-severity', 'error')
    expect(errorNotice).toHaveClass('bg-[#fff4ee]')
  })
  it.each([
    ['server:1', ['Specs', 'Slots', 'Ports', 'Network', 'Services', 'Agent', 'Compatibility']],
    ['switch:1', ['Specs', 'Ports', 'Connections']],
    ['nas:1', ['Specs', 'Slots', 'Ports', 'Network', 'Agent', 'Compatibility']],
    ['patchPanel:1', ['Specs', 'Ports', 'Connections', 'Network']],
  ] as const)('renders the approved %s tab order', (selectedItemId, labels) => {
    renderInspector({ selectedItemId })

    expect(screen.getAllByRole('tab').slice(0, labels.length).map((tab) => tab.textContent)).toEqual(labels)
  })

  it('explains server compatibility, utilization, allocations, and grouped findings', async () => {
    const user = userEvent.setup()
    renderInspector({ selectedItemId: 'server:1', project: compatibilityProject })

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

  it.each([
    ['server:1', { hostType: 'server', hostId: 1 }],
    ['nas:1', { hostType: 'nas', hostId: 1 }],
  ] as const)('edits %s compatibility fields and disables checks by runtime key', async (
    selectedItemId,
    hostRef,
  ) => {
    const user = userEvent.setup()
    const { onUpdateItem, onUpdateProject } = renderInspector({ selectedItemId })
    const specsPanel = screen.getByRole('tabpanel', { name: 'Specs' })

    expect(within(specsPanel).queryByLabelText('Supported CPU sockets')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Compatibility' }))

    expect(screen.getByLabelText('Supported CPU sockets')).toBeVisible()
    const checkbox = screen.getByRole('checkbox', { name: 'Enable compatibility checks' })
    expect(checkbox).toBeChecked()

    fireEvent.change(screen.getByLabelText('Supported CPU sockets'), {
      target: { value: 'LGA1200' },
    })
    expect(onUpdateItem).not.toHaveBeenCalled()

    await user.click(checkbox)

    expect(onUpdateProject).toHaveBeenCalledWith(expect.objectContaining({
      compatibilityPolicy: expect.objectContaining({ disabledHosts: [hostRef] }),
    }))
  })

  it('keeps host fields editable but hides evaluation findings when checks are disabled', async () => {
    const user = userEvent.setup()
    renderInspector({
      selectedItemId: 'server:1',
      project: {
        ...compatibilityProject,
        compatibilityPolicy: {
          disabledHosts: [{ hostType: 'server', hostId: 1 }],
          ignoredWarningIds: [],
        },
      },
    })

    await user.click(screen.getByRole('tab', { name: 'Compatibility' }))

    expect(screen.getByRole('checkbox', { name: 'Enable compatibility checks' })).not.toBeChecked()
    expect(screen.getByLabelText('Supported CPU sockets')).toBeVisible()
    expect(screen.getByText(
      'Hardware compatibility checks are disabled for this host. Physical limits still apply.',
    )).toBeVisible()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByText('Resource utilization')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Compatibility findings')).not.toBeInTheDocument()
  })

  it('shows NAS compatibility resources without server-only slot assumptions', async () => {
    const user = userEvent.setup()
    renderInspector({ selectedItemId: 'nas:1', project: compatibilityProject })

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

    expect(screen.getAllByText('Typed CPU').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Typed RAM').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Typed storage').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Typed GPU').length).toBeGreaterThan(0)
    expect(screen.queryByText('Colliding NAS')).not.toBeInTheDocument()
  })

  it('edits NAS specs through a complete item payload', async () => {
    vi.useFakeTimers()
    const { onUpdateItem } = renderInspector({ selectedItemId: 'nas:1' })

    expect(screen.getByLabelText('Drive Bays')).toHaveValue(4)
    expect(screen.getByLabelText('M.2 Slots')).toHaveValue(2)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Backup NAS' } })
    fireEvent.change(screen.getByLabelText('Drive Bays'), { target: { value: '6' } })
    await act(async () => vi.advanceTimersByTimeAsync(500))

    expect(onUpdateItem).toHaveBeenCalledWith('nas:1', {
      type: 'nas',
      name: 'Backup NAS',
      manufacturer: 'Synology',
      model: 'DS923+',
      specs: {
        driveBays: 6,
        m2Slots: 2,
        powerConfiguration: 'external-adapter',
      },
      ports: project.items['nas:1'].ports,
    })
  })

  it('limits NAS slots and keeps agent enrollment unavailable', async () => {
    const user = userEvent.setup()
    renderInspector({ selectedItemId: 'nas:1' })

    await user.click(screen.getByRole('tab', { name: 'Slots' }))
    expect(screen.getByText('NAS Slots')).toBeInTheDocument()
    expect(screen.getAllByText('Storage').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Network').length).toBeGreaterThan(0)
    expect(screen.queryByText('CPU')).not.toBeInTheDocument()
    expect(screen.queryByText('RAM')).not.toBeInTheDocument()
    expect(screen.queryByText('GPU')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Agent' }))
    expect(screen.getByText('Agent setup is not available for NAS yet.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Agent endpoint')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Setup Agent' })).not.toBeInTheDocument()
    expect(createAgentEnrollment).not.toHaveBeenCalled()
  })

  it('routes NAS power mode changes through the dedicated transition callback', async () => {
    const user = userEvent.setup()
    const { onRequestNasPowerConfigurationChange, onUpdateItem } = renderInspector({
      selectedItemId: 'nas:1',
    })

    await user.click(screen.getByRole('combobox', { name: 'Power configuration' }))
    await user.click(screen.getByRole('option', { name: 'Internal PSU' }))

    expect(onRequestNasPowerConfigurationChange).toHaveBeenCalledWith(
      project.items['nas:1'],
      'internal-psu',
    )
    expect(onUpdateItem).not.toHaveBeenCalled()
  })

  it('renders storage in the reusable tabbed editor with simplified chrome', async () => {
    const user = userEvent.setup()
    renderInspector({ selectedItemId: 'storage:1' })

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

    await user.click(screen.getByRole('tab', { name: 'Compatibility' }))

    expect(screen.getByLabelText('Capacity')).toHaveValue(1)
    expect(screen.getByRole('combobox', { name: 'Unit' })).toHaveTextContent('TB')
    expect(screen.getByRole('combobox', { name: 'Interface' })).toHaveTextContent('NVMe')
    expect(screen.getByRole('combobox', { name: 'Form Factor' })).toHaveTextContent('2280')
  })

  it('debounces storage text edits and emits the complete item input', async () => {
    vi.useFakeTimers()
    const { onUpdateItem } = renderInspector({ selectedItemId: 'storage:1' })

    fireEvent.change(screen.getByLabelText('Manufacturer'), { target: { value: 'Crucial' } })
    await act(async () => vi.advanceTimersByTimeAsync(499))
    expect(onUpdateItem).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(onUpdateItem).toHaveBeenCalledWith('storage:1', {
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
    const { onUpdateItem } = renderInspector({ selectedItemId: 'gpu:1' })

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
    expect(onUpdateItem).toHaveBeenCalledWith('gpu:1', {
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
    const { onUpdateItem } = renderInspector({ selectedItemId: 'switch:1' })

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

    expect(onUpdateItem).toHaveBeenCalledWith('switch:1', {
      type: 'switch',
      name: 'Core switch',
      manufacturer: 'TP-Link Omada',
      model: 'ES210X-M2',
      specs: {
        management: 'Omada managed',
        switchingCapacityGbps: 60,
        fanless: false,
      },
      ports: project.items['switch:1'].ports,
    })
  })

  it('uses canonical switch management choices while preserving a legacy value', async () => {
    const user = userEvent.setup()
    const { onUpdateItem } = renderInspector({ selectedItemId: 'switch:1' })

    expect(screen.getByRole('combobox', { name: 'Management' })).toHaveTextContent('Omada managed (Legacy)')
    await user.click(screen.getByRole('combobox', { name: 'Management' }))
    expect(screen.getByRole('option', { name: 'Omada managed (Legacy)' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Layer 2 Managed' }))

    expect(onUpdateItem).toHaveBeenCalledWith('switch:1', expect.objectContaining({
      type: 'switch',
      name: 'Omada ES210X-M2 #1',
      specs: expect.objectContaining({ management: 'Layer 2 Managed' }),
      ports: project.items['switch:1'].ports,
    }))
  })

  it('edits switch port groups and individual port details', async () => {
    const user = userEvent.setup()
    const { onUpdateItem, onEndpointConnectionClick } = renderInspector({ selectedItemId: 'switch:1' })

    await user.click(screen.getByRole('tab', { name: 'Ports' }))

    expect(screen.getByRole('heading', { name: 'Ports' })).toBeInTheDocument()
    expect(screen.getByText('Port occupancy')).toBeInTheDocument()
    expect(screen.getAllByText('Open').length).toBeGreaterThan(0)

    fireEvent.change(screen.getByLabelText('Port group 1 count'), {
      target: { value: '4' },
    })

    expect(onUpdateItem).toHaveBeenCalledWith(
      'switch:1',
      expect.objectContaining({
        type: 'switch',
        ports: expect.arrayContaining([
          expect.objectContaining({ id: 1 }),
          expect.objectContaining({ id: 4 }),
        ]),
      }),
    )
    expect(vi.mocked(onUpdateItem).mock.calls[0][1].ports).toHaveLength(4)

    fireEvent.click(screen.getByRole('button', { name: 'Connect Port 1' }))

    expect(onEndpointConnectionClick).toHaveBeenCalledWith({
      itemId: 'switch:1',
      portId: 1,
    })

    fireEvent.change(screen.getByLabelText('Port 1 label'), {
      target: { value: 'Office uplink' },
    })
    await user.click(screen.getByRole('combobox', { name: 'Port 1 role' }))
    await user.click(screen.getByRole('option', { name: 'Uplink' }))

    expect(onUpdateItem).toHaveBeenCalledWith(
      'switch:1',
      expect.objectContaining({
        ports: expect.arrayContaining([
          expect.objectContaining({ id: 1, label: 'Office uplink' }),
        ]),
      }),
    )
    expect(onUpdateItem).toHaveBeenCalledWith(
      'switch:1',
      expect.objectContaining({
        ports: expect.arrayContaining([
          expect.objectContaining({ id: 1, role: 'uplink' }),
        ]),
      }),
    )
  })

  it('requires a supported speed for malformed imported switch network groups', async () => {
    const user = userEvent.setup()
    const originalPorts = project.items['switch:1'].ports
    project.items['switch:1'].ports = originalPorts?.map((port) => ({ ...port, speed: undefined }))

    try {
      const { onUpdateItem } = renderInspector({ selectedItemId: 'switch:1' })

      await user.click(screen.getByRole('tab', { name: 'Ports' }))

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Select a supported speed for this RJ45 switch port group.',
      )

      await user.click(screen.getByRole('combobox', { name: 'Port group 1 speed' }))
      expect(screen.queryByRole('option', { name: 'No speed' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('option', { name: '10G' }))

      expect(onUpdateItem).toHaveBeenCalledWith(
        'switch:1',
        expect.objectContaining({
          ports: expect.arrayContaining([
            expect.objectContaining({ speed: '10G' }),
          ]),
        }),
      )
    } finally {
      project.items['switch:1'].ports = originalPorts
    }
  })

  it('offers only compatible available host endpoints in the connection editor', async () => {
    const user = userEvent.setup()
    const connectionProject: ProjectState = {
      ...project,
      items: {
        ...project.items,
        'server:1': {
          ...project.items['server:1'],
          ports: [
            ...(project.items['server:1'].ports ?? []),
            {
              id: 2,
              kind: 'server-port',
              type: 'displayport',
              slotNumber: 2,
              label: 'Display 01',
            },
          ],
        },
        'network:2': {
          id: 2,
          key: 'network:2',
          name: 'Intel I350-T4',
          type: 'network',
          ports: [
            {
              id: 1,
              kind: 'server-port',
              type: 'rj45',
              slotNumber: 1,
              speed: '1G',
            },
          ],
        },
        'network:3': {
          id: 3,
          key: 'network:3',
          name: 'Loose NIC',
          type: 'network',
          ports: [
            {
              id: 1,
              kind: 'server-port',
              type: 'rj45',
              slotNumber: 1,
              speed: '2.5G',
            },
          ],
        },
        'gpu:1': {
          ...project.items['gpu:1'],
          ports: [
            {
              id: 1,
              kind: 'server-port',
              type: 'displayport',
              slotNumber: 1,
            },
          ],
        },
      },
      placements: [
        { serverId: 'server:1', x: 0, y: 0 },
        { serverId: 'switch:1', x: 400, y: 0 },
        { serverId: 'patchPanel:1', x: 800, y: 0 },
      ],
      assignments: [
        {
          id: 1,
          serverId: 'server:1',
          itemId: 'network:2',
          type: 'network',
          assignedAt: '2026-07-13T00:00:00.000Z',
        },
        {
          id: 2,
          serverId: 'server:1',
          itemId: 'gpu:1',
          type: 'gpu',
          assignedAt: '2026-07-13T00:00:00.000Z',
        },
      ],
      connections: [],
    }

    renderInspector({
      selectedItemId: 'switch:1',
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
    const { onUpdateItem, onEndpointConnectionClick } = renderInspector({ selectedItemId: 'patchPanel:1' })

    await user.click(screen.getByRole('tab', { name: 'Ports' }))
    expect(screen.getByLabelText('Port group 1 count')).toHaveValue(1)
    fireEvent.click(screen.getByRole('button', { name: 'Connect 01 back' }))

    expect(onEndpointConnectionClick).toHaveBeenCalledWith({
      itemId: 'patchPanel:1',
      portId: 1,
      endpointId: 2,
    })

    await user.click(screen.getByRole('combobox', { name: 'Port 1 type' }))
    await user.click(screen.getByRole('option', { name: 'HDMI' }))

    expect(onUpdateItem).toHaveBeenCalledWith('patchPanel:1', expect.objectContaining({
      type: 'patchPanel',
      name: 'VCELINK 24 Port Cat6A Patch Panel',
      specs: { rackUnits: 1 },
      ports: [expect.objectContaining({
        id: 1,
        kind: 'keystone',
        type: 'hdmi',
        slotNumber: 1,
        endpoints: [
          { id: 1, side: 'front' },
          { id: 2, side: 'back' },
        ],
      })],
    }))
  })

  it('edits patch panel labels in the compact grid and port notes in occupancy', async () => {
    const user = userEvent.setup()
    const { onUpdateItem } = renderInspector({ selectedItemId: 'patchPanel:1' })

    await user.click(screen.getByRole('tab', { name: 'Ports' }))

    fireEvent.change(screen.getByLabelText('Keystone 1 label'), {
      target: { value: 'Proxmox 01' },
    })
    await user.type(screen.getByLabelText('Port 1 notes'), 'Rack A short cable')

    expect(onUpdateItem).toHaveBeenCalledWith('patchPanel:1', expect.objectContaining({
      ports: [expect.objectContaining({
        id: 1,
        label: 'Proxmox 01',
      })],
    }))
    expect(onUpdateItem).toHaveBeenCalledWith('patchPanel:1', expect.objectContaining({
      ports: [expect.objectContaining({
        id: 1,
        label: 'Proxmox 01',
        notes: 'Rack A short cable',
      })],
    }))
  })

  it('saves patch panel row order through the complete draft', async () => {
    const user = userEvent.setup()
    const { onUpdateItem } = renderInspector({ selectedItemId: 'patchPanel:1' })

    await user.click(screen.getByRole('tab', { name: 'Ports' }))
    await user.click(screen.getByRole('button', { name: 'Swap Rows' }))

    expect(onUpdateItem).toHaveBeenCalledWith('patchPanel:1', expect.objectContaining({
      type: 'patchPanel',
      properties: { patchPanelRowOrder: 'front-back' },
      ports: project.items['patchPanel:1'].ports,
    }))
  })

  it('renders RAM in the reusable tabbed editor', async () => {
    const user = userEvent.setup()
    renderInspector({ selectedItemId: 'ram:1' })

    expect(screen.getByText('32GB RAM')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Specs' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: 'Ports' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Manufacturer')).toHaveValue('Crucial')

    await user.click(screen.getByRole('tab', { name: 'Compatibility' }))

    expect(screen.getByLabelText('Stick 2 Manufacturer')).toHaveValue('Kingston')
    expect(screen.getByLabelText('Capacity GB')).toHaveValue(32)
    expect(screen.getByRole('combobox', { name: 'Generation' })).toHaveTextContent('DDR4')
    expect(screen.getByRole('combobox', { name: 'Stick 1 Speed' })).toHaveTextContent('3200')
    expect(screen.getByRole('combobox', { name: 'Stick 2 Speed' })).toHaveTextContent('2666')
    expect(screen.queryByText('Server Slots')).not.toBeInTheDocument()
  })

  it('debounces a RAM secondary manufacturer edit into one complete item update', async () => {
    const user = userEvent.setup()
    const { onUpdateItem } = renderInspector({ selectedItemId: 'ram:1' })

    await user.click(screen.getByRole('tab', { name: 'Compatibility' }))
    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText('Stick 2 Manufacturer'), { target: { value: 'Corsair' } })
    await act(async () => vi.advanceTimersByTimeAsync(499))
    expect(onUpdateItem).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(onUpdateItem).toHaveBeenCalledWith('ram:1', {
      type: 'ram',
      name: '32GB RAM',
      manufacturer: 'Crucial',
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
    const { onUpdateItem } = renderInspector({ selectedItemId: 'ram:1' })

    await user.click(screen.getByRole('tab', { name: 'Compatibility' }))
    await user.click(screen.getByRole('combobox', { name: 'Stick 1 Speed' }))
    expect(screen.getByRole('option', { name: '2666' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '3200' })).toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: '2666' }))

    expect(onUpdateItem).toHaveBeenCalledWith('ram:1', expect.objectContaining({
      specs: expect.objectContaining({ speedMt: 2666 }),
    }))
  })

  it('renders RAM stick 2 speed options and emits secondary speed', async () => {
    const user = userEvent.setup()
    const { onUpdateItem } = renderInspector({ selectedItemId: 'ram:1' })

    await user.click(screen.getByRole('tab', { name: 'Compatibility' }))
    await user.click(screen.getByRole('combobox', { name: 'Stick 2 Speed' }))
    await user.click(screen.getByRole('option', { name: '2933' }))

    expect(onUpdateItem).toHaveBeenCalledWith('ram:1', expect.objectContaining({
      specs: expect.objectContaining({ secondarySpeedMt: 2933 }),
    }))
  })

  it('corrects a CPU number after 500ms and preserves unrelated specs', async () => {
    vi.useFakeTimers()
    const { onUpdateItem } = renderInspector({ selectedItemId: 'cpu:1' })

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
    expect(onUpdateItem).toHaveBeenCalledWith('cpu:1', {
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

  it('mounts server slots only while the Slots tab is active', async () => {
    const user = userEvent.setup()
    renderInspector({ selectedItemId: 'cpu:1' })
    expect(screen.queryByText('Server Slots')).not.toBeInTheDocument()

    cleanup()
    renderInspector({ selectedItemId: 'server:1' })

    expect(screen.queryByText('Server Slots')).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Slots' }))
    expect(screen.getByText('Server Slots')).toBeInTheDocument()
    expect(screen.getAllByText('Dell OptiPlex Micro 7090').length).toBeGreaterThan(0)
  })

  it('renders shared server fields and emits a complete debounced update', async () => {
    vi.useFakeTimers()
    const { onUpdateItem } = renderInspector({ selectedItemId: 'server:1' })

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

    expect(onUpdateItem).toHaveBeenCalledWith('server:1', {
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
      ports: project.items['server:1'].ports,
    })
  })

  it('merges a pending display name into an immediate board port IP update', async () => {
    const user = userEvent.setup()
    const { onUpdateItem } = renderInspector({ selectedItemId: 'server:1' })

    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'Proxmox pending' },
    })
    await user.click(screen.getByRole('tab', { name: 'Network' }))
    fireEvent.change(screen.getByLabelText('Port 1 IP address'), {
      target: { value: '192.168.1.55' },
    })

    expect(onUpdateItem).toHaveBeenCalledTimes(1)
    expect(onUpdateItem).toHaveBeenCalledWith('server:1', expect.objectContaining({
      properties: expect.objectContaining({ displayName: 'Proxmox pending' }),
      ports: [expect.objectContaining({
        id: 1,
        ipAddress: '192.168.1.55',
      })],
    }))

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 550))
    })
    expect(onUpdateItem).toHaveBeenCalledTimes(1)
  })

  it('saves a hosted NIC IP separately without overwriting the server draft', async () => {
    const user = userEvent.setup()
    const hostedNicProject: ProjectState = {
      ...project,
      items: {
        ...project.items,
        'network:2': {
          id: 2,
          key: 'network:2',
          name: 'Intel I350-T4',
          type: 'network',
          manufacturer: 'Intel',
          specs: {
            interface: 'PCIe 3.0 x4',
            formFactor: 'Low profile',
          },
          ports: [
            {
              id: 1,
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
          id: 3,
          serverId: 'server:1',
          itemId: 'network:2',
          type: 'network',
          assignedAt: '2026-07-13T00:00:00.000Z',
        },
      ],
    }
    const { onUpdateItem } = renderInspector({
      selectedItemId: 'server:1',
      project: hostedNicProject,
    })

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Pending server name' },
    })
    await user.click(screen.getByRole('tab', { name: 'Network' }))
    const interfaceTabs = screen.getAllByRole('tab', { name: 'RJ4501' })
    const hostedInterfaceTab = interfaceTabs.find((tab) => tab.id.includes('network:2'))
    expect(hostedInterfaceTab).toBeDefined()
    await user.click(hostedInterfaceTab!)
    expect(screen.getByText('Intel I350-T4 / RJ45 1G')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Port 1 IP address'), {
      target: { value: '10.0.0.15' },
    })

    expect(onUpdateItem).toHaveBeenCalledTimes(1)
    expect(onUpdateItem).toHaveBeenLastCalledWith('network:2', {
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
        id: 1,
        ipAddress: '10.0.0.15',
      })],
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 550))
    })
    expect(onUpdateItem).toHaveBeenCalledTimes(2)
    expect(onUpdateItem).toHaveBeenLastCalledWith('server:1', expect.objectContaining({
      name: 'Pending server name',
      properties: expect.objectContaining({ displayName: 'Proxmox 01' }),
    }))
  })

  it('renders agent operational telemetry for a selected server', async () => {
    const user = userEvent.setup()
    renderInspector({
      selectedItemId: 'server:1',
      agentStatus: {
        registeredServerIds: [1],
        servers: {
          1: {
            serverId: 1,
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

    await user.click(screen.getByRole('tab', { name: 'Agent' }))

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
      selectedItemId: 'server:1',
      agentStatus: {
        registeredServerIds: [1],
        servers: {
          1: {
            serverId: 1,
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
      expect(revokeAgentRegistration).toHaveBeenCalledWith(1)
    })
    expect(screen.getByRole('button', { name: 'Clear Saved Telemetry' })).toBeDisabled()
  })

  it('allows saved telemetry to be cleared after registration is revoked', async () => {
    const user = userEvent.setup()
    vi.mocked(clearAgentStatus).mockResolvedValue({ servers: {}, registeredServerIds: [] })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderInspector({
      selectedItemId: 'server:1',
      agentStatus: {
        registeredServerIds: [],
        servers: {
          1: {
            serverId: 1,
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
      expect(clearAgentStatus).toHaveBeenCalledWith(1)
    })
    expect(screen.queryByRole('button', { name: 'Revoke Registration' })).not.toBeInTheDocument()
  })

  it('explains that agent setup is unavailable in demo mode', async () => {
    const user = userEvent.setup()
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
          selectedItemId="server:1"
          selectedConnectionId={null}
          activeNetworkTraceKey={null}
          pendingConnectionEndpoint={null}
          validationMessage={null}
          persistenceWarning={null}
          open
          onClose={() => {}}
          onUpdateProject={vi.fn()}
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

    await user.click(screen.getByRole('tab', { name: 'Agent' }))
    expect(screen.getByText('Agent setup is disabled in public demo mode.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Agent endpoint')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Setup Agent' })).not.toBeInTheDocument()
  })

  it('does not render server audit warnings for unplanned open LAN ports', () => {
    renderInspector({ selectedItemId: 'server:1' })

    expect(screen.queryByText('LAN port 01 is open.')).not.toBeInTheDocument()
  })

  it('keeps ignored warnings visible in the Inspector while excluding them from its open count', async () => {
    const user = userEvent.setup()
    const warningId = 'switch-no-uplink-trunk-1'
    const warningMessage = 'Switch has active connections but no uplink or trunk port marked.'
    const auditProject: ProjectState = {
      ...project,
      connections: [{
        id: 1,
        from: { itemId: 'switch:1', portId: 1 },
        to: { itemId: 'server:1', portId: 1 },
        type: 'network',
        createdAt: '2026-07-22T00:00:00.000Z',
      }],
      compatibilityPolicy: { disabledHosts: [], ignoredWarningIds: [] },
    }
    const onSetWarningIgnored = vi.fn()

    renderInspector({
      selectedItemId: 'switch:1',
      project: auditProject,
      onSetWarningIgnored,
    })

    expect(screen.getByText(warningMessage).closest('[data-ignored]')).toHaveAttribute('data-ignored', 'false')
    expect(screen.getByTestId('inspector-audit-open-count')).toHaveTextContent('1')
    await user.click(screen.getByRole('button', { name: 'Ignore' }))
    expect(onSetWarningIgnored).toHaveBeenCalledWith(warningId, true)

    cleanup()
    onSetWarningIgnored.mockClear()
    renderInspector({
      selectedItemId: 'switch:1',
      project: {
        ...auditProject,
        compatibilityPolicy: { disabledHosts: [], ignoredWarningIds: [warningId] },
      },
      onSetWarningIgnored,
    })

    expect(screen.getByText(warningMessage).closest('[data-ignored]')).toHaveAttribute('data-ignored', 'true')
    expect(screen.getByTestId('inspector-audit-open-count')).toHaveTextContent('0')
    await user.click(screen.getByRole('button', { name: 'Unignore' }))
    expect(onSetWarningIgnored).toHaveBeenCalledWith(warningId, false)
  })

  it('renders selected cable details, controls overlap avoidance, and removes the cable', async () => {
    const user = userEvent.setup()
    const onRemoveConnection = vi.fn()
    const onUpdateConnectionRoute = vi.fn()
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
          id: 1,
          type: 'network',
          negotiatedSpeedMbps: 1000,
          createdAt: '2026-06-26T00:00:00.000Z',
          from: { itemId: 'server:1', portId: 1 },
          to: { itemId: 'patchPanel:1', portId: 1, endpointId: 2 },
          route: { bendPoints: [{ x: 120, y: 240 }, { x: 360, y: 240 }] },
        },
      ],
    }

    render(
      <QueryClientProvider client={queryClient}>
        <InspectorPanel
          project={projectWithConnection}
          agentStatus={{ servers: {}, registeredServerIds: [] }}
          selectedItemId={null}
          selectedConnectionId={1}
          activeNetworkTraceKey={null}
          pendingConnectionEndpoint={null}
          validationMessage={null}
          persistenceWarning={null}
          open
          onClose={() => {}}
          onUpdateProject={vi.fn()}
          onUpdateItem={vi.fn()}
          onCreateConnection={vi.fn()}
          onSelectNetworkTrace={vi.fn()}
          onEndpointConnectionClick={vi.fn()}
          onCancelPendingConnection={vi.fn()}
          onUpdateConnectionLabel={vi.fn()}
          onUpdateConnectionRoute={onUpdateConnectionRoute}
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
    const avoidOtherCables = screen.getByRole('switch', { name: 'Avoid other cables' })
    expect(avoidOtherCables).not.toBeChecked()
    expect(screen.getByText('Bend 1')).toBeInTheDocument()
    expect(screen.getByText('120, 240')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove bend 1' }))
    expect(onUpdateConnectionRoute).toHaveBeenCalledWith(1, {
      bendPoints: [{ x: 360, y: 240 }],
    })

    await user.click(avoidOtherCables)
    expect(onUpdateConnectionRoute).toHaveBeenCalledWith(1, {
      bendPoints: [{ x: 120, y: 240 }, { x: 360, y: 240 }],
      avoidCableOverlap: true,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Remove Cable' }))

    expect(onRemoveConnection).toHaveBeenCalledWith(1)
  })
})
