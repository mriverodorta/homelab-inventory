import { Activity } from 'lucide-react'
import { InspectorSection } from '@/components/inspector/inspector-section'
import { StatusBadge } from '@/components/inspector/inspector-status'

function stringValue(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function AgentServicesPanel({ services }: { services: Array<Record<string, unknown>> }) {
  return (
    <InspectorSection title="Running Services" icon={Activity} badge={<StatusBadge>{services.length}</StatusBadge>}>
      {services.length === 0 ? (
        <p className="text-sm font-semibold text-[#75695d]">No running services were reported.</p>
      ) : (
        <div className="divide-y divide-[#e5dccf]">
          {services.map((service, index) => {
            const name = stringValue(service, 'name') ?? stringValue(service, 'unit') ?? `Service ${index + 1}`
            const state = stringValue(service, 'activeState') ?? stringValue(service, 'state') ?? 'unknown'
            return (
              <div key={`${name}-${index}`} className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-[#20242c]">{name}</p>
                  {stringValue(service, 'description') ? <p className="truncate text-xs font-medium text-[#75695d]">{stringValue(service, 'description')}</p> : null}
                </div>
                <StatusBadge tone={state === 'active' ? 'success' : state === 'failed' ? 'danger' : 'neutral'}>{state}</StatusBadge>
              </div>
            )
          })}
        </div>
      )}
    </InspectorSection>
  )
}
