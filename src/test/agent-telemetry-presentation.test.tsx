import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AgentContainersPanel } from '@/components/inspector/agent/agent-containers-panel'
import { AgentStorageSummary } from '@/components/inspector/agent/agent-storage-summary'
import { AgentServicesPanel } from '@/components/inspector/agent/agent-services-panel'
import { filterServices } from '@/components/inspector/agent/agent-service-filters'
import { AGENT_PERCENTAGE_TICKS, formatDuration, formatOperatingSystem } from '@/components/inspector/agent/agent-telemetry-formatters'
import type { AgentService } from '@/types/agent'

const services: AgentService[] = [
  { name: 'docker', description: 'Docker Application Container Engine', activeState: 'active', classification: 'user-installed' },
  { name: 'supervisor', activeState: 'inactive', classification: 'user-installed' },
  { name: 'cron', activeState: 'active', classification: 'system' },
  { name: 'failed-local', activeState: 'failed', classification: 'unknown' },
]

describe('agent telemetry presentation', () => {
  it('formats host uptime and operating-system versions', () => {
    expect(formatDuration(1_580_640)).toBe('18d 7h 4m')
    expect(formatOperatingSystem({ distributionName: 'Ubuntu 24.04.3 LTS', operatingSystem: 'linux' })).toBe('Ubuntu 24.04.3 LTS')
    expect(formatOperatingSystem({ operatingSystem: 'FreeBSD', kernel: '14.3-RELEASE' })).toBe('FreeBSD 14.3-RELEASE')
  })

  it('filters services by independent scope and runtime state', () => {
    expect(filterServices(services, 'user-installed', 'active').map((service) => service.name)).toEqual(['docker'])
    expect(filterServices(services, 'system', 'active').map((service) => service.name)).toEqual(['cron'])
    expect(filterServices(services, 'all', 'failed').map((service) => service.name)).toEqual(['failed-local'])
    expect(filterServices(services, 'all', 'all')).toHaveLength(4)
  })

  it('keeps legacy running-service entries visible when no runtime state was reported', () => {
    expect(filterServices([{ name: 'legacy-service' }], 'all', 'active')).toHaveLength(1)
  })

  it('defaults services to user-installed active and allows independent filtering', async () => {
    const user = userEvent.setup()
    render(<AgentServicesPanel services={services} />)
    expect(screen.getByText('docker')).toBeInTheDocument()
    expect(screen.queryByText('cron')).not.toBeInTheDocument()
    expect(screen.getByText('1 / 4')).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Service scope' }))
    await user.click(screen.getByRole('option', { name: 'System' }))
    expect(screen.getByText('cron')).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Service runtime state' }))
    await user.click(screen.getByRole('option', { name: 'Inactive' }))
    expect(screen.getByText('No services match the selected scope and runtime state.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show all services' }))
    expect(screen.getByText('4 / 4')).toBeInTheDocument()
  })

  it('renders enriched container summaries and metadata chips', () => {
    render(<AgentContainersPanel containers={[{
      runtime: 'docker', runtimeId: 'abc', name: 'homarr', image: 'ghcr.io/homarr-labs/homarr:latest', state: 'running',
      cpuPercent: 6.25, memoryBytes: 167 * 1024 * 1024, uptime: '2 hours', composeService: 'homarr',
      networkMode: 'custom', networkNames: ['internal_net'], ports: [{ hostPort: 7575, containerPort: 7575, protocol: 'tcp' }],
    }]} />)
    expect(screen.getByText(/CPU 6.3%/)).toBeInTheDocument()
    expect(screen.getByText(/Memory 167MB/)).toBeInTheDocument()
    expect(screen.getByText(/Up 2 hours/)).toBeInTheDocument()
    for (const label of ['Service homarr', 'H 7575', 'C 7575', 'TCP', 'Network internal_net']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('defines complete percentage ticks for utilization charts', () => {
    expect(AGENT_PERCENTAGE_TICKS.map((tick) => `${tick}%`)).toEqual(['0%', '25%', '50%', '75%', '100%'])
  })

  it('summarizes only backend-approved local filesystems', () => {
    render(<AgentStorageSummary storage={{
      summary: {
        totalBytes: 1000, usedBytes: 400, availableBytes: 550, usagePercent: 40,
        mounts: [{ mountId: 1, parentId: 0, majorMinor: '8:2', source: '/dev/sda2', mountPoint: '/', root: '/', fsType: 'ext4', readOnly: false, totalBytes: 1000, usedBytes: 400, availableBytes: 550, usagePercent: 40 }],
      },
      items: [], unmatchedMounts: [],
    }} />)
    expect(screen.getByText('40.0% used')).toBeVisible()
    expect(screen.getByText(/1 local filesystem counted/)).toBeVisible()
  })
})
