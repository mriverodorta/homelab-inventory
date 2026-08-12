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
  const seenPortMappings = new Set<string>()
  for (const port of container.ports ?? []) {
    const protocol = port.protocol.toLowerCase()
    const mappingKey = `${port.hostPort}:${port.containerPort}:${protocol}`
    if (seenPortMappings.has(mappingKey)) continue
    seenPortMappings.add(mappingKey)
    chips.push({
      key: `port-${mappingKey}`,
      label: `H ${port.hostPort} → C ${port.containerPort} · ${protocol.toUpperCase()}`,
    })
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
