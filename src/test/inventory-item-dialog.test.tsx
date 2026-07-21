import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SelectField } from '@/components/inventory-form/field-primitives'
import { SWITCH_MANAGEMENT_OPTIONS } from '@/components/inventory-form/options'
import { InventoryItemDialog } from '@/components/inventory-item-dialog'

afterEach(() => {
  cleanup()
})

describe('InventoryItemDialog switch port groups', () => {
  it('shares compatibility controls with the inspector form', async () => {
    const user = userEvent.setup()
    render(<InventoryItemDialog open onOpenChange={vi.fn()} onCreate={vi.fn()} />)

    expect(screen.getByRole('tab', { name: 'Specs' })).toHaveAttribute('data-state', 'active')
    expect(screen.getByRole('tab', { name: 'Compatibility' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Resources' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Ports' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Supported CPU sockets')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Compatibility' }))
    expect(screen.getByLabelText('Supported CPU sockets')).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Inventory type' }))
    await user.click(screen.getByRole('option', { name: 'CPU' }))

    expect(screen.getByRole('tab', { name: 'Specs' })).toHaveAttribute('data-state', 'active')
    expect(screen.queryByRole('tab', { name: 'Resources' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Ports' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('CPU socket')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Compatibility' }))
    expect(screen.getByLabelText('CPU socket')).toBeInTheDocument()
    expect(screen.queryByLabelText('Supported CPU sockets')).not.toBeInTheDocument()
  })

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

  it('renders the constrained PC component and power equipment fields', async () => {
    const user = userEvent.setup()
    render(<InventoryItemDialog open onOpenChange={vi.fn()} onCreate={vi.fn()} />)

    const chooseType = async (name: string) => {
      await user.click(screen.getByRole('combobox', { name: 'Inventory type' }))
      await user.click(screen.getByRole('option', { name }))
    }

    await chooseType('PC Build')
    expect(screen.getByRole('textbox', { name: 'Operating System' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Role' })).toBeInTheDocument()

    await chooseType('Motherboard')
    expect(screen.getByRole('combobox', { name: 'Form Factor' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'CPU Socket Count' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Resources' }))
    expect(screen.getByRole('button', { name: 'Add storage slot group' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add expansion slot group' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Ports' }))
    expect(screen.getByRole('button', { name: 'Add port group' })).toBeInTheDocument()

    await chooseType('CPU Cooler')
    expect(screen.getByRole('combobox', { name: 'Cooler Type' })).toBeInTheDocument()

    await chooseType('Case')
    expect(screen.getByRole('checkbox', {
      name: 'Supported motherboard form factor: Mini-ITX',
    })).toBeInTheDocument()

    await chooseType('Power Supply')
    expect(screen.getByRole('combobox', { name: 'PSU Form Factor' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Efficiency Rating' })).toBeInTheDocument()

    await chooseType('Sound Card')
    expect(screen.getByRole('combobox', { name: 'Interface' })).toBeInTheDocument()

    await chooseType('Wireless Card')
    expect(screen.getByRole('combobox', { name: 'Wi-Fi Generation' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Bluetooth' })).toBeInTheDocument()

    await chooseType('Power Adapter')
    expect(screen.getByRole('combobox', { name: 'DC Connector' })).toBeInTheDocument()

    await chooseType('Monitor')
    expect(screen.getByRole('spinbutton', { name: 'Display Size (inches)' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Resolution' })).toBeInTheDocument()

    await chooseType('UPS')
    expect(screen.getByRole('spinbutton', { name: 'Battery Backup Outlets' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Surge Protection Outlets' })).toBeInTheDocument()

    await chooseType('Power Strip')
    expect(screen.getByRole('spinbutton', { name: 'Outlet Count' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Surge Protected' })).toBeInTheDocument()
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
    await user.click(screen.getByRole('tab', { name: 'Ports' }))
    expect(screen.getByRole('combobox', { name: 'Port group 1 role' })).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Inventory type' }))
    await user.click(screen.getByRole('option', { name: 'GPU' }))
    await user.click(screen.getByRole('tab', { name: 'Ports' }))
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
    await user.click(screen.getByRole('tab', { name: 'Ports' }))

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
    await user.click(screen.getByRole('tab', { name: 'Ports' }))
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
    }), 1)
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
    }, 1)
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
    }, 1)
  })

  it('creates a PC Build with operating-system metadata', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(<InventoryItemDialog open onOpenChange={vi.fn()} onCreate={onCreate} />)

    await user.click(screen.getByRole('combobox', { name: 'Inventory type' }))
    await user.click(screen.getByRole('option', { name: 'PC Build' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Gaming PC')
    await user.type(screen.getByRole('textbox', { name: 'Operating System' }), 'Windows 11 Pro')
    await user.type(screen.getByRole('textbox', { name: 'Role' }), 'Gaming')
    await user.click(screen.getByRole('button', { name: 'Add item' }))

    expect(onCreate).toHaveBeenCalledWith({
      type: 'pcBuild',
      name: 'Gaming PC',
      specs: { operatingSystem: 'Windows 11 Pro', role: 'Gaming' },
    }, 1)
  })

  it('creates a UPS with classified outlet counts', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(<InventoryItemDialog open onOpenChange={vi.fn()} onCreate={onCreate} />)

    await user.click(screen.getByRole('combobox', { name: 'Inventory type' }))
    await user.click(screen.getByRole('option', { name: 'UPS' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'APC Back-UPS Pro')
    await user.type(screen.getByRole('spinbutton', { name: 'Output Watts' }), '900')
    await user.type(screen.getByRole('spinbutton', { name: 'Capacity (VA)' }), '1500')
    await user.type(screen.getByRole('spinbutton', { name: 'Battery Backup Outlets' }), '5')
    await user.type(screen.getByRole('spinbutton', { name: 'Surge Protection Outlets' }), '5')
    await user.click(screen.getByRole('button', { name: 'Add item' }))

    expect(onCreate).toHaveBeenCalledWith({
      type: 'ups',
      name: 'APC Back-UPS Pro',
      specs: {
        wattageWatts: 900,
        capacityVa: 1500,
        batteryBackupOutlets: 5,
        surgeProtectedOutlets: 5,
        outlets: 10,
      },
    }, 1)
  })

  it('creates multiple independent records with a validated quantity', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)

    render(<InventoryItemDialog open onOpenChange={vi.fn()} onCreate={onCreate} />)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Lab server')
    const quantity = screen.getByRole('spinbutton', { name: 'Quantity' })
    await user.clear(quantity)
    await user.type(quantity, '3')
    await user.click(screen.getByRole('button', { name: 'Add item' }))

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      type: 'server',
      name: 'Lab server',
    }), 3)
  })

  it('rejects quantities outside the supported range', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)

    render(<InventoryItemDialog open onOpenChange={vi.fn()} onCreate={onCreate} />)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Lab server')
    const quantity = screen.getByRole('spinbutton', { name: 'Quantity' })
    await user.clear(quantity)
    await user.type(quantity, '101')
    await user.click(screen.getByRole('button', { name: 'Add item' }))

    expect(screen.getByText('Quantity must be between 1 and 100.')).toBeInTheDocument()
    expect(quantity).toHaveAttribute('aria-invalid', 'true')
    expect(quantity).toHaveAttribute('aria-describedby')
    expect(document.getElementById(quantity.getAttribute('aria-describedby') ?? '')).toHaveTextContent(
      'Quantity must be between 1 and 100.',
    )
    expect(screen.getByRole('tab', { name: 'Specs' })).toHaveAttribute('data-state', 'active')
    await waitFor(() => expect(quantity).toHaveFocus())
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('routes compatibility validation errors to the relevant tab and field', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)

    render(<InventoryItemDialog open onOpenChange={vi.fn()} onCreate={onCreate} />)

    await user.click(screen.getByRole('combobox', { name: 'Inventory type' }))
    await user.click(screen.getByRole('option', { name: 'CPU' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Test CPU')
    await user.click(screen.getByRole('tab', { name: 'Compatibility' }))
    const tdp = screen.getByRole('spinbutton', { name: 'TDP (W)' })
    await user.type(tdp, '-1')
    await user.click(screen.getByRole('tab', { name: 'Specs' }))
    await user.click(screen.getByRole('button', { name: 'Add item' }))

    expect(screen.getByRole('tab', { name: 'Compatibility' })).toHaveAttribute('data-state', 'active')
    await waitFor(() => expect(screen.getByRole('spinbutton', { name: 'TDP (W)' })).toHaveFocus())
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('keeps a cleared port count invalid instead of submitting the previous value', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)

    render(<InventoryItemDialog open onOpenChange={vi.fn()} onCreate={onCreate} />)

    await user.click(screen.getByRole('combobox', { name: 'Inventory type' }))
    await user.click(screen.getByRole('option', { name: 'Switch' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Lab switch')
    await user.click(screen.getByRole('tab', { name: 'Ports' }))
    const count = screen.getByRole('spinbutton', { name: 'Port group 1 count' })
    await user.clear(count)
    await user.click(screen.getByRole('button', { name: 'Add item' }))

    expect(screen.getByRole('tab', { name: 'Ports' })).toHaveAttribute('data-state', 'active')
    expect(count).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(count).toHaveFocus())
    expect(onCreate).not.toHaveBeenCalled()
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
