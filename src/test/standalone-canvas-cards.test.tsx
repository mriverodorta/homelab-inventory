import { fireEvent, render, screen } from '@testing-library/react'
import type { NodeProps } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { getEndpointHandleId } from '@/lib/cable-routing'
import { buildCanvasProjectIndex } from '@/lib/canvas-project-index'
import { MonitorNode, type MonitorFlowNode } from '@/components/monitor-card'
import {
  PowerStripNode,
  powerStripInputView,
  powerStripOutletViews,
  type PowerStripFlowNode,
} from '@/components/power-strip-card'
import { UpsNode, upsOutletGroups, type UpsFlowNode } from '@/components/ups-card'
import { topologyQueryFixture } from '@/test/topology-query-fixture'
import type { InventoryItem, InventoryPort, ProjectState } from '@/types/inventory'
import { withCanonicalPowerPorts } from '../../shared/power-ports.mjs'

vi.mock('@xyflow/react', () => ({
  Handle: ({ id, type }: { id: string; type: string }) => (
    <span data-testid={`handle-${id}`} data-handle-type={type} />
  ),
  Position: {
    Left: 'left',
    Right: 'right',
    Top: 'top',
    Bottom: 'bottom',
  },
}))

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

function projectWith(item: InventoryItem): ProjectState {
  const key = item.key ?? `${item.type}:${item.id}`
  return {
    id: 'default',
    metadata: { name: 'Standalone cards', version: 1, updatedAt: '2026-07-20T00:00:00.000Z' },
    items: { [key]: { ...item, key } },
    placements: [{ serverId: key, x: 0, y: 0 }],
    assignments: [],
    connections: [],
  }
}

function canonicalPowerPortsFor(item: InventoryItem): InventoryPort[] {
  return withCanonicalPowerPorts(item).ports ?? []
}

function data(project: ProjectState, itemId: string) {
  return {
    project,
    canvasIndex: buildCanvasProjectIndex(project, topologyQueryFixture(project)),
    requiredHandleIds: new Set<string>(),
    itemId,
    selectedItemId: null,
    focusedItemIds: [],
    focusActive: false,
    spotlightItemId: null,
    pendingEndpoint: null,
    draggingEndpoint: null,
    onSelect: vi.fn(),
    onEndpointClick: vi.fn(),
    onEndpointDragStart: vi.fn(),
    onEndpointDrop: vi.fn(),
  }
}

function monitorProps(nodeData: MonitorFlowNode['data']): NodeProps<MonitorFlowNode> {
  return { ...baseNodeProps, id: nodeData.itemId, type: 'monitor', data: nodeData }
}

function upsProps(nodeData: UpsFlowNode['data']): NodeProps<UpsFlowNode> {
  return { ...baseNodeProps, id: nodeData.itemId, type: 'ups', data: nodeData }
}

function powerStripProps(nodeData: PowerStripFlowNode['data']): NodeProps<PowerStripFlowNode> {
  return { ...baseNodeProps, id: nodeData.itemId, type: 'powerStrip', data: nodeData }
}

describe('standalone canvas cards', () => {
  it('shows monitor display and power ports in separate groups', () => {
    const monitor: InventoryItem = {
      id: 1,
      key: 'monitor:1',
      type: 'monitor',
      name: 'Studio Display',
      specs: { sizeInches: 27, resolution: '3840x2160', refreshRateHz: 60 },
      ports: [
        ...canonicalPowerPortsFor({ id: 1, type: 'monitor', name: 'Studio Display' }),
        { id: 2, kind: 'server-port', type: 'displayport', slotNumber: 1 },
        { id: 3, kind: 'server-port', type: 'hdmi', slotNumber: 2 },
      ],
    }
    const currentProject = projectWith(monitor)

    render(<MonitorNode {...monitorProps(data(currentProject, monitor.key!))} />)

    expect(screen.getByText('Display inputs')).toBeInTheDocument()
    expect(document.querySelector('[data-port-group="power"]')).toHaveTextContent('Power')
    expect(screen.getAllByTestId('standalone-port-chip')).toHaveLength(3)
    expect(screen.getByText('Studio Display')).toBeInTheDocument()
    expect(screen.getByText('27" / 3840x2160 / 60Hz')).toBeInTheDocument()
  })

  it('creates individually numbered UPS outlet chips and separates battery from surge outlets', () => {
    const ups = withCanonicalPowerPorts({
      id: 1,
      key: 'ups:1',
      type: 'ups',
      name: 'Rack UPS',
      specs: { capacityVa: 1500, batteryBackupOutlets: 3, surgeProtectedOutlets: 2, outlets: 5 },
    } satisfies InventoryItem)

    const groups = upsOutletGroups(ups)
    expect(groups[0].ports.map((view) => view.port.slotNumber)).toEqual([1, 2, 3])
    expect(groups[1].ports.map((view) => view.port.slotNumber)).toEqual([4, 5])

    const currentProject = projectWith(ups)
    render(<UpsNode {...upsProps(data(currentProject, ups.key!))} />)

    expect(screen.getByText('Battery-backed outlets')).toBeInTheDocument()
    expect(screen.getByText('Surge-only outlets')).toBeInTheDocument()
    expect(screen.getAllByTestId('standalone-port-chip')).toHaveLength(5)
  })

  it('renders a vertical UPS with swapped group columns and unchanged endpoint IDs', () => {
    const ups = withCanonicalPowerPorts({
      id: 1,
      key: 'ups:1',
      type: 'ups',
      name: 'Vertical UPS',
      properties: {
        canvasOrientation: 'vertical',
        upsOutletGroupOrder: 'surge-battery',
      },
      specs: { outlets: 3, batteryBackupOutlets: 2, surgeProtectedOutlets: 1 },
    } satisfies InventoryItem)
    const currentProject = projectWith(ups)
    const nodeData = data(currentProject, ups.key!)
    const endpoint = { itemId: 'ups:1', portId: 1 }
    nodeData.requiredHandleIds = new Set([
      getEndpointHandleId('source', 'bottom', endpoint),
    ])

    render(<UpsNode {...upsProps(nodeData)} />)

    const card = screen.getByTestId('standalone-equipment-card')
    const groups = screen.getAllByTestId('standalone-port-group')
    expect(card).toHaveAttribute('data-orientation', 'vertical')
    expect(card).toHaveStyle({ width: '248px' })
    expect(groups.map((group) => group.dataset.portGroup)).toEqual(['surge', 'battery'])
    expect(groups.every((group) => group.dataset.portLayout === 'vertical')).toBe(true)
    groups.forEach((group) => {
      const label = group.querySelector('[data-port-group-label]')
      expect(label).toHaveClass('h-5', 'overflow-hidden', 'leading-[10px]')
      expect(label).toHaveAttribute('title', label?.textContent)
    })
    expect(document.querySelector('[data-port-id="1"]')).toBeInTheDocument()
    expect(screen.getAllByTestId(/handle-/)).toHaveLength(1)
  })

  it('preserves selective UPS endpoint handles when only orientation changes', () => {
    const baseUps: InventoryItem = withCanonicalPowerPorts({
      id: 1,
      key: 'ups:1',
      type: 'ups',
      name: 'Orientation UPS',
      specs: { outlets: 3, batteryBackupOutlets: 2, surgeProtectedOutlets: 1 },
    } satisfies InventoryItem)
    const endpoint = { itemId: baseUps.key!, portId: 2 }
    const requiredHandleId = getEndpointHandleId('source', 'top', endpoint)

    const horizontalData = data(projectWith(baseUps), baseUps.key!)
    horizontalData.requiredHandleIds = new Set([requiredHandleId])
    const horizontalRender = render(<UpsNode {...upsProps(horizontalData)} />)
    const horizontalHandleTestIds = screen.getAllByTestId(/handle-/).map(
      (handle) => handle.dataset.testid,
    )

    expect(horizontalHandleTestIds).toEqual([`handle-${requiredHandleId}`])
    horizontalRender.unmount()

    const verticalUps: InventoryItem = {
      ...baseUps,
      properties: {
        ...baseUps.properties,
        canvasOrientation: 'vertical',
      },
    }
    const verticalData = data(projectWith(verticalUps), verticalUps.key!)
    verticalData.requiredHandleIds = new Set([requiredHandleId])
    render(<UpsNode {...upsProps(verticalData)} />)
    const verticalHandleTestIds = screen.getAllByTestId(/handle-/).map(
      (handle) => handle.dataset.testid,
    )

    expect(verticalHandleTestIds).toEqual(horizontalHandleTestIds)
    expect(verticalHandleTestIds).toHaveLength(1)
  })

  it('keeps missing orientation horizontal and preserves UPS default group order', () => {
    const ups = withCanonicalPowerPorts({
      id: 1,
      key: 'ups:1',
      type: 'ups',
      name: 'Default UPS',
      specs: { outlets: 2, batteryBackupOutlets: 1, surgeProtectedOutlets: 1 },
    } satisfies InventoryItem)

    render(<UpsNode {...upsProps(data(projectWith(ups), ups.key!))} />)

    const card = screen.getByTestId('standalone-equipment-card')
    expect(card).toHaveAttribute('data-orientation', 'horizontal')
    expect(card).toHaveStyle({ width: '420px' })
    expect(screen.getAllByTestId('standalone-port-group').map(
      (group) => group.dataset.portGroup,
    )).toEqual(['battery', 'surge'])
  })

  it('uses explicit UPS port labels to classify imported outlets', () => {
    const canonicalPorts = canonicalPowerPortsFor({
      id: 1,
      type: 'ups',
      name: 'Imported UPS',
      specs: { outlets: 2, batteryBackupOutlets: 1, surgeProtectedOutlets: 1 },
    })
    const ups: InventoryItem = {
      id: 1,
      type: 'ups',
      name: 'Imported UPS',
      ports: canonicalPorts.map((port) => port.key === 'battery-outlet-1'
        ? { ...port, notes: 'Battery backup bank' }
        : { ...port, label: 'Surge only' }),
    }

    const groups = upsOutletGroups(ups)
    expect(groups[0].ports[0].port.id).toBe(1)
    expect(groups[1].ports[0].port.id).toBe(2)
  })

  it('renders one AC input chip and one numbered chip per power-strip outlet', () => {
    const strip = withCanonicalPowerPorts({
      id: 1,
      key: 'powerStrip:1',
      type: 'powerStrip',
      name: 'Smart Strip',
      specs: { outlets: 6, surgeProtected: true, surgeProtectedOutlets: 6 },
    } satisfies InventoryItem)

    expect(powerStripOutletViews(strip).map((view) => view.port.slotNumber)).toEqual([1, 2, 3, 4, 5, 6])
    expect(powerStripInputView(strip).endpoint).toEqual({ itemId: 'powerStrip:1', portId: 1 })

    const currentProject = projectWith(strip)
    render(<PowerStripNode {...powerStripProps(data(currentProject, strip.key!))} />)
    expect(screen.getAllByTestId('standalone-port-chip')).toHaveLength(7)
    const headerPort = document.querySelector('[data-header-port="true"]')
    expect(headerPort).toBeInTheDocument()
    expect(headerPort).toHaveTextContent('AC IN')
    expect(headerPort).toHaveTextContent('00')
    expect(headerPort?.querySelector('[data-port-id="1"]')).toBeInTheDocument()
    expect(document.querySelector('[data-port-group="input"]')).not.toBeInTheDocument()
    expect(document.querySelector('[data-port-group="outlets"]')).toHaveTextContent('01')
    expect(document.querySelector('[data-port-group="outlets"]')).toHaveTextContent('06')
  })

  it('shows smart power-strip identity without replacing compact outlet chips', () => {
    const strip = withCanonicalPowerPorts({
      id: 1,
      key: 'powerStrip:1',
      type: 'powerStrip',
      name: 'Kasa HS300',
      specs: { outlets: 2, surgeProtected: true, surgeProtectedOutlets: 2 },
      smart: {
        enabled: true,
        displayName: 'Rack power',
        managementIp: '192.168.1.50',
        macAddress: '00:11:22:33:44:55',
        outlets: [{ portId: 2, name: 'Router' }],
      },
    } satisfies InventoryItem)

    const outletViews = powerStripOutletViews(strip)
    expect(outletViews[0].detail).toBe('Router - Surge-protected outlet 1')
    expect(outletViews[1].detail).toBe('Outlet 2')

    render(<PowerStripNode {...powerStripProps(data(projectWith(strip), strip.key!))} />)

    expect(screen.getByText('Kasa HS300')).toBeInTheDocument()
    expect(screen.getByText('Rack power')).toBeInTheDocument()
    const namedOutlet = document.querySelector('[data-port-id="2"]')
    expect(namedOutlet).toHaveAttribute('title', 'Router - Surge-protected outlet 1')
    expect(namedOutlet).toHaveTextContent('Surge')
    expect(namedOutlet).toHaveTextContent('01')
    expect(namedOutlet).not.toHaveTextContent('Router')
  })

  it('renders a vertical power strip with a one-line summary and its AC input in the header', () => {
    const strip = withCanonicalPowerPorts({
      id: 1,
      key: 'powerStrip:1',
      type: 'powerStrip',
      name: 'Vertical Strip',
      properties: { canvasOrientation: 'vertical' },
      specs: {
        outlets: 3,
        surgeProtected: true,
        voltage: '120V household service with a deliberately long summary',
      },
    } satisfies InventoryItem)

    render(<PowerStripNode {...powerStripProps(data(projectWith(strip), strip.key!))} />)

    const card = screen.getByTestId('standalone-equipment-card')
    expect(card).toHaveAttribute('data-orientation', 'vertical')
    expect(card).toHaveStyle({ width: '176px' })
    expect(document.querySelector('[data-header-port="true"]')).toHaveTextContent('AC IN')
    expect(document.querySelector('[data-port-group="outlets"]')).toHaveAttribute(
      'data-port-layout',
      'vertical',
    )
    expect(screen.getByTestId('standalone-equipment-summary')).toHaveClass(
      'truncate',
      'whitespace-nowrap',
    )
  })

  it('keeps the header AC input interactive without selecting the power-strip card', () => {
    const strip = withCanonicalPowerPorts({
      id: 1,
      key: 'powerStrip:1',
      type: 'powerStrip',
      name: 'Interactive Strip',
      specs: { outlets: 1 },
    } satisfies InventoryItem)
    const currentProject = projectWith(strip)
    const nodeData = data(currentProject, strip.key!)
    const endpoint = { itemId: strip.key!, portId: 1 }
    const firstRender = render(<PowerStripNode {...powerStripProps(nodeData)} />)
    const headerChip = document.querySelector<HTMLElement>('[data-header-port="true"] [data-port-id="1"]')!

    fireEvent.click(headerChip, { clientX: 25, clientY: 35 })
    expect(nodeData.onEndpointClick).toHaveBeenCalledWith(endpoint, { x: 25, y: 35 })
    expect(nodeData.onSelect).not.toHaveBeenCalled()

    firstRender.unmount()
    const selectedData = { ...nodeData, pendingEndpoint: endpoint }
    const secondRender = render(<PowerStripNode {...powerStripProps(selectedData)} />)
    const selectedHeaderChip = document.querySelector<HTMLElement>('[data-header-port="true"] [data-port-id="1"]')!

    fireEvent.pointerDown(selectedHeaderChip, {
      pointerId: 2,
      pointerType: 'mouse',
      button: 0,
      clientX: 40,
      clientY: 50,
    })
    fireEvent.pointerMove(window, { pointerId: 2, pointerType: 'mouse', clientX: 46, clientY: 50 })
    expect(selectedData.onEndpointDragStart).toHaveBeenCalledWith(endpoint, { x: 40, y: 50 })
    expect(selectedData.onSelect).not.toHaveBeenCalled()

    secondRender.unmount()
    const dropData = {
      ...nodeData,
      draggingEndpoint: { itemId: strip.key!, portId: 2 },
    }
    render(<PowerStripNode {...powerStripProps(dropData)} />)
    const dropHeaderChip = document.querySelector<HTMLElement>('[data-header-port="true"] [data-port-id="1"]')!

    fireEvent.pointerUp(dropHeaderChip, { pointerId: 3, pointerType: 'mouse' })
    expect(dropData.onEndpointDrop).toHaveBeenCalledWith(endpoint)
    expect(dropData.onSelect).not.toHaveBeenCalled()
  })

  it('supports card selection, node dragging, focus, and click-then-drag port callbacks', () => {
    const monitor: InventoryItem = {
      id: 1,
      key: 'monitor:1',
      type: 'monitor',
      name: 'Interactive Display',
      ports: [
        ...canonicalPowerPortsFor({ id: 1, type: 'monitor', name: 'Interactive Display' }),
        { id: 2, kind: 'server-port', type: 'hdmi', slotNumber: 1 },
      ],
    }
    const currentProject = projectWith(monitor)
    const nodeData = data(currentProject, monitor.key!)
    nodeData.focusActive = true
    nodeData.focusedItemIds = []
    const firstRender = render(<MonitorNode {...monitorProps(nodeData)} />)
    const card = screen.getByTestId('standalone-equipment-card')

    expect(card).toHaveClass('opacity-35', 'grayscale')
    expect(card.querySelector('.server-node-drag-handle')).toHaveClass('cursor-grab')

    fireEvent.pointerDown(card, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerUp(card, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10 })
    expect(nodeData.onSelect).toHaveBeenCalledWith(monitor.key)

    firstRender.unmount()
    const endpoint = { itemId: monitor.key!, portId: 2 }
    const selectedData = { ...nodeData, focusActive: false, pendingEndpoint: endpoint }
    render(<MonitorNode {...monitorProps(selectedData)} />)
    const chip = screen.getAllByTestId('standalone-port-chip').find((candidate) => candidate.dataset.portId === '2')!

    fireEvent.pointerDown(chip, { pointerId: 2, pointerType: 'mouse', button: 0, clientX: 40, clientY: 50 })
    fireEvent.pointerMove(window, { pointerId: 2, pointerType: 'mouse', clientX: 46, clientY: 50 })
    expect(selectedData.onEndpointDragStart).toHaveBeenCalledWith(endpoint, { x: 40, y: 50 })
  })

  it('selects an open port before permitting its drag contract', () => {
    const strip = withCanonicalPowerPorts({
      id: 1,
      key: 'powerStrip:1',
      type: 'powerStrip',
      name: 'Strip',
      specs: { outlets: 1 },
    } satisfies InventoryItem)
    const currentProject = projectWith(strip)
    const nodeData = data(currentProject, strip.key!)

    render(<PowerStripNode {...powerStripProps(nodeData)} />)
    const chip = screen.getAllByTestId('standalone-port-chip').find(
      (candidate) => candidate.dataset.portId === '2',
    )!
    fireEvent.click(chip, { clientX: 25, clientY: 35 })

    expect(nodeData.onEndpointClick).toHaveBeenCalledWith(
      { itemId: strip.key, portId: 2 },
      { x: 25, y: 35 },
    )
    expect(nodeData.onEndpointDragStart).not.toHaveBeenCalled()
  })

  it('uses persisted canonical numeric IDs for monitor inputs and UPS outlets', () => {
    const monitor = withCanonicalPowerPorts({
      id: 1,
      key: 'monitor:1',
      type: 'monitor',
      name: 'Display',
    } satisfies InventoryItem)
    const monitorProject = projectWith(monitor)
    const monitorData = data(monitorProject, monitor.key!)
    const monitorRender = render(<MonitorNode {...monitorProps(monitorData)} />)

    fireEvent.click(screen.getByTestId('standalone-port-chip'), { clientX: 10, clientY: 20 })
    expect(monitorData.onEndpointClick).toHaveBeenCalledWith(
      { itemId: 'monitor:1', portId: 1 },
      { x: 10, y: 20 },
    )
    monitorRender.unmount()

    const ups = withCanonicalPowerPorts({
      id: 1,
      key: 'ups:1',
      type: 'ups',
      name: 'UPS',
      specs: { outlets: 1, batteryBackupOutlets: 1, surgeProtectedOutlets: 0 },
    } satisfies InventoryItem)
    const upsProject = projectWith(ups)
    const upsData = data(upsProject, ups.key!)
    render(<UpsNode {...upsProps(upsData)} />)
    fireEvent.click(screen.getByTestId('standalone-port-chip'), { clientX: 30, clientY: 40 })
    expect(upsData.onEndpointClick).toHaveBeenCalledWith(
      { itemId: 'ups:1', portId: 1 },
      { x: 30, y: 40 },
    )
  })
})
