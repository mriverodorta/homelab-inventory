import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { DeepReadonly, SharedSystemsModel, SharedWorkbookModel } from '@homelab-inventory/viewer-model'

import { SharedWorkbookViewer } from '../src'

const workbook = {
  projectPublicId: 'project_public_01',
  projectLabel: 'Primary Homelab',
  title: 'Primary Homelab',
  description: 'A sanitized public view.',
  initialViewPublicId: 'view_systems_001',
  views: [
    {
      publicViewId: 'view_systems_001',
      type: 'systems',
      schemaVersion: 1,
      contentHash: 'a'.repeat(64),
      sortOrder: 0,
      name: 'Systems',
    },
    {
      publicViewId: 'view_canvas_0001',
      type: 'canvas',
      schemaVersion: 1,
      contentHash: 'b'.repeat(64),
      sortOrder: 1,
      name: 'Canvas',
    },
  ],
} as DeepReadonly<SharedWorkbookModel>

const systems = {
  publicViewId: 'view_systems_001',
  rows: [
    {
      publicItemId: 'item_server_0001',
      type: 'server',
      name: 'Dell OptiPlex Micro 7090',
      manufacturer: 'Dell',
      model: 'OptiPlex Micro 7090',
      source: { type: 'custom', definition: {} },
      ports: [],
      tags: [],
      customFields: [],
    },
  ],
} as DeepReadonly<SharedSystemsModel>

describe('SharedWorkbookViewer', () => {
  it('emits closed navigation intents and exposes no editor commands', async () => {
    const user = userEvent.setup()
    const onIntent = vi.fn()

    render(
      <SharedWorkbookViewer
        model={workbook}
        viewModels={{ view_systems_001: systems }}
        onIntent={onIntent}
      />,
    )

    await user.click(screen.getByRole('tab', { name: 'Canvas' }))
    expect(onIntent).toHaveBeenCalledWith({ type: 'select-view', publicViewId: 'view_canvas_0001' })
    expect(screen.queryByRole('button', { name: /delete|edit|save/i })).not.toBeInTheDocument()
  })

  it('supports keyboard tab navigation and renders mobile-safe overflow hooks', async () => {
    const user = userEvent.setup()
    const onIntent = vi.fn()
    const { container } = render(
      <SharedWorkbookViewer
        model={workbook}
        viewModels={{ view_systems_001: systems }}
        onIntent={onIntent}
      />,
    )

    const systemsTab = screen.getByRole('tab', { name: 'Systems' })
    systemsTab.focus()
    await user.keyboard('{ArrowRight}{Enter}')

    expect(screen.getByRole('tab', { name: 'Canvas' })).toHaveFocus()
    expect(onIntent).toHaveBeenCalledWith({ type: 'select-view', publicViewId: 'view_canvas_0001' })
    expect(container.querySelector('.hi-share-viewer__tabs-scroll')).toHaveAttribute(
      'data-mobile-overflow',
      'horizontal',
    )
    expect(container.firstElementChild).toHaveClass('hi-share-viewer')
  })
})
