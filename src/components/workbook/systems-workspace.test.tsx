import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SystemsWorkspace } from '@/components/workbook/systems-workspace'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { ProjectState } from '@/types/inventory'
import type { SystemsHostRow } from '@/types/systems'

const useSystemsMock = vi.fn()

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ status: { account: { id: 7 } } }),
}))
vi.mock('@/hooks/use-systems', () => ({
  useSystems: (...args: unknown[]) => useSystemsMock(...args),
}))

const project: ProjectState = {
  id: 'project-1',
  metadata: { name: 'Default Project', version: 1, updatedAt: '2026-08-11T00:00:00.000Z', projectId: 1, workspaceId: 1 },
  items: {},
  placements: [],
  assignments: [],
  connections: [],
}

const systems: SystemsHostRow[] = [
  {
    itemId: 1,
    itemKey: 'server:1',
    type: 'server',
    legacyId: 1,
    name: 'HP EliteDesk 800 G6',
    manufacturer: 'HP',
    model: 'EliteDesk 800 G6',
    hardwareClass: 'desktop',
    usageRole: 'server',
    cpuLabel: 'Intel i5-10500T',
    memoryLabel: '32GB DDR4 2933MHz',
    storageLabel: '1TB NVMe',
    agentRegistered: true,
    agentState: 'online',
    agentVersion: '0.1.0',
    agentUpdateAvailable: false,
    registryLinked: true,
    cpuPercent: 20,
    memoryPercent: 40,
    storagePercent: 60,
  },
  {
    itemId: 2,
    itemKey: 'nas:1',
    type: 'nas',
    legacyId: 1,
    name: 'Synology DS620slim',
    manufacturer: 'Synology',
    model: 'DS620slim',
    hardwareClass: null,
    usageRole: null,
    cpuLabel: null,
    memoryLabel: '8GB DDR3L 1600MHz',
    storageLabel: '4TB SATA',
    agentRegistered: false,
    agentState: 'unregistered',
    agentVersion: null,
    agentUpdateAvailable: false,
    registryLinked: false,
    cpuPercent: null,
    memoryPercent: null,
    storagePercent: null,
  },
]

function renderWorkspace(props: Partial<ComponentProps<typeof SystemsWorkspace>> = {}) {
  return render(
    <TooltipProvider>
      <SystemsWorkspace
        project={project}
        selectedItemId={null}
        onSelectItem={() => {}}
        onCloseInspector={() => {}}
        {...props}
      />
    </TooltipProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  useSystemsMock.mockReturnValue({
    initial: { data: { systems }, isPending: false, isError: false },
    live: { data: null },
  })
})

describe('SystemsWorkspace', () => {
  it('renders dense operational columns and host states', () => {
    renderWorkspace()
    expect(screen.getByRole('heading', { name: 'Systems' })).toBeVisible()
    expect(screen.getByText('Intel i5-10500T')).toBeVisible()
    expect(screen.getByLabelText('Agent online')).toBeVisible()
    expect(screen.getByLabelText('Synology DS620slim is not linked to the registry')).toBeVisible()
    expect(screen.queryByText('Physical class')).not.toBeInTheDocument()
  })

  it('searches hosts and opens the inspector from the full row', () => {
    const onSelectItem = vi.fn()
    renderWorkspace({ onSelectItem })
    fireEvent.change(screen.getByPlaceholderText('Search systems'), { target: { value: 'Synology' } })
    expect(screen.queryByText('HP EliteDesk 800 G6')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Synology DS620slim'))
    expect(onSelectItem).toHaveBeenCalledWith('nas:1')
  })

  it('closes the selected inspector with Escape', () => {
    const onCloseInspector = vi.fn()
    renderWorkspace({ selectedItemId: 'server:1', onCloseInspector })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCloseInspector).toHaveBeenCalledOnce()
  })
})
