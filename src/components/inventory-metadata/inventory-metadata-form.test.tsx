import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { InventoryMetadataForm } from './inventory-metadata-form'
import type { CustomFieldDefinition, InventoryTag } from '@/types/inventory-metadata'

const timestamp = '2026-08-19T12:00:00.000Z'

const field: CustomFieldDefinition = {
  id: 1,
  name: 'Asset owner',
  description: null,
  fieldType: 'shortText',
  unit: null,
  numberMinimum: null,
  numberMaximum: null,
  numberPrecision: null,
  displayOrder: 0,
  revision: 1,
  archivedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  applicableItemTypes: ['server'],
  options: [],
}

const tag: InventoryTag = {
  id: 1,
  name: 'Production',
  colorToken: 'green',
  displayOrder: 0,
  revision: 1,
  archivedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
}

describe('InventoryMetadataForm empty actions', () => {
  it('opens the matching settings destination from each empty section', async () => {
    const user = userEvent.setup()
    const onCreateTag = vi.fn()
    const onCreateField = vi.fn()

    render(
      <InventoryMetadataForm
        definitions={[]}
        tags={[]}
        draft={{ tagIds: [], values: {} }}
        onChange={vi.fn()}
        onCreateTag={onCreateTag}
        onCreateField={onCreateField}
      />,
    )

    expect(screen.queryByText('Installation-defined data that stays outside Registry catalog content.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'New tag' }))
    await user.click(screen.getByRole('button', { name: 'New custom field' }))

    expect(onCreateTag).toHaveBeenCalledOnce()
    expect(onCreateField).toHaveBeenCalledOnce()
  })

  it('keeps informative empty states without management actions for read-only users', () => {
    render(
      <InventoryMetadataForm
        definitions={[]}
        tags={[]}
        draft={{ tagIds: [], values: {} }}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('No active tags are available.')).toBeInTheDocument()
    expect(screen.getByText('No custom fields apply to this inventory type.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New tag' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New custom field' })).not.toBeInTheDocument()
  })

  it('does not duplicate creation actions when applicable metadata exists', () => {
    render(
      <InventoryMetadataForm
        definitions={[field]}
        tags={[tag]}
        draft={{ tagIds: [], values: {} }}
        onChange={vi.fn()}
        onCreateTag={vi.fn()}
        onCreateField={vi.fn()}
      />,
    )

    expect(screen.getByText('Production')).toBeInTheDocument()
    expect(screen.getByText('Asset owner')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New tag' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New custom field' })).not.toBeInTheDocument()
  })
})
