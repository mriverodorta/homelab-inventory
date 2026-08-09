import { HardDrive } from 'lucide-react'
import { InspectorSection } from '@/components/inspector/inspector-section'
import { formatBytes } from '@/components/inspector/shared/item-formatters'
import type { AgentStorageTelemetry } from '@/types/agent'

function UsageBar({ value }: { value: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-sm bg-[#e8e0d4]" aria-label={`${value.toFixed(1)}% used`}>
      <div className="h-full bg-[#2f7668] transition-[width]" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  )
}

export function AgentStorageSummary({ storage }: { storage?: AgentStorageTelemetry }) {
  if (!storage || storage.summary.mounts.length === 0) return null
  const summary = storage.summary
  return (
    <InspectorSection title="Local Storage" icon={HardDrive}>
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-bold text-[#20242c]">{summary.usagePercent.toFixed(1)}% used</span>
          <span className="text-xs font-semibold text-[#75695d]">{formatBytes(summary.usedBytes)} / {formatBytes(summary.totalBytes)}</span>
        </div>
        <UsageBar value={summary.usagePercent} />
        <p className="text-xs font-semibold text-[#75695d]">{summary.mounts.length} local filesystem{summary.mounts.length === 1 ? '' : 's'} counted. Remote, container, and runtime mounts are excluded.</p>
      </div>
    </InspectorSection>
  )
}
