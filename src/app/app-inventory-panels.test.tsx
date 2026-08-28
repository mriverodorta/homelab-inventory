import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppInventoryPanels, type AppInventoryPanelsProps } from '@/app/app-inventory-panels'
import type { InventorySidebarController } from '@/components/inventory/use-inventory-sidebar-controller'

vi.mock('@/components/desktop-inventory-shell', () => ({
  DesktopInventoryShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="desktop-inventory">{children}</div>
  ),
}))

function ControllerInput({
  controller,
  surface,
}: {
  controller: InventorySidebarController
  surface: string
}) {
  return (
    <label>
      {surface}
      <input
        aria-label={`${surface} query`}
        value={controller.filters.query}
        onChange={(event) => controller.setFilters((current) => ({
          ...current,
          query: event.target.value,
        }))}
      />
      <button
        type="button"
        onClick={() => {
          controller.setSelectionMode(true)
          controller.setSelectedItemIds(new Set(['server:7']))
        }}
      >
        Select item
      </button>
      <output aria-label={`${surface} selection`}>
        {`${controller.selectionMode}:${controller.selectedItemIds.size}`}
      </output>
    </label>
  )
}

vi.mock('@/components/lazy-inventory-sidebar', () => ({
  InventorySidebar: ({ controller }: { controller: InventorySidebarController }) => (
    <ControllerInput controller={controller} surface="desktop" />
  ),
}))

vi.mock('@/components/lazy-mobile-inventory-sheet', () => ({
  MobileInventorySheet: ({ controller }: { controller: InventorySidebarController }) => (
    <div data-testid="mobile-inventory">
      <ControllerInput controller={controller} surface="mobile" />
    </div>
  ),
}))

function props(
  preferenceScope = 'account:1:project:1:workspace:2',
  desktopLayout = true,
) {
  return {
    preferenceScope,
    desktopLayout,
    desktop: {
      expanded: true,
      width: 420,
      onResizePointerDown: vi.fn(),
    },
    sidebar: {},
    mobile: {},
  } as unknown as AppInventoryPanelsProps
}

describe('AppInventoryPanels', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('mounts one responsive inventory tree and preserves controller state across breakpoints', () => {
    const view = render(<AppInventoryPanels {...props()} />)

    expect(screen.getByTestId('desktop-inventory')).toBeInTheDocument()
    expect(screen.queryByTestId('mobile-inventory')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'desktop query' }), {
      target: { value: '7090' },
    })

    view.rerender(<AppInventoryPanels {...props('account:1:project:1:workspace:2', false)} />)

    expect(screen.queryByTestId('desktop-inventory')).not.toBeInTheDocument()
    expect(screen.getByTestId('mobile-inventory')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'mobile query' })).toHaveValue('7090')
  })

  it('restores separate durable view state for each Canvas and resets selection', () => {
    const view = render(<AppInventoryPanels {...props()} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'desktop query' }), {
      target: { value: 'canvas-a' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Select item' }))
    expect(screen.getByLabelText('desktop selection')).toHaveTextContent('true:1')

    view.rerender(<AppInventoryPanels {...props('account:1:project:1:workspace:3')} />)
    expect(screen.getByRole('textbox', { name: 'desktop query' })).toHaveValue('')
    expect(screen.getByLabelText('desktop selection')).toHaveTextContent('false:0')
    fireEvent.change(screen.getByRole('textbox', { name: 'desktop query' }), {
      target: { value: 'canvas-b' },
    })

    view.rerender(<AppInventoryPanels {...props()} />)
    expect(screen.getByRole('textbox', { name: 'desktop query' })).toHaveValue('canvas-a')
    expect(screen.getByLabelText('desktop selection')).toHaveTextContent('false:0')
  })

  it('restores scoped state after the inventory presentation unmounts on Systems', () => {
    const view = render(<AppInventoryPanels {...props()} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'desktop query' }), {
      target: { value: 'persistent' },
    })

    view.rerender(<div>Systems</div>)
    view.rerender(<AppInventoryPanels {...props()} />)

    expect(screen.getByRole('textbox', { name: 'desktop query' })).toHaveValue('persistent')
  })

  it('falls back to the default view for corrupt scoped storage', () => {
    const scope = 'account:1:project:1:workspace:2'
    window.localStorage.setItem(`homelab-inventory:inventory-sidebar:v1:${scope}`, '{broken')

    render(<AppInventoryPanels {...props(scope)} />)

    expect(screen.getByRole('textbox', { name: 'desktop query' })).toHaveValue('')
  })
})
