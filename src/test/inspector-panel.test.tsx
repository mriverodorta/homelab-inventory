import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InspectorPanel } from '@/components/inspector-panel'
import type { AgentStatusSummary } from '@/types/agent'
import type { ProjectState } from '@/types/inventory'

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
  },
  placements: [{ serverId: 'server', x: 0, y: 0 }],
  assignments: [],
  connections: [],
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

type InspectorPanelProps = ComponentProps<typeof InspectorPanel>

type RenderInspectorOptions = Partial<Pick<InspectorPanelProps,
  | 'onUpdateItem'
  | 'onUpdateServerIdentity'
  | 'onUpdateServerSpecs'
  | 'onUpdateServerProperties'
  | 'onUpdateItemIdentity'
  | 'onUpdateItemSpecs'
  | 'onUpdateItemProperties'
  | 'onUpdateItemPorts'
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
}

function renderInspector({
  selectedItemId = null,
  selectedConnectionId = null,
  agentStatus = { servers: {}, registeredServerIds: [] },
  project: projectOverride = project,
  demoMode = false,
  onUpdateItem = vi.fn(),
  onUpdateServerIdentity = vi.fn(),
  onUpdateServerSpecs = vi.fn(),
  onUpdateServerProperties = vi.fn(),
  onUpdateItemIdentity = vi.fn(),
  onUpdateItemSpecs = vi.fn(),
  onUpdateItemProperties = vi.fn(),
  onUpdateItemPorts = vi.fn(),
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

  render(
    <QueryClientProvider client={queryClient}>
      <InspectorPanel
        project={projectOverride}
        agentStatus={agentStatus}
        demoMode={demoMode}
        selectedItemId={selectedItemId}
        selectedConnectionId={selectedConnectionId}
        activeNetworkTraceKey={null}
        pendingConnectionEndpoint={null}
        validationMessage={null}
        persistenceWarning={null}
        open
        onClose={() => {}}
        onUpdateServerIdentity={onUpdateServerIdentity}
        onUpdateServerSpecs={onUpdateServerSpecs}
        onUpdateServerProperties={onUpdateServerProperties}
        onUpdateItem={onUpdateItem}
        onUpdateItemIdentity={onUpdateItemIdentity}
        onUpdateItemSpecs={onUpdateItemSpecs}
        onUpdateItemProperties={onUpdateItemProperties}
        onUpdateItemPorts={onUpdateItemPorts}
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
    onUpdateItem,
    onUpdateServerIdentity,
    onUpdateServerSpecs,
    onUpdateServerProperties,
    onUpdateItemIdentity,
    onUpdateItemSpecs,
    onUpdateItemProperties,
    onUpdateItemPorts,
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

  it('renders editable switch details and emits identity and spec updates', async () => {
    const user = userEvent.setup()
    const { onUpdateItemIdentity, onUpdateItemSpecs } = renderInspector({ selectedItemId: 'switch' })

    expect(screen.getByRole('tab', { name: 'Specs' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Switching capacity (Gbps)')).toHaveValue(80)
    expect(screen.getByRole('combobox', { name: 'Switch cooling' })).toHaveTextContent('Fanless')

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Core switch' },
    })
    fireEvent.change(screen.getByLabelText('Switching capacity (Gbps)'), {
      target: { value: '60' },
    })
    await user.click(screen.getByRole('combobox', { name: 'Switch cooling' }))
    await user.click(screen.getByRole('option', { name: 'Active cooling' }))

    expect(onUpdateItemIdentity).toHaveBeenCalledWith('switch', { name: 'Core switch' })
    expect(onUpdateItemSpecs).toHaveBeenCalledWith('switch', { switchingCapacityGbps: 60 })
    expect(onUpdateItemSpecs).toHaveBeenCalledWith('switch', { fanless: false })
  })

  it('edits switch port groups and individual port details', async () => {
    const user = userEvent.setup()
    const { onUpdateItemPorts, onEndpointConnectionClick } = renderInspector({ selectedItemId: 'switch' })

    await user.click(screen.getByRole('tab', { name: 'Ports' }))

    expect(screen.getByText('Port Groups')).toBeInTheDocument()
    expect(screen.getByText('Port occupancy')).toBeInTheDocument()
    expect(screen.getByText('RJ45 2.5G')).toBeInTheDocument()
    expect(screen.getAllByText('Open').length).toBeGreaterThan(0)

    fireEvent.change(screen.getByLabelText('RJ45 2.5G port count'), {
      target: { value: '4' },
    })
    fireEvent.blur(screen.getByLabelText('RJ45 2.5G port count'))

    expect(onUpdateItemPorts).toHaveBeenCalledWith(
      'switch',
      expect.arrayContaining([
        expect.objectContaining({ id: 'rj45-01' }),
        expect.objectContaining({ id: 'rj45-04' }),
      ]),
    )
    expect(vi.mocked(onUpdateItemPorts).mock.calls[0][1]).toHaveLength(4)

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

    expect(onUpdateItemPorts).toHaveBeenCalledWith(
      'switch',
      expect.arrayContaining([
        expect.objectContaining({ id: 'rj45-01', label: 'Office uplink' }),
      ]),
    )
    expect(onUpdateItemPorts).toHaveBeenCalledWith(
      'switch',
      expect.arrayContaining([
        expect.objectContaining({ id: 'rj45-01', role: 'uplink' }),
      ]),
    )
  })

  it('requires a supported speed for malformed imported switch network groups', async () => {
    const user = userEvent.setup()
    const originalPorts = project.items.switch.ports
    project.items.switch.ports = originalPorts?.map((port) => ({ ...port, speed: undefined }))

    try {
      const { onUpdateItemPorts } = renderInspector({ selectedItemId: 'switch' })

      await user.click(screen.getByRole('tab', { name: 'Ports' }))

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Select a supported speed for this RJ45 switch port group.',
      )

      await user.click(screen.getByRole('combobox', { name: 'RJ45 port group speed' }))
      expect(screen.queryByRole('option', { name: 'No speed' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('option', { name: '10G' }))

      expect(onUpdateItemPorts).toHaveBeenCalledWith(
        'switch',
        expect.arrayContaining([
          expect.objectContaining({ speed: '10G' }),
        ]),
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
    const { onUpdateItemPorts, onEndpointConnectionClick } = renderInspector({ selectedItemId: 'patch' })

    expect(screen.getByText('1x RJ45')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Connect 01 back' }))

    expect(onEndpointConnectionClick).toHaveBeenCalledWith({
      itemId: 'patch',
      portId: 'keystone-01',
      endpointId: 'keystone-01-back',
    })

    await user.click(screen.getByRole('combobox', { name: 'Port 1 type' }))
    await user.click(screen.getByRole('option', { name: 'HDMI' }))

    expect(onUpdateItemPorts).toHaveBeenCalledWith('patch', [
      {
        id: 'keystone-01',
        kind: 'keystone',
        type: 'hdmi',
        slotNumber: 1,
        endpoints: [
          { id: 'keystone-01-front', side: 'front' },
          { id: 'keystone-01-back', side: 'back' },
        ],
      },
    ])
  })

  it('edits patch panel labels in the compact grid and port notes in occupancy', () => {
    const { onUpdateItemPorts } = renderInspector({ selectedItemId: 'patch' })

    fireEvent.change(screen.getByLabelText('Keystone 1 label'), {
      target: { value: 'Proxmox 01' },
    })
    fireEvent.change(screen.getByLabelText('Port 1 notes'), {
      target: { value: 'Rack A short cable' },
    })

    expect(onUpdateItemPorts).toHaveBeenCalledWith('patch', [
      expect.objectContaining({
        id: 'keystone-01',
        label: 'Proxmox 01',
      }),
    ])
    expect(onUpdateItemPorts).toHaveBeenCalledWith('patch', [
      expect.objectContaining({
        id: 'keystone-01',
        notes: 'Rack A short cable',
      }),
    ])
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

  it('renders editable server properties and emits updates on keystrokes', () => {
    const {
      onUpdateServerIdentity,
      onUpdateServerProperties,
    } = renderInspector({ selectedItemId: 'server' })

    const inventoryNameInput = screen.getByLabelText('Inventory name')
    const displayNameInput = screen.getByLabelText('Display name')
    const manufacturerInput = screen.getByLabelText('Manufacturer')

    expect(inventoryNameInput).toHaveValue('Dell OptiPlex Micro 7090')
    expect(displayNameInput).toHaveValue('Proxmox 01')
    expect(manufacturerInput).toHaveValue('Dell')
    expect(screen.queryByLabelText('LAN IP')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Tailscale IP')).not.toBeInTheDocument()

    fireEvent.change(displayNameInput, { target: { value: 'Proxmox 02' } })
    fireEvent.change(manufacturerInput, { target: { value: 'HP' } })

    expect(onUpdateServerProperties).toHaveBeenCalledWith('server', {
      displayName: 'Proxmox 02',
    })
    expect(onUpdateServerIdentity).toHaveBeenCalledWith('server', {
      manufacturer: 'HP',
    })
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
          onUpdateServerIdentity={vi.fn()}
          onUpdateServerSpecs={vi.fn()}
          onUpdateServerProperties={vi.fn()}
          onUpdateItem={vi.fn()}
          onUpdateItemIdentity={vi.fn()}
          onUpdateItemSpecs={vi.fn()}
          onUpdateItemProperties={vi.fn()}
          onUpdateItemPorts={vi.fn()}
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
          onUpdateServerIdentity={vi.fn()}
          onUpdateServerSpecs={vi.fn()}
          onUpdateServerProperties={vi.fn()}
          onUpdateItem={vi.fn()}
          onUpdateItemIdentity={vi.fn()}
          onUpdateItemSpecs={vi.fn()}
          onUpdateItemProperties={vi.fn()}
          onUpdateItemPorts={vi.fn()}
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
