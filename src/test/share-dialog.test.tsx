import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ShareDialog } from '@/components/settings/sharing/share-dialog'
import type { ShareInput, SharingCapabilities } from '@/lib/sharing-api'
import type { ProjectWorkbook } from '@/lib/workbook-api'
import type { InventoryMetadataCatalog } from '@/types/inventory-metadata'

const workbooks: ProjectWorkbook[] = [{
  project: {
    id: 1,
    name: 'Homelab',
    description: null,
    iconKey: 'folder',
    revision: 1,
    includesGlobalInventory: true,
  },
  defaultWorkspaceId: 1,
  workspaces: [
    { id: 1, projectId: 1, type: 'systems', name: 'Systems', iconKey: 'network', colorKey: 'gray', sortOrder: 0, revision: 1, systemKey: 'systems' },
    { id: 2, projectId: 1, type: 'canvas', name: 'Network', iconKey: 'network', colorKey: 'violet', sortOrder: 1, revision: 1, systemKey: null },
  ],
}]

const timestamp = '2026-08-22T12:00:00.000Z'
const metadata: InventoryMetadataCatalog = {
  revision: 1,
  tags: [{ id: 1, name: 'Public rack', colorToken: 'purple', displayOrder: 0, revision: 1, archivedAt: null, createdAt: timestamp, updatedAt: timestamp }],
  definitions: [{
    id: 1,
    name: 'Owner note',
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
  }],
}

const capabilities: SharingCapabilities = {
  version: 1,
  publication: true,
  accountClaiming: false,
  installationEvents: false,
  ownerAnalytics: false,
  protectedShares: false,
  remoteLifecycle: false,
  views: ['systems', 'canvas'],
  visibility: ['public', 'unlisted'],
  mutability: ['immutable', 'replaceable'],
  synchronization: ['manual', 'synchronized'],
  embeds: true,
  resourceSnapshots: true,
  comments: 'coming-soon',
  reactions: 'coming-soon',
}

describe('ShareDialog', () => {
  it('uses a viewport-contained wide editor with a fixed header and footer', () => {
    render(<ShareDialog open workbooks={workbooks} metadata={metadata} capabilities={capabilities} busy={false} onOpenChange={vi.fn()} onSave={vi.fn()} />)

    expect(screen.getByRole('dialog')).toHaveClass(
      'sm:max-w-3xl',
      'grid-rows-[auto_minmax(0,1fr)_auto]',
      'overflow-hidden',
    )
  })

  it('excludes metadata and resource usage by default', async () => {
    const onSave = vi.fn<(input: ShareInput) => Promise<void>>(async () => {})
    render(<ShareDialog open workbooks={workbooks} metadata={metadata} capabilities={capabilities} busy={false} onOpenChange={vi.fn()} onSave={onSave} />)

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My lab' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create share' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    expect(onSave.mock.calls[0][0]).toMatchObject({
      projectId: 1,
      visibility: 'unlisted',
      resourceSnapshotIncluded: false,
      fieldDefinitionIds: [],
      tagIds: [],
      views: [{ workspaceId: 1, viewType: 'systems' }],
    })
  })

  it('selects project views and optional fields explicitly', async () => {
    const onSave = vi.fn<(input: ShareInput) => Promise<void>>(async () => {})
    render(<ShareDialog open workbooks={workbooks} metadata={metadata} capabilities={capabilities} busy={false} onOpenChange={vi.fn()} onSave={onSave} />)

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Rack plan' } })
    fireEvent.click(screen.getByRole('button', { name: 'Select whole project' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Public rack' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Owner note' }))
    fireEvent.click(screen.getByRole('switch', { name: /Current resource usage/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Create share' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    expect(onSave.mock.calls[0][0]).toMatchObject({
      resourceSnapshotIncluded: true,
      fieldDefinitionIds: [1],
      tagIds: [1],
      views: [
        { workspaceId: 1, viewType: 'systems' },
        { workspaceId: 2, viewType: 'canvas' },
      ],
    })
  })

  it('does not offer password protection before capability negotiation succeeds', () => {
    render(<ShareDialog open workbooks={workbooks} metadata={null} capabilities={capabilities} busy={false} onOpenChange={vi.fn()} onSave={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Password/ })).not.toBeInTheDocument()
  })
})
