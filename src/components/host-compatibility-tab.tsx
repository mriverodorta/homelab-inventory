import { Boxes, Cpu, HardDrive, MemoryStick } from 'lucide-react'
import {
  CompatibilityFindingGroups,
  CompatibilityStatusBand,
  compatibilityAssignmentIdentity,
  formatCompatibilityAllocation,
  normalizeCompatibilityViewProject,
} from '@/components/compatibility-status'
import {
  CompatibilityFields,
  type CompatibilityFieldsProps,
} from '@/components/inventory-form/compatibility-fields'
import { Checkbox } from '@/components/ui/checkbox'
import {
  normalizeHostCapabilities,
  planHostAllocations,
  type ProjectCompatibilityResult,
} from '@/lib/compatibility'
import type {
  CompatibilityAllocation,
  CompatibilityStatus,
  HostCompatibility,
} from '@/types/compatibility'
import type { InventoryItem, ProjectState } from '@/types/inventory'
import { runtimeItemKey } from '@/lib/item-keys'

function overallStatus(results: ProjectCompatibilityResult[]): CompatibilityStatus {
  if (results.some((result) => result.status === 'incompatible')) return 'incompatible'
  if (results.some((result) => result.status === 'unknown')) return 'unknown'
  return 'compatible'
}

function occupiedPositionCount(
  allocations: Array<CompatibilityAllocation | undefined>,
  resourceType: CompatibilityAllocation['resourceType'],
  groupId?: string,
): number {
  const positions = new Set<number>()
  for (const allocation of allocations) {
    if (
      allocation?.resourceType !== resourceType
      || (resourceType !== 'memory' && allocation.groupId !== groupId)
    ) continue
    for (const position of allocation.positions) positions.add(position)
  }
  return positions.size
}

function groupedOccupiedPositionCount(
  allocations: Array<CompatibilityAllocation | undefined>,
  resourceType: 'storage' | 'expansion',
  groups: Array<{ id: string }>,
): number {
  return groups.reduce(
    (total, group) => total + occupiedPositionCount(
      allocations,
      resourceType,
      group.id,
    ),
    0,
  )
}

function ResourceSummary({
  label,
  used,
  total,
  icon: Icon,
}: {
  label: string
  used: number
  total: number
  icon: typeof MemoryStick
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[#eee6da] py-2 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2 text-sm font-black text-[#302a25]">
        <Icon aria-hidden="true" className="size-4 shrink-0 text-[#75695d]" />
        <span>{label}</span>
      </div>
      <span className="shrink-0 text-xs font-bold text-[#75695d]">
        {used} of {total} positions
      </span>
    </div>
  )
}

function GroupUtilization({
  host,
  allocations,
}: {
  host: HostCompatibility
  allocations: Array<CompatibilityAllocation | undefined>
}) {
  const groups = [
    ...(host.storageSlots ?? []).map((group) => ({ ...group, resourceType: 'storage' as const })),
    ...(host.expansionSlots ?? []).map((group) => ({ ...group, resourceType: 'expansion' as const })),
  ]
  if (groups.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 pt-2">
      {groups.map((group) => (
        <span
          key={`${group.resourceType}:${group.id}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#e5dccf] bg-[#f8f3eb] px-2 py-1 text-[11px] font-bold text-[#5f554b]"
        >
          <span>{group.label}</span>
          <span className="text-[#20242c]">
            {occupiedPositionCount(allocations, group.resourceType, group.id)}/{group.count}
          </span>
        </span>
      ))}
    </div>
  )
}

export function HostCompatibilityTab({
  project,
  host,
  enabled,
  onEnabledChange,
  values,
  errors,
  onChange,
  onSelectOpenChange,
}: CompatibilityFieldsProps & {
  project: ProjectState
  host: InventoryItem
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
}) {
  const evaluationProject = normalizeCompatibilityViewProject(project, [host])
  const hostReference = runtimeItemKey(host)
  const plan = planHostAllocations(evaluationProject, hostReference)
  const capabilities = normalizeHostCapabilities(host)
  const persistedAssignments = new Map(
    evaluationProject.assignments
      .filter((assignment) => assignment.serverId === hostReference)
      .map((assignment) => [compatibilityAssignmentIdentity(assignment.id), assignment]),
  )
  const visibleAssignments = plan.assignments.map((assignment) => ({
    ...assignment,
    allocation: assignment.allocation
      ?? persistedAssignments.get(compatibilityAssignmentIdentity(assignment.id))?.allocation,
  }))
  const findings = plan.results.flatMap((result) => {
    const item = evaluationProject.items[String(result.itemId)]
    return result.findings.map((finding) => ({ finding, itemName: item?.name }))
  })
  const allocations = visibleAssignments.map((assignment) => assignment.allocation)
  const memoryTotal = capabilities.memory?.slots ?? 0
  const storageTotal = (capabilities.storageSlots ?? [])
    .reduce((total, group) => total + Math.max(0, group.count), 0)
  const expansionTotal = (capabilities.expansionSlots ?? [])
    .reduce((total, group) => total + Math.max(0, group.count), 0)

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-[#ded8ce] bg-[#fffdfa] px-3 py-3">
        <div className="flex items-start gap-3">
          <Checkbox
            id="host-compatibility-enabled"
            aria-describedby="host-compatibility-description"
            checked={enabled}
            onCheckedChange={(checked) => onEnabledChange(checked === true)}
          />
          <span className="min-w-0">
            <label
              htmlFor="host-compatibility-enabled"
              className="block cursor-pointer text-sm font-black text-[#20242c]"
            >
              Enable compatibility checks
            </label>
            <span
              id="host-compatibility-description"
              className="mt-0.5 block text-xs font-semibold leading-5 text-[#75695d]"
            >
              Disabling checks bypasses hardware matching and compatibility audit findings. Slot and capacity limits remain enforced.
            </span>
          </span>
        </div>
      </section>

      <CompatibilityFields
        values={values}
        errors={errors}
        onChange={onChange}
        onSelectOpenChange={onSelectOpenChange}
      />

      {!enabled ? (
        <div className="rounded-md border border-dashed border-[#d6ccbd] bg-[#f8f3eb] px-3 py-3 text-sm font-semibold text-[#75695d]">
          Hardware compatibility checks are disabled for this host. Physical limits still apply.
        </div>
      ) : (
        <>
          <section aria-labelledby="compatibility-overview-heading" className="space-y-3">
        <div className="flex items-center gap-2">
          <Cpu aria-hidden="true" className="size-4 text-[#75695d]" />
          <h2
            id="compatibility-overview-heading"
            className="text-[12px] font-black uppercase tracking-[0.09em] text-[#75695d]"
          >
            Compatibility overview
          </h2>
        </div>
        <CompatibilityStatusBand
          status={overallStatus(plan.results)}
          findings={findings.map(({ finding }) => finding)}
        />
          </section>

          <section aria-labelledby="resource-utilization-heading" className="border-t border-[#e5dccf] pt-4">
        <div className="mb-2 flex items-center gap-2">
          <Boxes aria-hidden="true" className="size-4 text-[#75695d]" />
          <h2
            id="resource-utilization-heading"
            className="text-[12px] font-black uppercase tracking-[0.09em] text-[#75695d]"
          >
            Resource utilization
          </h2>
        </div>
        <div className="rounded-md border border-[#e5dccf] bg-[#fffdfa] px-3">
          {memoryTotal > 0 ? (
            <ResourceSummary
              label="Memory"
              used={occupiedPositionCount(allocations, 'memory')}
              total={memoryTotal}
              icon={MemoryStick}
            />
          ) : null}
          {storageTotal > 0 ? (
            <ResourceSummary
              label="Storage"
              used={groupedOccupiedPositionCount(
                allocations,
                'storage',
                capabilities.storageSlots ?? [],
              )}
              total={storageTotal}
              icon={HardDrive}
            />
          ) : null}
          {expansionTotal > 0 ? (
            <ResourceSummary
              label="Expansion"
              used={groupedOccupiedPositionCount(
                allocations,
                'expansion',
                capabilities.expansionSlots ?? [],
              )}
              total={expansionTotal}
              icon={Boxes}
            />
          ) : null}
        </div>
        <GroupUtilization host={capabilities} allocations={allocations} />
          </section>

          {visibleAssignments.length > 0 ? (
        <section aria-labelledby="component-allocations-heading" className="border-t border-[#e5dccf] pt-4">
          <h2
            id="component-allocations-heading"
            className="mb-2 text-[12px] font-black uppercase tracking-[0.09em] text-[#75695d]"
          >
            Component allocations
          </h2>
          <div className="divide-y divide-[#eee6da] rounded-md border border-[#e5dccf] bg-[#fffdfa] px-3">
            {visibleAssignments.map((assignment) => {
              const item = evaluationProject.items[String(assignment.itemId)]
              return (
                <div key={String(assignment.id)} className="flex items-start justify-between gap-3 py-2.5">
                  <span className="min-w-0 text-sm font-black text-[#20242c]">
                    {item?.name ?? 'Missing component'}
                  </span>
                  <span className="max-w-[55%] text-right text-xs font-bold leading-5 text-[#75695d]">
                    {formatCompatibilityAllocation(assignment.allocation, capabilities)}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
          ) : null}

          {findings.length > 0 ? (
        <section aria-label="Compatibility findings" className="border-t border-[#e5dccf] pt-4">
          <CompatibilityFindingGroups findings={findings} />
        </section>
          ) : null}
        </>
      )}
    </div>
  )
}
