import { Boxes } from 'lucide-react'
import { InspectorSection } from '@/components/inspector/inspector-section'
import { StatusBadge } from '@/components/inspector/inspector-status'
import { formatBytes } from '@/components/inspector/shared/item-formatters'

function stringValue(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function AgentContainersPanel({ containers }: { containers: Array<Record<string, unknown>> }) {
  return (
    <InspectorSection title="Containers" icon={Boxes} badge={<StatusBadge>{containers.length}</StatusBadge>}>
      {containers.length === 0 ? (
        <p className="text-sm font-semibold text-[#75695d]">No containers were reported.</p>
      ) : (
        <div className="divide-y divide-[#e5dccf]">
          {containers.map((container, index) => {
            const name = stringValue(container, 'name') ?? `Container ${index + 1}`
            const state = stringValue(container, 'state') ?? stringValue(container, 'status') ?? 'unknown'
            const memory = typeof container.memoryBytes === 'number' ? formatBytes(container.memoryBytes) : null
            return (
              <div key={`${stringValue(container, 'runtimeId') ?? name}-${index}`} className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-[#20242c]">{name}</p>
                  <p className="truncate text-xs font-medium text-[#75695d]">{[stringValue(container, 'image'), memory].filter(Boolean).join(' / ')}</p>
                </div>
                <StatusBadge tone={state === 'running' ? 'success' : state === 'exited' || state === 'failed' ? 'danger' : 'neutral'}>{state}</StatusBadge>
              </div>
            )
          })}
        </div>
      )}
    </InspectorSection>
  )
}
