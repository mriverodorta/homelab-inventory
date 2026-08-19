import { customFieldIdFromSystemsColumn } from '@/lib/systems-preferences'
import type { CustomFieldDefinition } from '@/types/inventory-metadata'
import type { SystemsBaseColumnKey, SystemsColumnKey } from '@/types/systems'

export const SYSTEMS_COLUMN_LABELS: Record<SystemsBaseColumnKey, string> = {
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

export function systemsColumnLabel(
  key: SystemsColumnKey,
  definitions: ReadonlyMap<number, CustomFieldDefinition> = new Map(),
) {
  if (key === 'tags') return 'Tags'
  const definitionId = customFieldIdFromSystemsColumn(key)
  if (definitionId !== null) return definitions.get(definitionId)?.name ?? `Custom field ${definitionId}`
  return SYSTEMS_COLUMN_LABELS[key as SystemsBaseColumnKey]
}
