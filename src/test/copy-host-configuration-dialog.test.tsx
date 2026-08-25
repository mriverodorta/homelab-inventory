import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CopyHostConfigurationDialog } from '@/components/inspector/equipment/copy-host-configuration-dialog'
import { createEmptyProject } from '@/lib/project'
import type { WorkspaceSummary } from '@/lib/workbook-api'
import type { InventoryItem, ProjectState } from '@/types/inventory'

const loadWorkspace = vi.hoisted(() => vi.fn())

vi.mock('@/lib/workbook-api', () => ({
  loadWorkspace,
}))

const host: InventoryItem = {
  id: 7,
  inventoryId: 48,
  key: 'server:7',
  type: 'server',
  name: 'Dell OptiPlex Micro 7090',
}

function project(workspaceId: number, placed = false): ProjectState {
  const value = createEmptyProject([host])
  return {
    ...value,
    metadata: { ...value.metadata, projectId: 1, workspaceId },
    placements: placed ? [{ serverId: 'server:7', x: 24, y: 36 }] : [],
  }
}

const workspaces: WorkspaceSummary[] = [
  {
    id: 2,
    projectId: 1,
    type: 'canvas',
    name: 'Canvas',
    iconKey: 'network',
    colorKey: 'blue',
    sortOrder: 1,
    revision: 1,
    systemKey: null,
  },
  {
    id: 3,
    projectId: 1,
    type: 'canvas',
    name: 'Current',
    iconKey: 'network',
    colorKey: 'green',
    sortOrder: 2,
    revision: 1,
    systemKey: null,
  },
]

describe('host configuration copy dialog', () => {
  beforeEach(() => {
    loadWorkspace.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the current canvas as the source and copies into the selected destination', async () => {
    const source = project(2, true)
    const destination = project(3)
    const onApply = vi.fn(async () => undefined)
    const onOpenChange = vi.fn()
    loadWorkspace.mockResolvedValue(destination)

    render(
      <CopyHostConfigurationDialog
        open
        project={source}
        hostId="server:7"
        workspaces={workspaces}
        onOpenChange={onOpenChange}
        onApply={onApply}
      />,
    )

    expect(screen.getByText('Destination canvas')).toBeInTheDocument()
    expect(screen.queryByText('Source canvas')).not.toBeInTheDocument()
    await waitFor(() => expect(loadWorkspace).toHaveBeenCalledWith(1, 3))
    const copy = await screen.findByRole('button', { name: 'Copy configuration' })
    await waitFor(() => expect(copy).toBeEnabled())

    fireEvent.click(copy)

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(destination, expect.objectContaining({
      metadata: expect.objectContaining({ projectId: 1, workspaceId: 3 }),
      placements: [{ serverId: 'server:7', x: 24, y: 36 }],
    })))
    expect(source.placements).toEqual([{ serverId: 'server:7', x: 24, y: 36 }])
    expect(destination.placements).toEqual([])
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('keeps the dialog open and reports a destination persistence failure', async () => {
    loadWorkspace.mockResolvedValue(project(3))
    const onOpenChange = vi.fn()
    const onApply = vi.fn(async () => {
      throw new Error('The destination canvas could not be saved.')
    })

    render(
      <CopyHostConfigurationDialog
        open
        project={project(2, true)}
        hostId="server:7"
        workspaces={workspaces}
        onOpenChange={onOpenChange}
        onApply={onApply}
      />,
    )

    const copy = await screen.findByRole('button', { name: 'Copy configuration' })
    await waitFor(() => expect(copy).toBeEnabled())
    fireEvent.click(copy)

    expect(await screen.findByText('The destination canvas could not be saved.')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
