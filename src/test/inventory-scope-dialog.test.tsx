import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InventoryScopeDialog } from '@/components/inventory-scope-dialog'

const projects = [
  { id: 1, name: 'Default Project', description: null, iconKey: 'house' as const, revision: 1, includesGlobalInventory: true },
  { id: 2, name: 'Downsize Plan', description: null, iconKey: 'folder' as const, revision: 1, includesGlobalInventory: true },
]

describe('InventoryScopeDialog', () => {
  it('confirms conversion to global inventory', () => {
    const onConfirm = vi.fn()
    render(
      <InventoryScopeDialog
        open
        action="make-global"
        itemName="Planning CPU"
        activeProjectId={1}
        projects={projects}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    )
    expect(screen.getByText(/explicitly shared with other projects/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Make global' }))
    expect(onConfirm).toHaveBeenCalledWith(undefined)
  })

  it('offers only other projects as duplicate targets', () => {
    render(
      <InventoryScopeDialog
        open
        action="duplicate-to-project"
        itemName="Planning CPU"
        activeProjectId={1}
        projects={projects}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    expect(screen.getByRole('combobox', { name: 'Target project' })).toHaveTextContent('Downsize Plan')
    expect(screen.queryByText('Default Project')).not.toBeInTheDocument()
  })
})
