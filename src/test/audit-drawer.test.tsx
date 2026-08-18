import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuditDrawer } from '@/components/audit-drawer'
import { getProjectAuditWarnings } from '@/lib/audit'
import { setAuditWarningIgnored } from '@/lib/compatibility-policy'
import { topologyQueryFixture } from '@/test/topology-query-fixture'
import type { ProjectState } from '@/types/inventory'

function auditTopology(project: ProjectState) {
  const topology = topologyQueryFixture(project)
  return {
    endpoints: topology.endpoints,
    networkTraces: topology.networkTraces,
    powerEndpoints: topology.power.endpoints,
    powerFindings: topology.power.findings,
  }
}

const compatibilityHook = vi.hoisted(() => ({ findings: vi.fn() }))

vi.mock('@/hooks/use-compatibility-audit', () => ({
  useCompatibilityFindings: compatibilityHook.findings,
  useSetCompatibilityFindingIgnored: () => ({ mutate: vi.fn() }),
}))

compatibilityHook.findings.mockImplementation((projectId: number) => ({
  data: { findings: projectId === 2 ? [
    {
      id: 1, findingKey: 'cpu', ruleKey: 'cpu.socket.mismatch', classification: 'actionable', severity: 'error',
      message: 'CPU socket LGA1700 is not supported.', details: {},
      host: { itemId: 1, type: 'server', legacyId: 1, name: 'Compatibility Host' },
      component: { itemId: 2, type: 'cpu', legacyId: 1, name: 'Mismatch CPU' },
    },
    {
      id: 2, findingKey: 'ram', ruleKey: 'memory.speed.reduced', classification: 'actionable', severity: 'warning',
      message: 'Memory speed will be reduced.', details: {},
      host: { itemId: 1, type: 'server', legacyId: 1, name: 'Compatibility Host' },
      component: { itemId: 3, type: 'ram', legacyId: 1, name: 'Fast RAM' },
    },
    {
      id: 3, findingKey: 'storage', ruleKey: 'storage.form-factor.missing', classification: 'informational', severity: 'info',
      message: 'Storage form factor is not recorded.', details: {},
      host: { itemId: 1, type: 'server', legacyId: 1, name: 'Compatibility Host' },
      component: { itemId: 4, type: 'storage', legacyId: 1, name: 'Unknown Storage' },
    },
  ] : [] },
}))

const project: ProjectState = {
  id: 'test-project',
  metadata: {
    projectId: 1,
    name: 'Test Project',
    version: 1,
    updatedAt: '2026-06-26T00:00:00.000Z',
  },
  items: {
    'server:1': {
      id: 1,
      key: 'server:1',
      name: 'Server A',
      type: 'server',
      ports: [
        {
          id: 1,
          kind: 'server-port',
          type: 'rj45',
          slotNumber: 1,
          speed: '1G',
        },
      ],
    },
    'switch:1': {
      id: 1,
      key: 'switch:1',
      name: 'Switch A',
      type: 'switch',
      ports: [
        {
          id: 1,
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
      serverId: 'switch:1',
      x: 0,
      y: 0,
    },
  ],
  assignments: [],
  connections: [
    {
      id: 1,
      from: {
        itemId: 'switch:1',
        portId: 1,
      },
      to: {
        itemId: 'server:1',
        portId: 1,
      },
      type: 'network',
      createdAt: '2026-06-26T00:00:00.000Z',
    },
  ],
}

const compatibilityProject: ProjectState = {
  id: 'compatibility-project',
  metadata: {
    projectId: 2,
    name: 'Compatibility Project',
    version: 1,
    updatedAt: '2026-07-19T00:00:00.000Z',
  },
  items: {
    'server:1': {
      id: 1,
      key: 'server:1',
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
              id: 9, key: 'm2-slot',
              label: 'M.2 Slot',
              count: 1,
              interfaces: ['NVMe'],
              formFactors: ['2280'],
            },
          ],
        },
      },
    },
    'cpu:1': {
      id: 1,
      key: 'cpu:1',
      name: 'Mismatch CPU',
      type: 'cpu',
      compatibility: {
        requirements: {
          cpu: { socket: 'LGA1700', generation: '12', tdpWatts: 65 },
        },
      },
    },
    'ram:1': {
      id: 1,
      key: 'ram:1',
      name: 'Fast RAM',
      type: 'ram',
      specs: { capacityGb: 16, moduleCount: 1, generation: 'DDR4', speedMt: 3200 },
    },
    'storage:1': {
      id: 1,
      key: 'storage:1',
      name: 'Unknown Storage',
      type: 'storage',
      specs: { interface: 'NVMe' },
    },
  },
  placements: [{ serverId: 'server:1', x: 0, y: 0 }],
  assignments: [
    {
      id: 1,
      serverId: 'server:1',
      itemId: 'cpu:1',
      type: 'cpu',
      assignedAt: '2026-07-19T00:00:00.000Z',
    },
    {
      id: 2,
      serverId: 'server:1',
      itemId: 'ram:1',
      type: 'ram',
      assignedAt: '2026-07-19T00:01:00.000Z',
    },
    {
      id: 3,
      serverId: 'server:1',
      itemId: 'storage:1',
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
      topologyData={topologyQueryFixture(currentProject)}
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
  it('uses the shared responsive right-drawer width', () => {
    render(
      <AuditDrawer
        project={project}
        open
        onClose={vi.fn()}
        onSelectItem={vi.fn()}
      />,
    )

    expect(screen.getByTestId('audit-drawer')).toHaveClass('w-[min(96vw,680px)]')
  })

  it('renders grouped audit warnings and selects an item from a warning', () => {
    const onSelectItem = vi.fn()

    render(
      <AuditDrawer
        project={project}
        topologyData={topologyQueryFixture(project)}
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

    expect(onSelectItem).toHaveBeenCalledWith('switch:1')
  })

  it('filters warnings by item type', () => {
    render(
      <AuditDrawer
        project={project}
        topologyData={topologyQueryFixture(project)}
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
    fireEvent.click(screen.getByText(/CPU socket LGA1700 is not supported/))
    expect(onSelectItem).toHaveBeenCalledWith('server:1')

    fireEvent.click(screen.getByRole('button', { name: 'Missing metadata' }))
    expect(container.querySelectorAll('[data-severity="unknown"]')).not.toHaveLength(0)
  })

  it('shows ignored warnings only in the Ignored filter and keeps the badge count open-only', () => {
    const warnings = getProjectAuditWarnings(project, {}, auditTopology(project)).flatMap((group) => group.warnings)
    const ignoredWarning = warnings.find((warning) => warning.id.startsWith('switch-no-uplink-trunk-'))

    expect(ignoredWarning).toBeDefined()

    const ignoredProject: ProjectState = {
      ...project,
      compatibilityPolicy: {
        disabledHosts: [],
        ignoredWarningIds: [ignoredWarning!.id],
      },
    }

    render(
      <AuditDrawer
        project={ignoredProject}
        topologyData={topologyQueryFixture(ignoredProject)}
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
    const targetWarning = getProjectAuditWarnings(project, {}, auditTopology(project))
      .flatMap((group) => group.warnings)
      .find((warning) => warning.id.startsWith('switch-no-uplink-trunk-'))

    expect(targetWarning).toBeDefined()

    render(
      <StatefulAuditDrawer
        initialProject={project}
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
