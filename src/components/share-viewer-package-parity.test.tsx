import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { parseShareManifest, parseShareViewBlob } from '@homelab-inventory/share-contract'
import {
  createSharedCanvasModel,
  createSharedSystemsModel,
  createSharedWorkbookModel,
} from '@homelab-inventory/viewer-model'
import { SharedWorkbookViewer } from '@homelab-inventory/viewer-react'
import { createCanvasStringIdSet } from '@/components/canvas/use-canvas-project-model'
import { compareSystemsTextValues } from '@/components/workbook/systems/systems-table-model'
import { orderWorkbookTabs } from '@/components/workbook/workbook-tab-strip'

const fixtureDirectory = resolve('docs/handoffs/lab-gd-contract-v1/fixtures')
const fixture = (name: string) => JSON.parse(readFileSync(resolve(fixtureDirectory, name), 'utf8')) as unknown

describe('shared viewer package parity', () => {
  it('preserves production-shaped labels, ordering, placement, ports, and endpoints', () => {
    const manifest = parseShareManifest(fixture('manifest-v1.json'))
    const systemsBlob = parseShareViewBlob(fixture('systems-v1.json'))
    const canvasBlob = parseShareViewBlob(fixture('canvas-v1.json'))

    const workbook = createSharedWorkbookModel(manifest)
    const systems = createSharedSystemsModel(systemsBlob)
    const canvas = createSharedCanvasModel(canvasBlob)

    expect(workbook.views.map((view) => view.name)).toEqual(['Systems', 'Canvas'])
    expect(compareSystemsTextValues('Server 2', 'server 10')).toBeLessThan(0)
    expect([...createCanvasStringIdSet([1, '2', 1])]).toEqual(['1', '2'])
    expect(orderWorkbookTabs([
      { name: 'Canvas', sortOrder: 2 },
      { name: 'Systems', sortOrder: 0 },
    ]).map((view) => view.name)).toEqual(['Systems', 'Canvas'])
    expect(systems.rows[0]?.name).toBe('Dell OptiPlex Micro 7090')
    expect(systems.rows[0]?.ports[0]).toMatchObject({
      name: 'Ethernet 1',
      connector: 'rj45',
      speedBps: 1_000_000_000,
    })
    expect(canvas.nodes.map((node) => ({
      name: node.item.name,
      position: node.position,
      size: node.size,
    }))).toEqual([
      {
        name: 'Dell OptiPlex Micro 7090',
        position: { x: 96, y: 120 },
        size: { width: 240, height: 144 },
      },
      {
        name: 'Eight-port Network Switch',
        position: { x: 480, y: 120 },
        size: { width: 288, height: 120 },
      },
    ])
    expect(canvas.connections[0]).toMatchObject({
      source: { publicItemId: 'item_server_0001', port: { name: 'Ethernet 1' } },
      target: { publicItemId: 'item_switch_0001', port: { name: 'Port 1' } },
    })
  })

  it('renders the app-compatible read-only workbook without editor controls', () => {
    const workbook = createSharedWorkbookModel(fixture('manifest-v1.json'))
    const systems = createSharedSystemsModel(fixture('systems-v1.json'))
    const canvas = createSharedCanvasModel(fixture('canvas-v1.json'))

    render(
      <SharedWorkbookViewer
        model={workbook}
        viewModels={{
          [systems.publicViewId]: systems,
          [canvas.publicViewId]: canvas,
        }}
        onIntent={vi.fn()}
      />,
    )

    expect(screen.getByRole('tab', { name: 'Systems' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Dell OptiPlex Micro 7090' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete|edit|save/i })).not.toBeInTheDocument()
  })
})
