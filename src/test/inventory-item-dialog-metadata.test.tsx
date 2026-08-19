import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { InventoryItemDialog } from '@/components/inventory-item-dialog'
import { renderWithOpenAuth } from '@/test/open-auth-test-render'
import type { InventoryMetadataCatalog } from '@/types/inventory-metadata'

const catalog: InventoryMetadataCatalog = {
  revision: 1,
  definitions: [{
    id: 1,
    name: 'Asset owner',
    description: 'Person responsible for this item.',
    fieldType: 'shortText',
    unit: null,
    numberMinimum: null,
    numberMaximum: null,
    numberPrecision: null,
    displayOrder: 0,
    revision: 1,
    archivedAt: null,
    createdAt: '2026-08-19T12:00:00.000Z',
    updatedAt: '2026-08-19T12:00:00.000Z',
    applicableItemTypes: ['server'],
    options: [],
  }],
  tags: [{
    id: 2,
    name: 'Production',
    colorToken: 'green',
    displayOrder: 0,
    revision: 1,
    archivedAt: null,
    createdAt: '2026-08-19T12:00:00.000Z',
    updatedAt: '2026-08-19T12:00:00.000Z',
  }],
}

vi.mock('@/lib/inventory-metadata-query', () => ({
  useInventoryMetadataCatalog: () => ({ data: catalog, isPending: false, error: null }),
}))

describe('InventoryItemDialog metadata', () => {
  it('submits a private metadata draft with the new inventory records', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn(async () => undefined)
    renderWithOpenAuth(<InventoryItemDialog open onOpenChange={vi.fn()} onCreate={onCreate} />)

    await user.type(screen.getByLabelText('Name'), 'Metadata server')
    await user.click(screen.getByRole('tab', { name: 'Metadata' }))
    await user.click(screen.getByText('Production'))
    await user.type(screen.getByLabelText('Asset owner'), 'Infrastructure')
    await user.click(screen.getByRole('button', { name: 'Add item' }))

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'server', name: 'Metadata server' }),
      1,
      { values: [{ definitionId: 1, value: 'Infrastructure' }], tagIds: [2] },
    )
  })
})
