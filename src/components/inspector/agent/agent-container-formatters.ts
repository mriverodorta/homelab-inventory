import { formatBytes } from '@/components/inspector/shared/item-formatters'
import type { AgentContainer } from '@/types/agent'

export function containerSummary(container: AgentContainer): string {
  const values = [container.image]
  if (typeof container.cpuPercent === 'number' && Number.isFinite(container.cpuPercent)) {
    values.push(`CPU ${container.cpuPercent.toFixed(1)}%`)
  }
  if (typeof container.memoryBytes === 'number' && Number.isFinite(container.memoryBytes)) {
    values.push(`Memory ${formatBytes(container.memoryBytes)}`)
  }
  if (container.uptime) values.push(`Up ${container.uptime}`)
  return values.filter(Boolean).join(' / ')
}

export type ContainerChip = { key: string; label: string }

export function containerChips(container: AgentContainer): ContainerChip[] {
  const chips: ContainerChip[] = []
  if (container.composeService) chips.push({ key: 'service', label: `Service ${container.composeService}` })
  for (const [index, port] of (container.ports ?? []).entries()) {
    chips.push({ key: `port-${index}-host`, label: `H ${port.hostPort}` })
    chips.push({ key: `port-${index}-container`, label: `C ${port.containerPort}` })
    chips.push({ key: `port-${index}-protocol`, label: port.protocol.toUpperCase() })
  }
  switch (container.networkMode) {
    case 'host':
      chips.push({ key: 'network-mode', label: 'Host network' })
      break
    case 'bridge':
      chips.push({ key: 'network-mode', label: 'Bridge' })
      break
    case 'none':
      chips.push({ key: 'network-mode', label: 'No network' })
      break
    case 'custom':
      for (const name of container.networkNames ?? []) chips.push({ key: `network-${name}`, label: `Network ${name}` })
      break
  }
  return chips
}
