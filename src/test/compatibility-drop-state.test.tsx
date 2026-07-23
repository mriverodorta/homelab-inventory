import { render } from '@testing-library/react'
import type { NodeProps } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { getEndpointHandleId } from '@/lib/cable-routing'
import { buildCanvasProjectIndex } from '@/lib/canvas-project-index'
import { NasNode, type NasFlowNode } from '@/components/nas-card'
import { ServerNode, type ServerFlowNode } from '@/components/server-card'
import {
  CompatibilityDropAnnouncement,
  getComponentDropCompatibilityStatus,
  type ComponentDragData,
} from '@/components/workbench-canvas'
import type { ComponentAssignment, InventoryItem, ProjectState } from '@/types/inventory'

vi.mock('@dnd-kit/core', () => ({
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    isDragging: false,
  }),
  useDroppable: () => ({
    setNodeRef: vi.fn(),
    isOver: true,
  }),
}))

vi.mock('@xyflow/react', () => ({
  Handle: ({ id }: { id: string }) => <span data-testid={`handle-${id}`} />,
  Position: {
    Left: 'left',
    Right: 'right',
    Top: 'top',
    Bottom: 'bottom',
  },
}))

function host(
  key: string,
  type: 'server' | 'nas' = 'server',
  sockets: string[] = ['LGA1200'],
): InventoryItem {
  return {
    id: Number(key.split(':')[1]),
    key,
    name: key,
    type,
    ...(type === 'nas'
      ? { specs: { powerConfiguration: 'internal-psu' } }
      : {}),
    compatibility: {
      host: {
        cpu: { sockets, generations: ['10'], maxTdpWatts: 65 },
        memory: { generations: ['DDR4'], slots: 2, maxCapacityGb: 64 },
      },
    },
  }
}

function cpu(key: string, socket?: string): InventoryItem {
  return {
    id: Number(key.split(':')[1]),
    key,
    name: key,
    type: 'cpu',
    compatibility: {
      requirements: {
        cpu: { socket, generation: '10', tdpWatts: 35 },
      },
    },
  }
}

function storage(key: string): InventoryItem {
  return {
    id: Number(key.split(':')[1]),
    key,
    name: key,
    type: 'storage',
  }
}

function assignment(
  id: number,
  serverId: string,
  item: InventoryItem,
): ComponentAssignment {
  return {
    id,
    serverId,
    itemId: item.key!,
    type: item.type as ComponentAssignment['type'],
    assignedAt: '2026-07-19T12:00:00.000Z',
  }
}

function project(
  hosts: InventoryItem[],
  components: InventoryItem[] = [],
  assignments: ComponentAssignment[] = [],
): ProjectState {
  return {
    id: 'default',
    metadata: {
      name: 'Drop compatibility',
      version: 1,
      updatedAt: '2026-07-19T00:00:00.000Z',
    },
    items: Object.fromEntries([...hosts, ...components].map((item) => [item.key!, item])),
    placements: hosts.map((item, index) => ({ serverId: item.key!, x: index * 360, y: 0 })),
    assignments,
    connections: [],
  }
}

function nodeData(
  currentProject: ProjectState,
  itemId: string,
  dropCompatibilityStatus?: 'compatible' | 'incompatible' | 'unknown',
): ServerFlowNode['data'] & NasFlowNode['data'] {
  return {
    project: currentProject,
    canvasIndex: buildCanvasProjectIndex(currentProject),
    requiredHandleIds: new Set<string>(),
    itemId,
    serverId: itemId,
    agentStatus: null,
    selectedItemId: null,
    focusedItemIds: [],
    focusActive: false,
    spotlightItemId: null,
    pendingEndpoint: null,
    draggingEndpoint: null,
    dropCompatibilityStatus,
    onSelect: vi.fn(),
    onRemoveAssignment: vi.fn(),
    onEndpointClick: vi.fn(),
    onEndpointDragStart: vi.fn(),
    onEndpointDrop: vi.fn(),
  }
}

const baseNodeProps = {
  dragging: false,
  zIndex: 0,
  selectable: true,
  deletable: true,
  selected: false,
  draggable: true,
  isConnectable: true,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
}

function serverNodeProps(data: ServerFlowNode['data']): NodeProps<ServerFlowNode> {
  return {
    ...baseNodeProps,
    id: data.serverId,
    type: 'server',
    data,
  }
}

function nasNodeProps(data: NasFlowNode['data']): NodeProps<NasFlowNode> {
  return {
    ...baseNodeProps,
    id: data.itemId,
    type: 'nas',
    data,
  }
}

describe('compatibility drop-state evaluation', () => {
  it('classifies compatible, incompatible, and unknown inventory component drops', () => {
    const server = host('server:1')
    const compatible = cpu('cpu:1', 'LGA1200')
    const incompatible = cpu('cpu:2', 'AM5')
    const unknown = cpu('cpu:3')
    const currentProject = project([server], [compatible, incompatible, unknown])

    expect(getComponentDropCompatibilityStatus(currentProject, {
      kind: 'inventory',
      itemId: compatible.key!,
    }, server.key!)).toBe('compatible')
    expect(getComponentDropCompatibilityStatus(currentProject, {
      kind: 'inventory',
      itemId: incompatible.key!,
    }, server.key!)).toBe('incompatible')
    expect(getComponentDropCompatibilityStatus(currentProject, {
      kind: 'inventory',
      itemId: unknown.key!,
    }, server.key!)).toBe('unknown')
  })

  it('resolves assigned drags by assignment ID and treats same-host drops as compatible no-ops', () => {
    const server = host('server:1')
    const component = cpu('cpu:1', 'LGA1200')
    const attached = assignment(7, server.key!, component)
    const currentProject = project([server], [component], [attached])
    const stalePayload: ComponentDragData = {
      kind: 'assigned-component',
      assignmentId: '7',
      itemId: 'cpu:999',
      sourceServerId: 'server:999',
    }

    expect(getComponentDropCompatibilityStatus(currentProject, stalePayload, server.key!))
      .toBe('compatible')
    expect(getComponentDropCompatibilityStatus(currentProject, {
      ...stalePayload,
      assignmentId: 'missing-assignment',
    }, server.key!)).toBe('incompatible')
  })

  it('rejects an archived assigned component on its current host', () => {
    const server = host('server:1')
    const component = {
      ...cpu('cpu:1', 'LGA1200'),
      archivedAt: '2026-07-19T12:00:00.000Z',
    }
    const attached = assignment(7, server.key!, component)
    const currentProject = project([server], [component], [attached])

    expect(getComponentDropCompatibilityStatus(currentProject, {
      kind: 'assigned-component',
      assignmentId: attached.id,
      itemId: component.key!,
      sourceServerId: server.key!,
    }, server.key!)).toBe('incompatible')
  })

  it('rejects assigned drags whose component item is missing', () => {
    const source = host('server:1')
    const target = host('server:2')
    const missing = cpu('cpu:1', 'LGA1200')
    const attached = assignment(7, source.key!, missing)
    const currentProject = project([source, target], [], [attached])

    expect(getComponentDropCompatibilityStatus(currentProject, {
      kind: 'assigned-component',
      assignmentId: attached.id,
      itemId: missing.key!,
      sourceServerId: source.key!,
    }, target.key!)).toBe('incompatible')
  })

  it('rejects assigned drags onto an archived target host', () => {
    const source = host('server:1')
    const target = {
      ...host('server:2'),
      archivedAt: '2026-07-19T12:00:00.000Z',
    }
    const component = cpu('cpu:1', 'LGA1200')
    const attached = assignment(7, source.key!, component)
    const currentProject = project([source, target], [component], [attached])

    expect(getComponentDropCompatibilityStatus(currentProject, {
      kind: 'assigned-component',
      assignmentId: attached.id,
      itemId: component.key!,
      sourceServerId: source.key!,
    }, target.key!)).toBe('incompatible')
  })

  it('defers inventory-drop geometry checks to the domain worker', () => {
    const target = host('server:1')
    const neighbor = host('server:2')
    const installed = storage('storage:1')
    const candidate = storage('storage:2')
    const currentProject = project(
      [target, neighbor],
      [installed, candidate],
      [assignment(1, target.key!, installed)],
    )
    currentProject.placements = [
      { serverId: target.key!, x: 0, y: 0 },
      { serverId: neighbor.key!, x: 0, y: 300 },
    ]

    expect(getComponentDropCompatibilityStatus(currentProject, {
      kind: 'inventory',
      itemId: candidate.key!,
    }, target.key!)).toBe('unknown')
  })

  it('defers assigned-drop geometry checks to the domain worker', () => {
    const source = host('server:1')
    const target = host('server:2')
    const neighbor = host('server:3')
    const moving = storage('storage:1')
    const installed = storage('storage:2')
    const movingAssignment = assignment(1, source.key!, moving)
    const currentProject = project(
      [source, target, neighbor],
      [moving, installed],
      [movingAssignment, assignment(2, target.key!, installed)],
    )
    currentProject.placements = [
      { serverId: source.key!, x: 400, y: 0 },
      { serverId: target.key!, x: 0, y: 0 },
      { serverId: neighbor.key!, x: 0, y: 300 },
    ]

    expect(getComponentDropCompatibilityStatus(currentProject, {
      kind: 'assigned-component',
      assignmentId: movingAssignment.id,
      itemId: moving.key!,
      sourceServerId: source.key!,
    }, target.key!)).toBe('unknown')
  })

  it('evaluates the complete occupied CPU swap across both hosts', () => {
    const source = host('server:1', 'server', ['LGA1200'])
    const target = host('server:2', 'server', ['AM5'])
    const intel = cpu('cpu:1', 'LGA1200')
    const amd = cpu('cpu:2', 'AM5')
    const currentProject = project(
      [source, target],
      [intel, amd],
      [assignment(1, source.key!, intel), assignment(2, target.key!, amd)],
    )

    expect(getComponentDropCompatibilityStatus(currentProject, {
      kind: 'assigned-component',
      assignmentId: 1,
      itemId: amd.key!,
      sourceServerId: target.key!,
    }, target.key!)).toBe('incompatible')
  })

  it.each([
    ['server', 'server:2'],
    ['pcBuild', 'pcBuild:1'],
    ['monitor', 'monitor:1'],
    ['ups', 'ups:1'],
    ['powerStrip', 'powerStrip:1'],
    ['switch', 'switch:1'],
    ['patchPanel', 'patchPanel:1'],
    ['nas', 'nas:1'],
  ] as const)('does not activate compatibility feedback for %s canvas inventory items', (type, key) => {
    const server = host('server:1')
    const canvasItem: InventoryItem = type === 'server' || type === 'nas'
      ? host(key, type)
      : {
          id: Number(key.split(':')[1]),
          key,
          name: key,
          type,
        }
    const currentProject = project([server], [canvasItem])

    expect(getComponentDropCompatibilityStatus(currentProject, {
      kind: 'inventory',
      itemId: canvasItem.key!,
    }, server.key!)).toBeNull()
  })

  it.each([
    ['archived component', (server: InventoryItem, component: InventoryItem) => project(
      [server],
      [{ ...component, archivedAt: '2026-07-19T12:00:00.000Z' }],
    ), 'server:1'],
    ['occupied single-item slot', (server: InventoryItem, component: InventoryItem) => {
      const installed = cpu('cpu:2', 'LGA1200')
      return project([server], [component, installed], [assignment(1, server.key!, installed)])
    }, 'server:1'],
    ['invalid host type', (server: InventoryItem, component: InventoryItem) => {
      const invalidHost: InventoryItem = { id: 1, key: 'switch:1', name: 'Switch', type: 'switch' }
      return project([server], [component, invalidHost])
    }, 'switch:1'],
  ] as const)('maps the legacy %s failure to incompatible', (_, makeProject, targetHostId) => {
    const server = host('server:1')
    const component = cpu('cpu:1', 'LGA1200')
    const currentProject = makeProject(server, component)

    expect(getComponentDropCompatibilityStatus(currentProject, {
      kind: 'inventory',
      itemId: component.key!,
    }, targetHostId)).toBe('incompatible')
  })
})

describe('host card compatibility drop-state styling', () => {
  it('renders an assigned server power adapter with power styling and its hosted AC endpoint', () => {
    const server = host('server:1')
    const adapter: InventoryItem = {
      id: 1,
      key: 'powerAdapter:1',
      type: 'powerAdapter',
      name: 'Dell 130W',
      specs: { wattageWatts: 130, connector: 'Slim tip' },
      ports: [{
        id: 7,
        key: 'ac-input',
        kind: 'power-port',
        type: 'ac-input',
        slotNumber: 1,
        label: 'AC input',
      }],
    }
    const currentProject = project(
      [server],
      [adapter],
      [assignment(1, server.key!, adapter)],
    )
    const endpoint = { itemId: server.key!, hostedItemId: adapter.key!, portId: 7 }
    const node = nodeData(currentProject, server.key!)
    const handleId = getEndpointHandleId('target', 'left', endpoint)
    node.requiredHandleIds = new Set([handleId])

    const { container } = render(<ServerNode {...serverNodeProps(node)} />)
    const row = container.querySelector('[data-testid="assigned-power-adapter-row"]')

    expect(row).toHaveClass('bg-[#4a3928]', 'text-[#fff8ec]')
    expect(row).toHaveTextContent('Dell 130W')
    expect(row).toHaveTextContent('AC')
    expect(row).toHaveTextContent('01')
    expect(container.querySelector(`[data-testid="handle-${handleId}"]`)).toBeInTheDocument()
  })

  it('renders exactly one NAS power representation for each mode', () => {
    const internal = {
      ...host('nas:1', 'nas'),
      ports: [{
        id: 1,
        key: 'ac-input',
        kind: 'power-port' as const,
        type: 'ac-input' as const,
        slotNumber: 1,
      }],
    }
    const external = {
      ...host('nas:2', 'nas'),
      specs: { powerConfiguration: 'external-adapter' },
      ports: [],
    }

    const internalRender = render(
      <NasNode {...nasNodeProps(nodeData(project([internal]), internal.key!))} />,
    )
    const externalRender = render(
      <NasNode {...nasNodeProps(nodeData(project([external]), external.key!))} />,
    )

    expect(internalRender.container.querySelector('[data-testid="nas-internal-power-port"]')).toBeInTheDocument()
    expect(internalRender.container.querySelector('[data-testid="nas-power-adapter-slot"]')).not.toBeInTheDocument()
    expect(externalRender.container.querySelector('[data-testid="nas-power-adapter-slot"]')).toHaveTextContent('Empty')
    expect(externalRender.container.querySelector('[data-testid="nas-internal-power-port"]')).not.toBeInTheDocument()
  })

  it('uses the shared power row for an assigned external NAS adapter', () => {
    const nas = {
      ...host('nas:1', 'nas'),
      specs: { powerConfiguration: 'external-adapter' },
    }
    const adapter: InventoryItem = {
      id: 2,
      key: 'powerAdapter:2',
      type: 'powerAdapter',
      name: 'NAS 90W',
      ports: [{
        id: 3,
        key: 'ac-input',
        kind: 'power-port',
        type: 'ac-input',
        slotNumber: 1,
      }],
    }
    const currentProject = project(
      [nas],
      [adapter],
      [assignment(2, nas.key!, adapter)],
    )

    const { container } = render(<NasNode {...nasNodeProps(nodeData(currentProject, nas.key!))} />)
    const row = container.querySelector('[data-testid="assigned-power-adapter-row"]')

    expect(row).toHaveClass('bg-[#4a3928]', 'text-[#fff8ec]')
    expect(row).toHaveTextContent('NAS 90W')
    expect(row).toHaveTextContent('AC')
    expect(row).toHaveTextContent('01')
  })

  it.each([
    ['compatible', 'ring-[#ddb668]'],
    ['incompatible', 'ring-[#c85b4a]'],
    ['unknown', 'ring-[#d49a32]'],
  ] as const)('renders the server %s inset ring without changing geometry', (status, tone) => {
    const server = host('server:1')
    const currentProject = project([server])
    const { container } = render(
      <ServerNode {...serverNodeProps(nodeData(currentProject, server.key!, status))} />,
    )
    const card = container.querySelector(`[data-compatibility-drop="${status}"]`)

    expect(card).toHaveClass('ring-2', 'ring-inset', tone)
  })

  it('renders the NAS unknown inset ring', () => {
    const nas = host('nas:1', 'nas')
    const currentProject = project([nas])
    const { container } = render(
      <NasNode {...nasNodeProps(nodeData(currentProject, nas.key!, 'unknown'))} />,
    )
    const card = container.querySelector('[data-compatibility-drop="unknown"]')

    expect(card).toHaveClass('ring-2', 'ring-inset', 'ring-[#d49a32]')
  })

  it('leaves server and NAS cards without a compatibility state when no component is active', () => {
    const server = host('server:1')
    const nas = host('nas:1', 'nas')
    const currentProject = project([server, nas])
    const serverRender = render(
      <ServerNode {...serverNodeProps(nodeData(currentProject, server.key!))} />,
    )
    const nasRender = render(
      <NasNode {...nasNodeProps(nodeData(currentProject, nas.key!))} />,
    )

    expect(serverRender.container.querySelector('[data-compatibility-drop]')).toBeNull()
    expect(nasRender.container.querySelector('[data-compatibility-drop]')).toBeNull()
    expect(serverRender.container.firstElementChild).toHaveClass('border-[#ddb668]')
    expect(nasRender.container.firstElementChild).toHaveClass('border-[#ddb668]')
  })
})

describe('compatibility drop-state announcements', () => {
  it('politely announces the hovered host and compatibility state without visible content', () => {
    const { container } = render(
      <CompatibilityDropAnnouncement
        hostName="Build Server"
        status="unknown"
      />,
    )
    const announcement = container.querySelector('[aria-live="polite"]')

    expect(announcement).toHaveClass('sr-only')
    expect(announcement).toHaveAttribute('aria-atomic', 'true')
    expect(announcement).toHaveTextContent('Build Server: unknown component compatibility.')
  })
})
