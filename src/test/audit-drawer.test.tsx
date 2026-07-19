import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuditDrawer } from '@/components/audit-drawer'
import { getProjectAuditWarnings } from '@/lib/audit'
import { setAuditWarningIgnored } from '@/lib/compatibility-policy'
import type { ProjectState } from '@/types/inventory'

const project: ProjectState = {
  id: 'test-project',
  metadata: {
    name: 'Test Project',
    version: 1,
    updatedAt: '2026-06-26T00:00:00.000Z',
  },
  items: {
    server: {
      id: 'server',
      name: 'Server A',
      type: 'server',
      ports: [
        {
          id: 'lan-01',
          kind: 'server-port',
          type: 'rj45',
          slotNumber: 1,
          speed: '1G',
        },
      ],
    },
    switch: {
      id: 'switch',
      name: 'Switch A',
      type: 'switch',
      ports: [
        {
          id: 'rj45-01',
          kind: 'switch-port',
          type: 'rj45',
          slotNumber: 1,
          speed: '2.5G',
        },
      ],
    },
  },
  placements: [
    {
      serverId: 'switch',
      x: 0,
      y: 0,
    },
  ],
  assignments: [],
  connections: [
    {
      id: 'connection-1',
      from: {
        itemId: 'switch',
        portId: 'rj45-01',
      },
      to: {
        itemId: 'server',
        portId: 'lan-01',
      },
      type: 'network',
      createdAt: '2026-06-26T00:00:00.000Z',
    },
  ],
}

const compatibilityProject: ProjectState = {
  id: 'compatibility-project',
  metadata: {
    name: 'Compatibility Project',
    version: 1,
    updatedAt: '2026-07-19T00:00:00.000Z',
  },
  items: {
    host: {
      id: 'host',
      name: 'Compatibility Host',
      type: 'server',
      compatibility: {
        host: {
          cpu: { sockets: ['LGA1200'], generations: ['10'], maxTdpWatts: 35 },
          memory: {
            generations: ['DDR4'],
            slots: 2,
            maxCapacityGb: 32,
            maxModuleCapacityGb: 16,
            maxSpeedMt: 2666,
          },
          storageSlots: [
            {
              id: 'm2-slot',
              label: 'M.2 Slot',
              count: 1,
              interfaces: ['NVMe'],
              formFactors: ['2280'],
            },
          ],
        },
      },
    },
    cpu: {
      id: 'cpu',
      name: 'Mismatch CPU',
      type: 'cpu',
      compatibility: {
        requirements: {
          cpu: { socket: 'LGA1700', generation: '12', tdpWatts: 65 },
        },
      },
    },
    ram: {
      id: 'ram',
      name: 'Fast RAM',
      type: 'ram',
      specs: { capacityGb: 16, moduleCount: 1, generation: 'DDR4', speedMt: 3200 },
    },
    storage: {
      id: 'storage',
      name: 'Unknown Storage',
      type: 'storage',
      specs: { interface: 'NVMe' },
    },
  },
  placements: [{ serverId: 'host', x: 0, y: 0 }],
  assignments: [
    {
      id: 1,
      serverId: 'host',
      itemId: 'cpu',
      type: 'cpu',
      assignedAt: '2026-07-19T00:00:00.000Z',
    },
    {
      id: 2,
      serverId: 'host',
      itemId: 'ram',
      type: 'ram',
      assignedAt: '2026-07-19T00:01:00.000Z',
    },
    {
      id: 3,
      serverId: 'host',
      itemId: 'storage',
      type: 'storage',
      assignedAt: '2026-07-19T00:02:00.000Z',
    },
  ],
  connections: [],
}

function StatefulAuditDrawer({
  initialProject,
  onSelectItem,
  onSetWarningIgnored,
}: {
  initialProject: ProjectState
  onSelectItem: (itemId: string) => void
  onSetWarningIgnored: (warningId: string, ignored: boolean) => void
}) {
  const [currentProject, setCurrentProject] = useState(initialProject)

  return (
    <AuditDrawer
      project={currentProject}
      open
      onClose={vi.fn()}
      onSelectItem={onSelectItem}
      onSetWarningIgnored={(warningId, ignored) => {
        onSetWarningIgnored(warningId, ignored)
        setCurrentProject((project) => setAuditWarningIgnored(project, warningId, ignored))
      }}
    />
  )
}

afterEach(() => {
  cleanup()
})

describe('AuditDrawer', () => {
  it('renders grouped audit warnings and selects an item from a warning', () => {
    const onSelectItem = vi.fn()

    render(
      <AuditDrawer
        project={project}
        open
        onClose={vi.fn()}
        onSelectItem={onSelectItem}
        onSetWarningIgnored={vi.fn()}
      />,
    )

    expect(screen.getByText('Audit')).toBeInTheDocument()
    expect(screen.queryByText('Server A')).not.toBeInTheDocument()
    expect(screen.getByText('Switch A')).toBeInTheDocument()
    expect(screen.getByText('Switch has active connections but no uplink or trunk port marked.')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Switch has active connections but no uplink or trunk port marked.'))

    expect(onSelectItem).toHaveBeenCalledWith('switch')
  })

  it('filters warnings by item type', () => {
    render(
      <AuditDrawer
        project={project}
        open
        onClose={vi.fn()}
        onSelectItem={vi.fn()}
        onSetWarningIgnored={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switches' }))

    expect(screen.queryByText('Server A')).not.toBeInTheDocument()
    expect(screen.getByText('Switch A')).toBeInTheDocument()
  })

  it('renders compatibility severities and focuses the affected host', () => {
    const onSelectItem = vi.fn()

    const { container } = render(
      <AuditDrawer
        project={compatibilityProject}
        open
        onClose={vi.fn()}
        onSelectItem={onSelectItem}
        onSetWarningIgnored={vi.fn()}
      />,
    )

    expect(container.querySelectorAll('[data-severity="error"]')).not.toHaveLength(0)
    expect(container.querySelectorAll('[data-severity="warning"]')).not.toHaveLength(0)
    expect(container.querySelectorAll('[data-severity="unknown"]')).not.toHaveLength(0)

    fireEvent.click(screen.getByText(/CPU socket LGA1700 is not supported/))

    expect(onSelectItem).toHaveBeenCalledWith('host')
  })

  it('shows ignored warnings only in the Ignored filter and keeps the badge count open-only', () => {
    const warnings = getProjectAuditWarnings(compatibilityProject).flatMap((group) => group.warnings)
    const ignoredWarning = warnings.find((warning) => warning.code === 'cpu.socket.mismatch')

    expect(ignoredWarning).toBeDefined()

    const ignoredProject: ProjectState = {
      ...compatibilityProject,
      compatibilityPolicy: {
        disabledHostIds: [],
        ignoredWarningIds: [ignoredWarning!.id],
      },
    }

    render(
      <AuditDrawer
        project={ignoredProject}
        open
        onClose={vi.fn()}
        onSelectItem={vi.fn()}
        onSetWarningIgnored={vi.fn()}
      />,
    )

    expect(screen.queryByText(ignoredWarning!.message)).not.toBeInTheDocument()
    expect(screen.getByLabelText(`${warnings.length - 1} open audit warnings`)).toHaveTextContent(
      String(warnings.length - 1),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Ignored' }))

    expect(screen.getByText(ignoredWarning!.message)).toBeInTheDocument()
    expect(screen.getByText('1 shown')).toBeInTheDocument()
    expect(screen.getByLabelText(`${warnings.length - 1} open audit warnings`)).toHaveTextContent(
      String(warnings.length - 1),
    )
  })

  it('ignores and unignores warnings without selecting an item or closing the drawer', () => {
    const onSelectItem = vi.fn()
    const onSetWarningIgnored = vi.fn()
    const targetWarning = getProjectAuditWarnings(compatibilityProject)
      .flatMap((group) => group.warnings)
      .find((warning) => warning.code === 'cpu.socket.mismatch')

    expect(targetWarning).toBeDefined()

    render(
      <StatefulAuditDrawer
        initialProject={compatibilityProject}
        onSelectItem={onSelectItem}
        onSetWarningIgnored={onSetWarningIgnored}
      />,
    )

    const openMessageButton = screen.getByRole('button', { name: targetWarning!.message })
    fireEvent.click(within(openMessageButton.parentElement!).getByRole('button', { name: 'Ignore' }))

    expect(onSetWarningIgnored).toHaveBeenLastCalledWith(targetWarning!.id, true)
    expect(onSelectItem).not.toHaveBeenCalled()
    expect(screen.queryByText(targetWarning!.message)).not.toBeInTheDocument()
    expect(screen.getByTestId('audit-drawer')).toHaveAttribute('aria-hidden', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Ignored' }))

    const ignoredMessageButton = screen.getByRole('button', { name: targetWarning!.message })
    fireEvent.click(within(ignoredMessageButton.parentElement!).getByRole('button', { name: 'Unignore' }))

    expect(onSetWarningIgnored).toHaveBeenLastCalledWith(targetWarning!.id, false)
    expect(onSelectItem).not.toHaveBeenCalled()
    expect(screen.queryByText(targetWarning!.message)).not.toBeInTheDocument()
    expect(screen.getByTestId('audit-drawer')).toHaveAttribute('aria-hidden', 'false')
  })
})
