import { Activity } from 'lucide-react'
import { useMemo, useState } from 'react'
import { InspectorSection } from '@/components/inspector/inspector-section'
import { StatusBadge } from '@/components/inspector/inspector-status'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { AgentService } from '@/types/agent'
import {
  filterServices,
  serviceRuntimeState,
  type ServiceRuntimeState,
  type ServiceScope,
} from './agent-service-filters'

function stringValue(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function AgentServicesPanel({ services }: { services: AgentService[] }) {
  const classificationsAvailable = services.some((service) => service.classification)
  const [scope, setScope] = useState<ServiceScope>(classificationsAvailable ? 'user-installed' : 'all')
  const [runtimeState, setRuntimeState] = useState<ServiceRuntimeState>('active')
  const filteredServices = useMemo(
    () => filterServices(services, scope, runtimeState),
    [services, scope, runtimeState],
  )

  return (
    <InspectorSection title="Services" icon={Activity} badge={<StatusBadge>{filteredServices.length} / {services.length}</StatusBadge>}>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <Select value={scope} onValueChange={(value) => setScope(value as ServiceScope)}>
          <SelectTrigger className="h-9 min-w-0 text-xs" aria-label="Service scope"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="user-installed">User installed</SelectItem>
            <SelectItem value="system">System</SelectItem>
            <SelectItem value="all">All scopes</SelectItem>
          </SelectContent>
        </Select>
        <Select value={runtimeState} onValueChange={(value) => setRuntimeState(value as ServiceRuntimeState)}>
          <SelectTrigger className="h-9 min-w-0 text-xs" aria-label="Service runtime state"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="all">All states</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {filteredServices.length === 0 ? (
        <div className="grid justify-items-start gap-3 py-2">
          <p className="text-sm font-semibold text-[#75695d]">No services match the selected scope and runtime state.</p>
          <Button variant="outline" size="sm" onClick={() => { setScope('all'); setRuntimeState('all') }}>Show all services</Button>
        </div>
      ) : (
        <div className="divide-y divide-[#e5dccf]">
          {filteredServices.map((service, index) => {
            const name = stringValue(service, 'name') ?? stringValue(service, 'unit') ?? `Service ${index + 1}`
            const state = serviceRuntimeState(service)
            return (
              <div key={`${name}-${index}`} className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="break-words text-sm font-bold text-[#20242c]">{name}</p>
                  {stringValue(service, 'description') ? <p className="break-words text-xs font-medium text-[#75695d]">{stringValue(service, 'description')}</p> : null}
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
