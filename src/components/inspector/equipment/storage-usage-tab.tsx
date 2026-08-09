import { HardDrive } from 'lucide-react'
import { InspectorSection } from '@/components/inspector/inspector-section'
import { formatBytes } from '@/components/inspector/shared/item-formatters'
import type { AgentStorageItemTelemetry } from '@/types/agent'

function UsageBar({ value }: { value: number }) {
  return <div className="h-2 overflow-hidden rounded-sm bg-[#e8e0d4]"><div className="h-full bg-[#2f7668]" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>
}

function detail(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Unknown'
  return String(value)
}

function topologyLabel(node: Record<string, unknown>) {
  return detail(node.name ?? node.path ?? node.type)
}

function topologyMeta(node: Record<string, unknown>) {
  return [node.type, node.fstype, node.size ? formatBytes(Number(node.size)) : null]
    .filter(Boolean).join(' · ')
}

export function StorageUsageTab({ storage }: { storage: AgentStorageItemTelemetry }) {
  return (
    <div className="space-y-4">
      <InspectorSection title="Physical Device" icon={HardDrive}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="text-[#75695d]">Device</dt><dd className="min-w-0 break-all text-right font-bold">{storage.device.locator}</dd>
          <dt className="text-[#75695d]">Model</dt><dd className="min-w-0 break-words text-right font-bold">{detail(storage.device.model)}</dd>
          <dt className="text-[#75695d]">Capacity</dt><dd className="text-right font-bold">{formatBytes(storage.device.sizeBytes)}</dd>
          <dt className="text-[#75695d]">Transport</dt><dd className="text-right font-bold uppercase">{detail(storage.device.transport)}</dd>
          <dt className="text-[#75695d]">Partition table</dt><dd className="text-right font-bold uppercase">{detail(storage.device.partitionTable)}</dd>
        </dl>
      </InspectorSection>
      <InspectorSection title="Mount Points" icon={HardDrive}>
        {storage.mounts.length === 0 ? <p className="text-sm font-semibold text-[#75695d]">No eligible mounted filesystems are mapped to this device.</p> : (
          <div className="divide-y divide-[#e5dccf]">
            {storage.mounts.map((mount) => (
              <div key={`${mount.majorMinor}:${mount.mountPoint}`} className="space-y-2 py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="truncate text-sm font-bold text-[#20242c]">{mount.mountPoint}</p><p className="text-xs font-semibold text-[#75695d]">{mount.fsType} · {mount.source}{mount.readOnly ? ' · read-only' : ''}</p></div>
                  <span className="shrink-0 text-xs font-bold text-[#20242c]">{mount.usagePercent.toFixed(1)}%</span>
                </div>
                <UsageBar value={mount.usagePercent} />
                <p className="text-right text-xs font-semibold text-[#75695d]">{formatBytes(mount.usedBytes)} / {formatBytes(mount.totalBytes)}</p>
              </div>
            ))}
          </div>
        )}
      </InspectorSection>
      <InspectorSection title="Block Topology" icon={HardDrive}>
        <div className="divide-y divide-[#e5dccf] rounded-md border border-[#e5dccf] bg-[#fffdfa] px-3">
          {storage.device.topology.map((node, index) => {
            const depth = Math.max(0, Math.min(5, Number(node.topologyDepth) || 0))
            return (
              <div key={`${detail(node.path ?? node.name)}:${index}`} className="py-2" style={{ paddingLeft: `${depth * 14}px` }}>
                <p className="break-all text-sm font-bold text-[#20242c]">{topologyLabel(node)}</p>
                <p className="text-xs font-semibold uppercase text-[#75695d]">{topologyMeta(node) || 'Block device'}</p>
              </div>
            )
          })}
        </div>
      </InspectorSection>
    </div>
  )
}
