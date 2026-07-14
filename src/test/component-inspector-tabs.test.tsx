import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComponentInspectorTabs } from '@/components/component-inspector-tabs'
import {
  createInventoryFormValues,
  type InventoryFormValues,
} from '@/components/inventory-form/model'
import type { ComponentType } from '@/types/inventory'

afterEach(() => {
  cleanup()
})

function valuesFor(type: ComponentType): InventoryFormValues {
  return {
    ...createInventoryFormValues(type),
    name: `${type} item`,
  }
}

describe('ComponentInspectorTabs', () => {
  it.each(['cpu', 'ram', 'storage'] as const)('shows only editable specs for %s', (type) => {
    render(
      <ComponentInspectorTabs
        values={valuesFor(type)}
        errors={{}}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('tab', { name: 'Specs' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: 'Ports' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue(`${type} item`)
    expect(screen.getByRole('textbox', { name: 'Notes' })).toBeInTheDocument()
  })

  it.each(['gpu', 'network'] as const)('switches between Specs and Ports for %s', async (type) => {
    const user = userEvent.setup()

    render(
      <ComponentInspectorTabs
        values={valuesFor(type)}
        errors={{}}
        onChange={vi.fn()}
      />,
    )

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

    render(
      <ComponentInspectorTabs
        values={valuesFor('cpu')}
        errors={{}}
        onChange={onChange}
        onSelectOpenChange={onSelectOpenChange}
      />,
    )

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

    render(
      <ComponentInspectorTabs
        values={values}
        errors={{}}
        onChange={onChange}
      />,
    )

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

    render(
      <ComponentInspectorTabs
        values={valuesFor('network')}
        errors={{ name: 'Name is required.' }}
        validationMessage="Capacity must be greater than zero."
        saveError="The item could not be saved."
        onChange={vi.fn()}
      />,
    )

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
})
