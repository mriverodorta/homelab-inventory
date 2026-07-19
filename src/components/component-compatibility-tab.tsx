import { Link2, ListChecks } from 'lucide-react'
import {
  CompatibilityFindingGroups,
  CompatibilityStatusBand,
  compatibilityAssignmentIdentity,
  formatCompatibilityAllocation,
  normalizeCompatibilityViewProject,
} from '@/components/compatibility-status'
import {
  normalizeComponentRequirements,
  normalizeHostCapabilities,
  planHostAllocations,
  type NormalizedComponentRequirements,
} from '@/lib/compatibility'
import { runtimeItemKey } from '@/lib/item-keys'
import type { InventoryItem, ProjectState } from '@/types/inventory'

type RequirementRow = {
  label: string
  value: string
}

function humanizeInterfaceFamily(value: string): string {
  if (value === 'pcie') return 'PCIe'
  if (value === 'm2-ae') return 'M.2 A+E'
  if (value === 'usb') return 'USB'
  if (value === 'onboard') return 'Onboard'
  return value
}

function requirementRows(requirements: NormalizedComponentRequirements): RequirementRow[] {
  const rows: Array<RequirementRow | false | undefined> = []

  if (requirements.type === 'cpu') {
    rows.push(
      requirements.socket ? { label: 'Socket', value: requirements.socket } : undefined,
      requirements.generation ? { label: 'CPU generation', value: requirements.generation } : undefined,
      requirements.tdpWatts !== undefined && { label: 'TDP', value: `${requirements.tdpWatts}W` },
    )
  } else if (requirements.type === 'ram') {
    rows.push(
      requirements.capacityGb !== undefined && { label: 'Total capacity', value: `${requirements.capacityGb}GB` },
      requirements.moduleCount !== undefined && { label: 'Modules', value: String(requirements.moduleCount) },
      requirements.moduleCapacityGb !== undefined && { label: 'Module capacity', value: `${requirements.moduleCapacityGb}GB` },
      requirements.generation ? { label: 'Memory generation', value: requirements.generation } : undefined,
      requirements.speedMt !== undefined && { label: 'Memory speed', value: `${requirements.speedMt}MT/s` },
    )
  } else if (requirements.type === 'storage') {
    const capacity = requirements.capacityTb !== undefined
      ? `${requirements.capacityTb}TB`
      : requirements.capacityGb !== undefined ? `${requirements.capacityGb}GB` : undefined
    rows.push(
      capacity ? { label: 'Capacity', value: capacity } : undefined,
      requirements.interface ? { label: 'Interface', value: requirements.interface } : undefined,
      requirements.formFactor ? { label: 'Form factor', value: requirements.formFactor } : undefined,
      requirements.pcieGeneration !== undefined && { label: 'PCIe generation', value: String(requirements.pcieGeneration) },
      requirements.connectorLanes !== undefined && { label: 'PCIe lanes', value: `x${requirements.connectorLanes}` },
    )
  } else if (requirements.type === 'gpu' || requirements.type === 'network') {
    rows.push(
      requirements.interfaceFamily ? {
        label: 'Interface family',
        value: humanizeInterfaceFamily(requirements.interfaceFamily),
      } : undefined,
      requirements.pcieGeneration !== undefined && { label: 'PCIe generation', value: String(requirements.pcieGeneration) },
      requirements.connectorLanes !== undefined && { label: 'Connector lanes', value: `x${requirements.connectorLanes}` },
      requirements.minimumElectricalLanes !== undefined && {
        label: 'Minimum electrical lanes',
        value: `x${requirements.minimumElectricalLanes}`,
      },
      requirements.height ? { label: 'Card height', value: requirements.height } : undefined,
      requirements.slotWidth !== undefined && { label: 'Slot width', value: String(requirements.slotWidth) },
      requirements.powerWatts !== undefined && { label: 'Power', value: `${requirements.powerWatts}W` },
    )
  }

  return rows.filter((row): row is RequirementRow => Boolean(row))
}

export function ComponentCompatibilityTab({
  project,
  item,
}: {
  project: ProjectState
  item: InventoryItem
}) {
  const evaluationProject = normalizeCompatibilityViewProject(project, [item])
  const targetItemKey = runtimeItemKey(item)
  const assignment = evaluationProject.assignments.find(
    (candidate) => candidate.itemId === targetItemKey && candidate.type === item.type,
  )
  const host = assignment ? evaluationProject.items[assignment.serverId] : undefined
  const plan = assignment ? planHostAllocations(evaluationProject, assignment.serverId) : undefined
  const result = plan?.results.find(
    (candidate) => assignment
      && compatibilityAssignmentIdentity(candidate.assignmentId)
        === compatibilityAssignmentIdentity(assignment.id),
  )
  const plannedAssignment = plan?.assignments.find(
    (candidate) => assignment
      && compatibilityAssignmentIdentity(candidate.id)
        === compatibilityAssignmentIdentity(assignment.id),
  )
  const requirements = normalizeComponentRequirements(item)
  const rows = requirementRows(requirements)
  const hostCapabilities = host ? normalizeHostCapabilities(host) : {}

  return (
    <div className="space-y-4">
      <section aria-labelledby="normalized-requirements-heading">
        <div className="mb-2 flex items-center gap-2">
          <ListChecks aria-hidden="true" className="size-4 text-[#75695d]" />
          <h2
            id="normalized-requirements-heading"
            className="text-[12px] font-black uppercase tracking-[0.09em] text-[#75695d]"
          >
            Normalized requirements
          </h2>
        </div>
        {rows.length > 0 ? (
          <dl className="divide-y divide-[#eee6da] rounded-md border border-[#e5dccf] bg-[#fffdfa] px-3">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3 py-2">
                <dt className="text-xs font-bold text-[#75695d]">{row.label}</dt>
                <dd className="text-right text-sm font-black text-[#20242c]">{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="rounded-md border border-dashed border-[#d6ccbd] bg-[#f8f3eb] px-3 py-3 text-sm font-semibold text-[#75695d]">
            No normalized requirements are specified.
          </div>
        )}
      </section>

      {!assignment ? (
        <div className="rounded-md border border-dashed border-[#d6ccbd] bg-[#f8f3eb] px-3 py-3 text-sm font-semibold text-[#75695d]">
          Not assigned
        </div>
      ) : (
        <section aria-labelledby="current-assignment-heading" className="border-t border-[#e5dccf] pt-4">
          <div className="mb-2 flex items-center gap-2">
            <Link2 aria-hidden="true" className="size-4 text-[#75695d]" />
            <h2
              id="current-assignment-heading"
              className="text-[12px] font-black uppercase tracking-[0.09em] text-[#75695d]"
            >
              Current assignment
            </h2>
          </div>
          <dl className="mb-3 divide-y divide-[#eee6da] rounded-md border border-[#e5dccf] bg-[#fffdfa] px-3">
            <div className="flex items-start justify-between gap-3 py-2">
              <dt className="text-xs font-bold text-[#75695d]">Current host</dt>
              <dd className="text-right text-sm font-black text-[#20242c]">
                {host?.name ?? 'Host not found'}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3 py-2">
              <dt className="text-xs font-bold text-[#75695d]">Current allocation</dt>
              <dd className="max-w-[65%] text-right text-sm font-black text-[#20242c]">
                {formatCompatibilityAllocation(
                  plannedAssignment?.allocation ?? assignment.allocation,
                  hostCapabilities,
                )}
              </dd>
            </div>
          </dl>

          {result ? (
            <div className="space-y-3">
              <CompatibilityStatusBand status={result.status} findings={result.findings} />
              {result.findings.length > 0 ? (
                <CompatibilityFindingGroups
                  findings={result.findings.map((finding) => ({ finding }))}
                />
              ) : null}
            </div>
          ) : (
            <div className="rounded-md border border-[#dfc483] bg-[#fff8df] px-3 py-3 text-sm font-semibold text-[#5d4814]">
              Compatibility could not be evaluated for the assigned host.
            </div>
          )}
        </section>
      )}
    </div>
  )
}
