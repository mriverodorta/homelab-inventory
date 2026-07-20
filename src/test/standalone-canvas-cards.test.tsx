import { fireEvent, render, screen } from '@testing-library/react'
import type { NodeProps } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { MonitorNode, type MonitorFlowNode } from '@/components/monitor-card'
import { PowerStripNode, powerStripOutletViews, type PowerStripFlowNode } from '@/components/power-strip-card'
import { UpsNode, upsOutletGroups, type UpsFlowNode } from '@/components/ups-card'
import type { InventoryItem, ProjectState } from '@/types/inventory'

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

function data(project: ProjectState, itemId: string) {
  return {
    project,
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
        { id: 1, kind: 'server-port', type: 'displayport', slotNumber: 1 },
        { id: 2, kind: 'server-port', type: 'hdmi', slotNumber: 2 },
        { id: 3, kind: 'server-port', type: 'barrel', slotNumber: 1 },
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
    const ups: InventoryItem = {
      id: 1,
      key: 'ups:1',
      type: 'ups',
      name: 'Rack UPS',
      specs: { capacityVa: 1500, batteryBackupOutlets: 3, surgeProtectedOutlets: 2, outlets: 5 },
    }

    const groups = upsOutletGroups(ups)
    expect(groups[0].ports.map((view) => view.port.slotNumber)).toEqual([1, 2, 3])
    expect(groups[1].ports.map((view) => view.port.slotNumber)).toEqual([4, 5])

    const currentProject = projectWith(ups)
    render(<UpsNode {...upsProps(data(currentProject, ups.key!))} />)

    expect(screen.getByText('Battery-backed outlets')).toBeInTheDocument()
    expect(screen.getByText('Surge-only outlets')).toBeInTheDocument()
    expect(screen.getAllByTestId('standalone-port-chip')).toHaveLength(5)
  })

  it('uses explicit UPS port labels to classify imported outlets', () => {
    const ups: InventoryItem = {
      id: 1,
      type: 'ups',
      name: 'Imported UPS',
      ports: [
        { id: 'a', kind: 'server-port', type: 'barrel', slotNumber: 1, label: 'Surge only' },
        { id: 'b', kind: 'server-port', type: 'barrel', slotNumber: 2, notes: 'Battery backup bank' },
      ],
    }

    const groups = upsOutletGroups(ups)
    expect(groups[0].ports[0].port.id).toBe('b')
    expect(groups[1].ports[0].port.id).toBe('a')
  })

  it('renders one numbered chip per power-strip outlet', () => {
    const strip: InventoryItem = {
      id: 1,
      key: 'powerStrip:1',
      type: 'powerStrip',
      name: 'Smart Strip',
      specs: { outlets: 6, surgeProtected: true, surgeProtectedOutlets: 6 },
    }

    expect(powerStripOutletViews(strip).map((view) => view.port.slotNumber)).toEqual([1, 2, 3, 4, 5, 6])

    const currentProject = projectWith(strip)
    render(<PowerStripNode {...powerStripProps(data(currentProject, strip.key!))} />)
    expect(screen.getAllByTestId('standalone-port-chip')).toHaveLength(6)
  })

  it('supports card selection, node dragging, focus, and click-then-drag port callbacks', () => {
    const monitor: InventoryItem = {
      id: 1,
      key: 'monitor:1',
      type: 'monitor',
      name: 'Interactive Display',
      ports: [{ id: 7, kind: 'server-port', type: 'hdmi', slotNumber: 1 }],
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
    const endpoint = { itemId: monitor.key!, portId: 7 }
    const selectedData = { ...nodeData, focusActive: false, pendingEndpoint: endpoint }
    render(<MonitorNode {...monitorProps(selectedData)} />)
    const chip = screen.getAllByTestId('standalone-port-chip').find((candidate) => candidate.dataset.portId === '7')!

    fireEvent.pointerDown(chip, { pointerId: 2, pointerType: 'mouse', button: 0, clientX: 40, clientY: 50 })
    fireEvent.pointerMove(window, { pointerId: 2, pointerType: 'mouse', clientX: 46, clientY: 50 })
    expect(selectedData.onEndpointDragStart).toHaveBeenCalledWith(endpoint, { x: 40, y: 50 })
  })

  it('selects an open port before permitting its drag contract', () => {
    const strip: InventoryItem = {
      id: 1,
      key: 'powerStrip:1',
      type: 'powerStrip',
      name: 'Strip',
      specs: { outlets: 1 },
    }
    const currentProject = projectWith(strip)
    const nodeData = data(currentProject, strip.key!)

    render(<PowerStripNode {...powerStripProps(nodeData)} />)
    const chip = screen.getByTestId('standalone-port-chip')
    fireEvent.click(chip, { clientX: 25, clientY: 35 })

    expect(nodeData.onEndpointClick).toHaveBeenCalledWith(
      { itemId: strip.key, portId: 'outlet-1' },
      { x: 25, y: 35 },
    )
    expect(nodeData.onEndpointDragStart).not.toHaveBeenCalled()
  })

  it('uses the power topology synthetic IDs for monitor inputs and outlets', () => {
    const monitor: InventoryItem = {
      id: 1,
      key: 'monitor:1',
      type: 'monitor',
      name: 'Display',
    }
    const monitorProject = projectWith(monitor)
    const monitorData = data(monitorProject, monitor.key!)
    const monitorRender = render(<MonitorNode {...monitorProps(monitorData)} />)

    fireEvent.click(screen.getByTestId('standalone-port-chip'), { clientX: 10, clientY: 20 })
    expect(monitorData.onEndpointClick).toHaveBeenCalledWith(
      { itemId: 'monitor:1', portId: 'ac-input' },
      { x: 10, y: 20 },
    )
    monitorRender.unmount()

    const ups: InventoryItem = {
      id: 1,
      key: 'ups:1',
      type: 'ups',
      name: 'UPS',
      specs: { outlets: 1, batteryBackupOutlets: 1 },
    }
    const upsProject = projectWith(ups)
    const upsData = data(upsProject, ups.key!)
    render(<UpsNode {...upsProps(upsData)} />)
    fireEvent.click(screen.getByTestId('standalone-port-chip'), { clientX: 30, clientY: 40 })
    expect(upsData.onEndpointClick).toHaveBeenCalledWith(
      { itemId: 'ups:1', portId: 'outlet-1' },
      { x: 30, y: 40 },
    )
  })
})
