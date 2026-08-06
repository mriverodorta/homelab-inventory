import type { AgentCapability, AgentHostStatus, AgentMetrics, AgentTelemetrySample } from '@/types/agent'

export function agentCapability(
  status: AgentHostStatus,
  name: string,
): AgentCapability | null {
  return status.capabilities?.[name] ?? null
}

export function agentCapabilityAvailable(status: AgentHostStatus, name: string): boolean {
  return agentCapability(status, name)?.state === 'available'
}

export function agentSectionAvailable(
  status: AgentHostStatus,
  capability: string,
  legacyValues: unknown[] | undefined,
): boolean {
  return agentCapabilityAvailable(status, capability) || Boolean(legacyValues?.length)
}

export function agentMetrics(status: AgentHostStatus): AgentMetrics {
  if (status.metrics) return status.metrics
  return {
    uptimeSeconds: status.uptimeSeconds ?? undefined,
    loadAverage: status.loadAverage ?? undefined,
    cpu: status.cpu ?? undefined,
    memory: status.memory ?? undefined,
    filesystems: status.disks,
    network: status.network,
  }
}

export function metricNumber(record: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function sampleMetricNumber(sample: AgentTelemetrySample, family: keyof AgentMetrics, key: string): number | null {
  const value = sample.payload.metrics[family]
  return value && !Array.isArray(value) && typeof value === 'object'
    ? metricNumber(value as Record<string, unknown>, key)
    : null
}
