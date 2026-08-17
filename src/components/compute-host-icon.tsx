import { Database, MonitorCog, Server, type LucideProps } from 'lucide-react'
import type { InventoryItem } from '@/types/inventory'
import { resolveComputeHostPresentation, type ComputeHostIconKey } from '@/lib/compute-host-presentation'

const HOST_ICONS = {
  server: Server,
  'monitor-cog': MonitorCog,
  database: Database,
} satisfies Record<ComputeHostIconKey, typeof Server>

type ComputeHostIconProps = LucideProps & {
  host: Pick<InventoryItem, 'type'> & Partial<Pick<InventoryItem, 'hardwareClass' | 'usageRole'>>
}

export function ComputeHostIcon({ host, ...props }: ComputeHostIconProps) {
  const Icon = HOST_ICONS[resolveComputeHostPresentation(host).iconKey]
  return <Icon {...props} />
}
