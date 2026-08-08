import { Boxes } from 'lucide-react'
import { containerChips, containerSummary } from '@/components/inspector/agent/agent-container-formatters'
import { InspectorSection } from '@/components/inspector/inspector-section'
import { StatusBadge } from '@/components/inspector/inspector-status'
import { Badge } from '@/components/ui/badge'
import type { AgentContainer } from '@/types/agent'

function stringValue(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function AgentContainersPanel({ containers }: { containers: AgentContainer[] }) {
  return (
    <InspectorSection title="Containers" icon={Boxes} badge={<StatusBadge>{containers.length}</StatusBadge>}>
      {containers.length === 0 ? (
        <p className="text-sm font-semibold text-[#75695d]">No containers were reported.</p>
      ) : (
        <div className="divide-y divide-[#e5dccf]">
          {containers.map((container, index) => {
            const name = stringValue(container, 'name') ?? `Container ${index + 1}`
            const state = stringValue(container, 'state') ?? stringValue(container, 'status') ?? 'unknown'
            const summary = containerSummary(container)
            const chips = containerChips(container)
            return (
              <div key={`${stringValue(container, 'runtimeId') ?? name}-${index}`} className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <div className="min-w-0">
                  <p className="break-words text-sm font-bold text-[#20242c]">{name}</p>
                  {summary ? <p className="break-words text-xs font-medium text-[#75695d]">{summary}</p> : null}
                  {chips.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5" aria-label={`${name} container metadata`}>
                      {chips.map((chip) => (
                        <Badge key={chip.key} variant="outline" className="h-5 rounded-md border-[#d8cec0] bg-[#f8f5f0] px-1.5 text-[10px] font-bold text-[#5f554b]">
                          {chip.label}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
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
