import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InventoryMetadataSettings } from '@/components/settings/inventory-metadata/inventory-metadata-settings'
import { renderWithOpenAuth } from '@/test/open-auth-test-render'
import type { CustomFieldDefinition, InventoryMetadataCatalog, InventoryTag } from '@/types/inventory-metadata'

const mocks = vi.hoisted(() => ({
  canManage: true,
  includeArchived: false,
  catalog: null as InventoryMetadataCatalog | null,
}))

function mutation() {
  return { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isError: false, error: null }
}

vi.mock('@/hooks/use-permission', () => ({
  usePermission: () => mocks.canManage,
}))

vi.mock('@/lib/inventory-metadata-query', () => ({
  useInventoryMetadataCatalog: ({ includeArchived }: { includeArchived: boolean }) => {
    mocks.includeArchived = includeArchived
    return { data: mocks.catalog, isPending: false, error: null }
  },
  useInventoryMetadataMutations: () => ({
    createField: mutation(), updateField: mutation(), archiveField: mutation(), deleteField: mutation(), reorderFields: mutation(),
    createTag: mutation(), updateTag: mutation(), archiveTag: mutation(), deleteTag: mutation(), reorderTags: mutation(), updateItem: mutation(),
  }),
}))

const timestamp = '2026-08-19T12:00:00.000Z'

function field(overrides: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition {
  return {
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
    createdAt: timestamp,
    updatedAt: timestamp,
    applicableItemTypes: ['server'],
    options: [],
    ...overrides,
  }
}

function tag(overrides: Partial<InventoryTag> = {}): InventoryTag {
  return {
    id: 1,
    name: 'Production',
    colorToken: 'green',
    displayOrder: 0,
    revision: 1,
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}

beforeEach(() => {
  mocks.canManage = true
  mocks.includeArchived = false
  mocks.catalog = { revision: 1, definitions: [field()], tags: [tag()] }
})

function renderSettings(props: Parameters<typeof InventoryMetadataSettings>[0] = {}) {
  return renderWithOpenAuth(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <InventoryMetadataSettings {...props} />
    </QueryClientProvider>,
  )
}

describe('InventoryMetadataSettings', () => {
  it('presents private installation metadata without exposing archived records by default', () => {
    renderSettings()

    expect(screen.getByText('Asset owner')).toBeInTheDocument()
    expect(screen.getByText('Metadata stays local and is excluded from Registry contributions.')).toBeInTheDocument()
    expect(mocks.includeArchived).toBe(false)
  })

  it('requests archived definitions only after the user opts in', () => {
    renderSettings()

    fireEvent.click(screen.getByRole('switch'))

    expect(mocks.includeArchived).toBe(true)
  })

  it('keeps management commands visible but disabled without the management permission', () => {
    mocks.canManage = false
    renderSettings()

    expect(screen.getByRole('button', { name: 'New field' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Asset owner actions' })).toBeDisabled()
  })

  it('shows archived records as restorable and permanently deletable', async () => {
    const user = userEvent.setup()
    mocks.catalog = {
      revision: 2,
      definitions: [field({ archivedAt: timestamp })],
      tags: [tag({ archivedAt: timestamp })],
    }
    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Asset owner actions' }))

    expect(screen.getByRole('menuitem', { name: 'Restore' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete permanently' })).toBeInTheDocument()
  })

  it('selects and updates the requested metadata settings tab', () => {
    const view = renderSettings({ requestedTab: 'tags', requestId: 1 })

    expect(screen.getByRole('tab', { name: 'Tags' })).toHaveAttribute('aria-selected', 'true')

    view.rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <InventoryMetadataSettings requestedTab="fields" requestId={2} />
      </QueryClientProvider>,
    )

    expect(screen.getByRole('tab', { name: 'Custom fields' })).toHaveAttribute('aria-selected', 'true')
  })
})
