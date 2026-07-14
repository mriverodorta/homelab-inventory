import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InventorySpecsTabContent } from '@/components/inventory-form/specs-tab-content'
import {
  createInventoryFormValues,
  type InventoryFormValues,
} from '@/components/inventory-form/model'
import { Tabs } from '@/components/ui/tabs'
import type { InventoryType } from '@/types/inventory'

afterEach(() => {
  cleanup()
})

function valuesFor(type: InventoryType): InventoryFormValues {
  return {
    ...createInventoryFormValues(type),
    name: `${type} item`,
  }
}

describe('InventorySpecsTabContent', () => {
  it.each([
    ['server', 'Form Factor'],
    ['nas', 'Drive Bays'],
    ['switch', 'Management'],
    ['patchPanel', 'Rack Units'],
  ] as const)('renders reusable specs fields for %s', (type, typeFieldLabel) => {
    render(
      <Tabs defaultValue="specs">
        <InventorySpecsTabContent
          values={valuesFor(type)}
          errors={{}}
          onChange={vi.fn()}
        />
      </Tabs>,
    )

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue(`${type} item`)
    expect(screen.getByLabelText(typeFieldLabel)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Notes' })).toBeInTheDocument()
  })

  it('renders inspector errors and reports note edits as debounced changes', () => {
    const onChange = vi.fn()

    render(
      <Tabs defaultValue="specs">
        <InventorySpecsTabContent
          values={valuesFor('server')}
          errors={{ notes: 'Notes are invalid.' }}
          validationMessage="The form is invalid."
          saveError="The item could not be saved."
          onChange={onChange}
        />
      </Tabs>,
    )

    expect(screen.getByRole('region', { name: 'Inspector errors' })).toHaveTextContent(
      'The form is invalid.',
    )
    expect(screen.getByRole('region', { name: 'Inspector errors' })).toHaveTextContent(
      'The item could not be saved.',
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Notes are invalid.')

    fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), {
      target: { value: 'Updated notes' },
    })

    expect(onChange).toHaveBeenLastCalledWith({ notes: 'Updated notes' }, 'debounced')
  })
})
