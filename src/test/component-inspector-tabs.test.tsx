import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComponentInspectorTabs } from '@/components/component-inspector-tabs'
import {
  createInventoryFormValues,
  type InventoryFormValues,
} from '@/components/inventory-form/model'
import type { ComponentType, InventoryItem, ProjectState } from '@/types/inventory'

afterEach(() => {
  cleanup()
})

function valuesFor(type: ComponentType): InventoryFormValues {
  return {
    ...createInventoryFormValues(type),
    name: `${type} item`,
  }
}

const assignedGpu: InventoryItem = {
  id: 'gpu',
  name: 'Intel Arc A310',
  type: 'gpu',
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
}

const compatibilityProject: ProjectState = {
  id: 'default-project',
  metadata: {
    name: 'Compatibility test',
    version: 1,
    updatedAt: '2026-07-19T00:00:00.000Z',
  },
  items: {
    server: {
      id: 'server',
      name: 'Dell Precision Compact 3240',
      type: 'server',
      compatibility: {
        host: {
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
    gpu: assignedGpu,
    cpu: {
      id: 'cpu',
      name: 'Intel Core i5-10500T',
      type: 'cpu',
      compatibility: {
        requirements: {
          cpu: {
            socket: 'LGA1200',
            generation: '10th Gen',
            tdpWatts: 35,
          },
        },
      },
    },
  },
  placements: [],
  assignments: [{
    id: 'gpu-assignment',
    serverId: 'server',
    itemId: 'gpu',
    type: 'gpu',
    assignedAt: '2026-07-19T00:00:00.000Z',
    allocation: {
      resourceType: 'expansion',
      groupId: 'pcie-slot',
      positions: [0],
    },
  }],
  connections: [],
}

const collidingIdProject: ProjectState = {
  ...compatibilityProject,
  items: {
    'server:1': {
      ...compatibilityProject.items.server,
      id: 1,
      key: 'server:1',
      name: 'Correct server host',
    },
    'nas:1': {
      id: 1,
      key: 'nas:1',
      name: 'Wrong NAS host',
      type: 'nas',
    },
    'cpu:1': {
      id: 1,
      key: 'cpu:1',
      name: 'Wrong CPU component',
      type: 'cpu',
    },
    'ram:1': {
      id: 1,
      key: 'ram:1',
      name: 'Wrong RAM component',
      type: 'ram',
    },
    'storage:1': {
      id: 1,
      key: 'storage:1',
      name: 'Wrong storage component',
      type: 'storage',
    },
    'gpu:1': {
      ...assignedGpu,
      id: 1,
      key: 'gpu:1',
      name: 'Correct GPU component',
    },
  },
  assignments: [{
    id: 1,
    serverId: '1',
    hostType: 'server',
    hostId: 1,
    itemId: '1',
    itemType: 'gpu',
    type: 'gpu',
    assignedAt: '2026-07-19T00:00:00.000Z',
    allocation: {
      resourceType: 'expansion',
      groupId: 'pcie-slot',
      positions: [0],
    },
  } as ProjectState['assignments'][number] & {
    hostType: 'server'
    hostId: number
    itemType: 'gpu'
  }],
}

function itemFor(type: ComponentType): InventoryItem {
  return compatibilityProject.items[type] ?? {
    id: type,
    name: `${type} item`,
    type,
  }
}

function renderTabs(
  type: ComponentType,
  overrides: Partial<ComponentProps<typeof ComponentInspectorTabs>> = {},
) {
  return render(
    <ComponentInspectorTabs
      project={compatibilityProject}
      item={itemFor(type)}
      values={valuesFor(type)}
      errors={{}}
      onChange={vi.fn()}
      {...overrides}
    />,
  )
}

describe('ComponentInspectorTabs', () => {
  it.each(['cpu', 'ram', 'storage'] as const)('shows only editable specs for %s', (type) => {
    renderTabs(type)

    expect(screen.getByRole('tab', { name: 'Specs' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: 'Ports' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Compatibility' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue(`${type} item`)
    expect(screen.getByRole('textbox', { name: 'Notes' })).toBeInTheDocument()
  })

  it.each(['gpu', 'network'] as const)('switches between Specs and Ports for %s', async (type) => {
    const user = userEvent.setup()

    renderTabs(type)

    expect(screen.getByRole('tab', { name: 'Specs' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Ports' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('textbox', { name: 'Notes' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Ports' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Ports' }))

    expect(screen.getByRole('tab', { name: 'Ports' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: 'Ports' })).toBeVisible()
    expect(screen.queryByRole('textbox', { name: 'Notes' })).not.toBeInTheDocument()
  })

  it('reports text, select, and note edits with the controlled save mode', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onSelectOpenChange = vi.fn()

    renderTabs('cpu', { onChange, onSelectOpenChange })

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Updated CPU' },
    })
    expect(onChange).toHaveBeenLastCalledWith({ name: 'Updated CPU' }, 'debounced')

    await user.click(screen.getByRole('combobox', { name: 'Manufacturer' }))
    await user.click(screen.getByRole('option', { name: 'Intel' }))
    expect(onChange).toHaveBeenLastCalledWith({ manufacturer: 'Intel' }, 'immediate')
    expect(onSelectOpenChange).toHaveBeenCalledWith(true)

    fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), {
      target: { value: 'Runs cool' },
    })
    expect(onChange).toHaveBeenLastCalledWith({ notes: 'Runs cool' }, 'debounced')
  })

  it('reports port edits immediately from the Ports tab', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const values = valuesFor('network')

    renderTabs('network', { values, onChange })

    await user.click(screen.getByRole('tab', { name: 'Ports' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Port group 1 count' }), {
      target: { value: '4' },
    })

    expect(onChange).toHaveBeenLastCalledWith({
      portGroups: [{ ...values.portGroups[0], count: 4 }],
    }, 'immediate')
  })

  it('keeps concise validation and save errors visible across tabs', async () => {
    const user = userEvent.setup()

    renderTabs('network', {
      errors: { name: 'Name is required.' },
      validationMessage: 'Capacity must be greater than zero.',
      saveError: 'The item could not be saved.',
    })

    expect(screen.getByRole('region', { name: 'Inspector errors' })).toHaveTextContent(
      'Capacity must be greater than zero.',
    )
    expect(screen.getByRole('region', { name: 'Inspector errors' })).toHaveTextContent(
      'The item could not be saved.',
    )
    expect(screen.getByRole('alert', { name: '' })).toHaveTextContent('Name is required.')

    await user.click(screen.getByRole('tab', { name: 'Ports' }))

    expect(screen.getByRole('region', { name: 'Inspector errors' })).toBeVisible()
  })

  it('shows normalized requirements, host, allocation, and result for an assigned component', async () => {
    const user = userEvent.setup()

    renderTabs('gpu', {
      item: assignedGpu,
      values: { ...valuesFor('gpu'), name: assignedGpu.name },
    })

    await user.click(screen.getByRole('tab', { name: 'Compatibility' }))

    expect(screen.getByRole('status')).toHaveTextContent('Compatible')
    expect(screen.getByText('PCIe generation')).toBeVisible()
    expect(screen.getByText('4')).toBeVisible()
    expect(screen.getByText('Dell Precision Compact 3240')).toBeVisible()
    expect(screen.getByText('PCIe slot, position 1')).toBeVisible()
    expect(screen.getByText(/will negotiate at PCIe 3/i)).toBeVisible()
  })

  it('shows requirements without fabricating a host result for an unassigned component', async () => {
    const user = userEvent.setup()

    renderTabs('cpu', {
      item: compatibilityProject.items.cpu,
      values: { ...valuesFor('cpu'), name: 'Intel Core i5-10500T' },
    })

    await user.click(screen.getByRole('tab', { name: 'Compatibility' }))

    expect(screen.getByText('LGA1200')).toBeVisible()
    expect(screen.getByText('10th Gen')).toBeVisible()
    expect(screen.getByText('35W')).toBeVisible()
    expect(screen.getByText('Not assigned')).toBeVisible()
    expect(screen.queryByText('Current host')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('resolves a typed assignment when every inventory category reuses numeric ID 1', async () => {
    const user = userEvent.setup()
    const gpu = collidingIdProject.items['gpu:1']

    renderTabs('gpu', {
      project: collidingIdProject,
      item: gpu,
      values: { ...valuesFor('gpu'), name: gpu.name },
    })

    await user.click(screen.getByRole('tab', { name: 'Compatibility' }))

    expect(screen.getByText('Correct server host')).toBeVisible()
    expect(screen.getByText('PCIe slot, position 1')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Compatible')
    expect(screen.queryByText('Wrong NAS host')).not.toBeInTheDocument()
    expect(screen.queryByText('Wrong CPU component')).not.toBeInTheDocument()
  })
})
