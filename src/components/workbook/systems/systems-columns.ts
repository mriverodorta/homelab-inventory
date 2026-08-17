import type { SystemsColumnKey } from '@/types/systems'

export const SYSTEMS_COLUMN_LABELS: Record<SystemsColumnKey, string> = {
  type: 'Type',
  name: 'Name',
  manufacturer: 'Manufacturer / model',
  cpu: 'CPU',
  memory: 'RAM',
  storage: 'Storage',
  attention: 'Attention',
  agent: 'Agent',
  registry: 'Registry',
  operatingSystem: 'Operating system',
  uptime: 'Uptime',
  lanIp: 'LAN IP',
}
