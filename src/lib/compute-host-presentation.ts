import type { InventoryItem } from '@/types/inventory'

export type ComputeHostIconKey = 'server' | 'monitor-cog' | 'database'

export type ComputeHostPresentation = Readonly<{
  iconKey: ComputeHostIconKey
  label: string
}>

type ComputeHostIdentity = Pick<InventoryItem, 'type'> & Partial<Pick<InventoryItem, 'hardwareClass' | 'usageRole'>>

export function resolveComputeHostPresentation(host: ComputeHostIdentity): ComputeHostPresentation {
  if (host.type === 'nas') return { iconKey: 'database', label: 'NAS' }
  if (host.usageRole === 'server') return { iconKey: 'server', label: 'Server' }
  if (host.type === 'pcBuild') return { iconKey: 'monitor-cog', label: 'PC' }
  return { iconKey: 'server', label: 'Server' }
}
