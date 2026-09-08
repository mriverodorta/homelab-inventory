import { agentCommandPlatform } from './command-platform.mjs'

export function compactAgentHostStatus(status) {
  const metrics = status.metrics ?? {}
  return {
    hostType: status.hostType,
    hostId: status.hostId,
    ...(status.hostType === 'server' ? { serverId: status.hostId } : {}),
    state: status.state,
    connected: status.connected,
    ageMs: status.ageMs,
    lastSeenAt: status.lastSeenAt,
    collectedAt: status.collectedAt ?? null,
    agentVersion: status.agentVersion,
    commandPlatform: agentCommandPlatform(metrics.system?.operatingSystem ?? metrics.system?.os),
    hostname: status.hostname ?? null,
    droppedSamples: status.droppedSamples,
    monitoringRevision: status.monitoringRevision,
    details: {
      metrics: Boolean(status.metrics || status.cpu || status.memory || status.uptimeSeconds !== undefined),
      services: Array.isArray(status.services) && status.services.length > 0,
      containers: Array.isArray(status.containers) && status.containers.length > 0,
      storage: (Array.isArray(status.storageHealth) && status.storageHealth.length > 0)
        || (Array.isArray(status.disks) && status.disks.length > 0)
        || (Array.isArray(metrics.filesystems) && metrics.filesystems.length > 0),
      network: (Array.isArray(status.network) && status.network.length > 0)
        || (Array.isArray(metrics.network) && metrics.network.length > 0),
      hardware: Boolean(status.motherboard),
    },
  }
}
