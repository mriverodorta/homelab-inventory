import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { DeepReadonly, SharedCanvasModel } from '@homelab-inventory/viewer-model'

import { SharedCanvasViewer, SharedInspector } from '../src'

const item = {
  publicItemId: 'item_server_0001',
  type: 'server',
  name: 'Dell OptiPlex Micro 7090',
  manufacturer: 'Dell',
  model: 'OptiPlex Micro 7090',
  source: { type: 'custom' as const, definition: {} },
  ports: [],
  tags: [],
  customFields: [],
}

const canvas = {
  publicViewId: 'view_canvas_0001',
  items: [item],
  nodes: [
    {
      publicNodeId: 'node_server_0001',
      publicItemId: item.publicItemId,
      position: { x: 96, y: 120 },
      size: { width: 240, height: 144 },
      zIndex: 1,
      item,
    },
  ],
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
} as DeepReadonly<SharedCanvasModel>

describe('SharedCanvasViewer', () => {
  it('renders a non-editable canvas and emits selection and fit intents', async () => {
    const user = userEvent.setup()
    const onIntent = vi.fn()
    render(<SharedCanvasViewer model={canvas} onIntent={onIntent} />)

    await user.click(screen.getByRole('button', { name: 'Dell OptiPlex Micro 7090' }))
    expect(onIntent).toHaveBeenCalledWith({
      type: 'select-item',
      publicViewId: 'view_canvas_0001',
      publicItemId: 'item_server_0001',
    })

    await user.click(screen.getByRole('button', { name: 'Fit view' }))
    expect(onIntent).toHaveBeenCalledWith({ type: 'fit-view' })
    expect(screen.queryByRole('button', { name: /delete|edit|save/i })).not.toBeInTheDocument()
  })

  it('closes the inspector with Escape', async () => {
    const user = userEvent.setup()
    const onIntent = vi.fn()
    render(<SharedInspector item={item} onIntent={onIntent} />)

    await user.keyboard('{Escape}')
    expect(onIntent).toHaveBeenCalledWith({ type: 'clear-selection' })
  })

  it('marks motion as reducible and keeps overflow contained by its root', () => {
    const { container } = render(<SharedCanvasViewer model={canvas} onIntent={vi.fn()} />)
    expect(container.querySelector('.hi-share-viewer__canvas')).toHaveAttribute('data-reduced-motion-safe')
    expect(container.querySelector('.hi-share-viewer__canvas-shell')).toHaveAttribute(
      'data-page-overflow',
      'contained',
    )
  })
})
