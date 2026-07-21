import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GlobalItemSearch } from '@/components/global-item-search'
import type { ProjectState } from '@/types/inventory'

const project: ProjectState = {
  id: 'default-project',
  metadata: {
    name: 'Test Project',
    version: 1,
    updatedAt: '2026-06-26T00:00:00.000Z',
  },
  items: {
    'server:1': {
      id: 1,
      key: 'server:1',
      name: 'Dell OptiPlex Micro 7090',
      type: 'server',
      manufacturer: 'Dell',
      model: 'OptiPlex Micro 7090',
      properties: {
        displayName: 'Proxmox 01',
      },
    },
    'switch:1': {
      id: 1,
      key: 'switch:1',
      name: 'Omada ES210X-M2 #1',
      type: 'switch',
      manufacturer: 'TP-Link',
      model: 'ES210X-M2',
    },
  },
  placements: [{ serverId: 'server:1', x: 0, y: 0 }],
  assignments: [],
  connections: [],
}

afterEach(() => {
  cleanup()
})

describe('GlobalItemSearch', () => {
  it('requests open on the command shortcut', () => {
    const onOpenChange = vi.fn()

    render(
      <GlobalItemSearch
        project={project}
        open={false}
        onOpenChange={onOpenChange}
        onSelectItem={vi.fn()}
      />,
    )

    fireEvent.keyDown(window, { key: 'k', metaKey: true })

    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('filters and selects inventory items', () => {
    const onOpenChange = vi.fn()
    const onSelectItem = vi.fn()

    render(
      <GlobalItemSearch
        project={project}
        open
        onOpenChange={onOpenChange}
        onSelectItem={onSelectItem}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('Search servers, ports, cables, specs...'), {
      target: { value: 'proxmox' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Dell OptiPlex Micro 7090/i }))

    expect(onSelectItem).toHaveBeenCalledWith('server:1')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
