import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SelectField } from '@/components/inventory-form/field-primitives'
import { SWITCH_MANAGEMENT_OPTIONS } from '@/components/inventory-form/options'
import { InventoryItemDialog } from '@/components/inventory-item-dialog'

afterEach(() => {
  cleanup()
})

describe('InventoryItemDialog switch port groups', () => {
  it('changes common and type-specific placeholders with the inventory type', async () => {
    const user = userEvent.setup()

    render(<InventoryItemDialog open onOpenChange={vi.fn()} onCreate={vi.fn()} />)

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute(
      'placeholder',
      'Dell OptiPlex Micro 7090',
    )

    await user.click(screen.getByRole('combobox', { name: 'Inventory type' }))
    await user.click(screen.getByRole('option', { name: 'CPU' }))

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute(
      'placeholder',
      'Intel Core i5-10500T',
    )
    expect(screen.getByRole('textbox', { name: 'Model' })).toHaveAttribute(
      'placeholder',
      'Core i5-10500T',
    )
    expect(screen.getByRole('spinbutton', { name: 'Cores' })).toHaveAttribute('placeholder', '6')
  })

  it('uses constrained selects for type-specific inventory fields', async () => {
    const user = userEvent.setup()

    render(
      <InventoryItemDialog
        open
        onOpenChange={vi.fn()}
        onCreate={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Inventory type' }))
    await user.click(screen.getByRole('option', { name: 'CPU' }))
    expect(screen.getByRole('combobox', { name: 'Manufacturer' })).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Inventory type' }))
    await user.click(screen.getByRole('option', { name: 'RAM' }))
    expect(screen.getByRole('combobox', { name: 'Generation' })).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Inventory type' }))
    await user.click(screen.getByRole('option', { name: 'Storage' }))
    expect(screen.getByRole('combobox', { name: 'Interface' })).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Inventory type' }))
    await user.click(screen.getByRole('option', { name: 'GPU' }))
    expect(screen.getByRole('combobox', { name: 'Manufacturer' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'PCIe' })).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Inventory type' }))
    await user.click(screen.getByRole('option', { name: 'Network Card' }))
    expect(screen.getByRole('combobox', { name: 'Interface' })).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Inventory type' }))
    await user.click(screen.getByRole('option', { name: 'Switch' }))
    expect(screen.getByRole('combobox', { name: 'Management' })).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Management' }))
    expect(screen.getByRole('option', { name: 'Controller / Cloud-managed' })).toBeInTheDocument()
  })

  it('clears a noncanonical manufacturer when changing to a constrained type', async () => {
    const user = userEvent.setup()

    render(
      <InventoryItemDialog
        open
        onOpenChange={vi.fn()}
        onCreate={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    await user.type(screen.getByRole('textbox', { name: 'Manufacturer' }), 'Dell')
    await user.click(screen.getByRole('combobox', { name: 'Inventory type' }))
    await user.click(screen.getByRole('option', { name: 'CPU' }))

    expect(screen.getByRole('combobox', { name: 'Manufacturer' })).not.toHaveTextContent('Dell')
    await user.click(screen.getByRole('combobox', { name: 'Manufacturer' }))
    expect(screen.queryByRole('option', { name: 'Dell (Legacy)' })).not.toBeInTheDocument()
  })

  it('shows port roles only for switches and network cards', async () => {
    const user = userEvent.setup()

    render(<InventoryItemDialog open onOpenChange={vi.fn()} onCreate={vi.fn()} />)

    expect(screen.queryByRole('combobox', { name: 'Port group 1 role' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Inventory type' }))
    await user.click(screen.getByRole('option', { name: 'Network Card' }))
    expect(screen.getByRole('combobox', { name: 'Port group 1 role' })).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Inventory type' }))
    await user.click(screen.getByRole('option', { name: 'GPU' }))
    expect(screen.queryByRole('combobox', { name: 'Port group 1 role' })).not.toBeInTheDocument()
  })

  it('defaults network receptacles, preserves valid speeds, and removes No speed', async () => {
    const user = userEvent.setup()

    render(
      <InventoryItemDialog
        open
        onOpenChange={vi.fn()}
        onCreate={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Inventory type' }))
    await user.click(screen.getByRole('option', { name: 'Switch' }))

    expect(screen.getByRole('combobox', { name: 'Port group 1 speed' })).toHaveTextContent('1G')

    await user.click(screen.getByRole('combobox', { name: 'Port group 1 speed' }))
    expect(screen.queryByRole('option', { name: 'No speed' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('combobox', { name: 'Port group 1 type' }))
    await user.click(screen.getByRole('option', { name: 'DisplayPort' }))
    await user.click(screen.getByRole('combobox', { name: 'Port group 1 speed' }))
    await user.click(screen.getByRole('option', { name: 'No speed' }))
    await user.click(screen.getByRole('combobox', { name: 'Port group 1 type' }))
    await user.click(screen.getByRole('option', { name: 'SFP+' }))

    expect(screen.getByRole('combobox', { name: 'Port group 1 speed' })).toHaveTextContent('10G')

    await user.click(screen.getByRole('combobox', { name: 'Port group 1 speed' }))
    await user.click(screen.getByRole('option', { name: '5G' }))
    await user.click(screen.getByRole('combobox', { name: 'Port group 1 type' }))
    await user.click(screen.getByRole('option', { name: 'RJ45' }))

    expect(screen.getByRole('combobox', { name: 'Port group 1 speed' })).toHaveTextContent('5G')
  })

  it('creates the same switch payload through the controlled shared fields', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)

    render(<InventoryItemDialog open onOpenChange={vi.fn()} onCreate={onCreate} />)

    await user.click(screen.getByRole('combobox', { name: 'Inventory type' }))
    await user.click(screen.getByRole('option', { name: 'Switch' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Lab switch')
    await user.click(screen.getByRole('combobox', { name: 'Management' }))
    await user.click(screen.getByRole('option', { name: 'Layer 2 Managed' }))
    await user.clear(screen.getByRole('spinbutton', { name: 'Port group 1 count' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Port group 1 count' }), '4')
    await user.click(screen.getByRole('button', { name: 'Add item' }))

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      type: 'switch',
      name: 'Lab switch',
      specs: {
        management: 'Layer 2 Managed',
        fanless: false,
      },
      ports: expect.arrayContaining([
        expect.objectContaining({ kind: 'switch-port', speed: '1G', slotNumber: 1 }),
        expect.objectContaining({ kind: 'switch-port', speed: '1G', slotNumber: 4 }),
      ]),
    }))
    expect(onCreate.mock.calls[0][0].ports).toHaveLength(4)
  })

  it('creates a CPU payload through the shared controlled fields', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)

    render(<InventoryItemDialog open onOpenChange={vi.fn()} onCreate={onCreate} />)

    await user.click(screen.getByRole('combobox', { name: 'Inventory type' }))
    await user.click(screen.getByRole('option', { name: 'CPU' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Core i5-10500T')
    await user.click(screen.getByRole('combobox', { name: 'Manufacturer' }))
    await user.click(screen.getByRole('option', { name: 'Intel' }))
    await user.type(screen.getByRole('textbox', { name: 'Family' }), 'Core i5')
    await user.type(screen.getByRole('textbox', { name: 'Number' }), 'i5-10500T')
    await user.type(screen.getByRole('spinbutton', { name: 'Cores' }), '6')
    await user.type(screen.getByRole('spinbutton', { name: 'Threads' }), '12')
    await user.click(screen.getByRole('button', { name: 'Add item' }))

    expect(onCreate).toHaveBeenCalledWith({
      type: 'cpu',
      name: 'Core i5-10500T',
      manufacturer: 'Intel',
      family: 'Core i5',
      number: 'i5-10500T',
      specs: { cores: 6, threads: 12 },
    })
  })

  it('creates a storage payload with the selected unit and interface', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)

    render(<InventoryItemDialog open onOpenChange={vi.fn()} onCreate={onCreate} />)

    await user.click(screen.getByRole('combobox', { name: 'Inventory type' }))
    await user.click(screen.getByRole('option', { name: 'Storage' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), '4TB NVMe')
    await user.type(screen.getByRole('spinbutton', { name: 'Capacity' }), '4')
    await user.click(screen.getByRole('combobox', { name: 'Unit' }))
    await user.click(screen.getByRole('option', { name: 'TB' }))
    await user.click(screen.getByRole('combobox', { name: 'Interface' }))
    await user.click(screen.getByRole('option', { name: 'NVMe' }))
    await user.click(screen.getByRole('combobox', { name: 'Form Factor' }))
    await user.click(screen.getByRole('option', { name: '2280' }))
    await user.click(screen.getByRole('button', { name: 'Add item' }))

    expect(onCreate).toHaveBeenCalledWith({
      type: 'storage',
      name: '4TB NVMe',
      specs: { capacityTb: 4, interface: 'NVMe', formFactor: '2280' },
    })
  })

  it('keeps the dirty discard confirmation behavior', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    render(
      <InventoryItemDialog
        open
        onOpenChange={onOpenChange}
        onCreate={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Draft')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('heading', { name: 'Discard changes?' })).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)

    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('heading', { name: 'Discard changes?' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Draft')
  })

  it('dismisses an open select without treating a click inside the form as a close request', async () => {
    const user = userEvent.setup()

    render(
      <InventoryItemDialog
        open
        onOpenChange={vi.fn()}
        onCreate={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Inventory type' }))
    await user.click(screen.getByRole('option', { name: 'Switch' }))
    await user.click(screen.getByRole('combobox', { name: 'Management' }))
    const itemDialog = document.querySelector<HTMLElement>('[data-slot="dialog-content"]')
    expect(itemDialog).not.toBeNull()
    fireEvent.pointerDown(itemDialog!)
    fireEvent.click(itemDialog!)
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('heading', { name: 'Discard changes?' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Add inventory item' })).toBeInTheDocument()
  })
})

describe('shared inventory select fields', () => {
  it('shows a persisted nonstandard value as a legacy option', async () => {
    const user = userEvent.setup()

    render(
      <SelectField
        label="Management"
        value="Omada managed"
        options={SWITCH_MANAGEMENT_OPTIONS}
        onValueChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'Management' })).toHaveTextContent('Omada managed')
    await user.click(screen.getByRole('combobox', { name: 'Management' }))
    expect(screen.getByRole('option', { name: 'Omada managed (Legacy)' })).toBeInTheDocument()
  })
})
