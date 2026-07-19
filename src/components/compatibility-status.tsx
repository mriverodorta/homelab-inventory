import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Info,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { itemKey, parseItemKey, runtimeItemKey } from '@/lib/item-keys'
import type {
  CompatibilityAllocation,
  CompatibilityFinding,
  CompatibilityStatus,
  HostCompatibility,
} from '@/types/compatibility'
import type {
  ComponentAssignment,
  ComponentType,
  InventoryItem,
  InventoryType,
  ProjectState,
} from '@/types/inventory'

type PersistedAssignmentMetadata = {
  hostType?: InventoryType
  hostId?: string | number
  itemType?: InventoryType
}

const componentTypes = new Set<ComponentType>([
  'cpu',
  'ram',
  'storage',
  'gpu',
  'network',
])

function isComponentType(value: unknown): value is ComponentType {
  return typeof value === 'string' && componentTypes.has(value as ComponentType)
}

function isHostType(value: unknown): value is 'server' | 'nas' {
  return value === 'server' || value === 'nas'
}

export function compatibilityAssignmentIdentity(id: string | number): string {
  return `${typeof id}:${String(id)}`
}

function typedReferenceKey(type: InventoryType, reference: string | number): string {
  if (typeof reference === 'string') {
    const parsed = parseItemKey(reference)
    if (parsed?.type === type) return reference
    if (!Number.isInteger(Number(reference))) return reference
  }

  return itemKey(type, reference)
}

function resolveTypedItemKey(
  items: Record<string, InventoryItem>,
  reference: string | number,
  expectedType: InventoryType,
): string | undefined {
  const normalized = String(reference)
  const parsed = parseItemKey(normalized)
  if (parsed && parsed.type !== expectedType) return undefined

  const direct = items[normalized]
  if (direct?.type === expectedType) return runtimeItemKey(direct)

  const candidates = Object.values(items).filter((item) => (
    item.type === expectedType
    && (
      runtimeItemKey(item) === normalized
      || item.key === normalized
      || String(item.id) === normalized
    )
  ))

  return candidates.length === 1 ? runtimeItemKey(candidates[0]) : undefined
}

function assignmentComponentType(assignment: ComponentAssignment): ComponentType | undefined {
  const metadata = assignment as ComponentAssignment & PersistedAssignmentMetadata
  if (isComponentType(metadata.itemType)) return metadata.itemType

  const parsed = parseItemKey(String(assignment.itemId))
  if (parsed && isComponentType(parsed.type)) return parsed.type

  return isComponentType(assignment.type) ? assignment.type : undefined
}

function assignmentHostType(
  assignment: ComponentAssignment,
  items: Record<string, InventoryItem>,
): 'server' | 'nas' | undefined {
  const metadata = assignment as ComponentAssignment & PersistedAssignmentMetadata
  if (isHostType(metadata.hostType)) return metadata.hostType

  const parsed = parseItemKey(String(assignment.serverId))
  if (parsed && isHostType(parsed.type)) return parsed.type

  const direct = items[String(assignment.serverId)]
  if (direct && isHostType(direct.type)) return direct.type

  const reference = metadata.hostId ?? assignment.serverId
  const candidates = Object.values(items).filter((item) => (
    isHostType(item.type)
    && (
      runtimeItemKey(item) === String(reference)
      || item.key === String(reference)
      || String(item.id) === String(reference)
    )
  ))

  return candidates.length === 1 && isHostType(candidates[0].type)
    ? candidates[0].type
    : undefined
}

/**
 * Compatibility still accepts legacy project shapes. Normalize an inspector-only
 * view so the shared engine never receives an ambiguous category-scoped ID.
 */
export function normalizeCompatibilityViewProject(
  project: ProjectState,
  draftItems: InventoryItem[] = [],
): ProjectState {
  const items: Record<string, InventoryItem> = {}
  for (const item of [...Object.values(project.items), ...draftItems]) {
    items[runtimeItemKey(item)] = item
  }

  const assignments = project.assignments.map((assignment) => {
    const metadata = assignment as ComponentAssignment & PersistedAssignmentMetadata
    const componentType = assignmentComponentType(assignment)
    const hostType = assignmentHostType(assignment, items)
    const hostReference = metadata.hostId ?? assignment.serverId
    const resolvedItemKey = componentType
      ? resolveTypedItemKey(items, assignment.itemId, componentType)
      : undefined
    const resolvedHostKey = hostType
      ? resolveTypedItemKey(items, hostReference, hostType)
      : undefined

    return {
      ...assignment,
      type: componentType ?? assignment.type,
      itemId: resolvedItemKey
        ?? (componentType
          ? typedReferenceKey(componentType, assignment.itemId)
          : `unresolved-item:${compatibilityAssignmentIdentity(assignment.id)}`),
      serverId: resolvedHostKey
        ?? (hostType
          ? typedReferenceKey(hostType, hostReference)
          : `unresolved-host:${compatibilityAssignmentIdentity(assignment.id)}`),
    }
  })

  return { ...project, items, assignments }
}

type CompatibilityStatusBandProps = {
  status: CompatibilityStatus
  findings?: CompatibilityFinding[]
}

type StatusPresentation = {
  label: string
  detail: string
  icon: LucideIcon
  className: string
}

function statusPresentation(
  status: CompatibilityStatus,
  findings: CompatibilityFinding[],
): StatusPresentation {
  if (status === 'incompatible') {
    return {
      label: 'Needs attention',
      detail: 'One or more known requirements are not supported by this host.',
      icon: AlertTriangle,
      className: 'border-[#dfb3a5] bg-[#fff4ee] text-[#613126]',
    }
  }

  if (status === 'unknown') {
    return {
      label: 'Not fully verified',
      detail: 'Compatibility data is incomplete for one or more checks.',
      icon: CircleHelp,
      className: 'border-[#dfc483] bg-[#fff8df] text-[#5d4814]',
    }
  }

  if (findings.some((finding) => finding.severity === 'warning')) {
    return {
      label: 'Compatible',
      detail: 'The hardware can be used, with the performance notes shown below.',
      icon: Info,
      className: 'border-[#aac4dc] bg-[#f1f7fc] text-[#244a68]',
    }
  }

  return {
    label: 'Compatible',
    detail: 'All available compatibility checks passed.',
    icon: CheckCircle2,
    className: 'border-[#9fd3c7] bg-[#edf9f5] text-[#174c43]',
  }
}

export function CompatibilityStatusBand({
  status,
  findings = [],
}: CompatibilityStatusBandProps) {
  const presentation = statusPresentation(status, findings)
  const Icon = presentation.icon

  return (
    <div
      role="status"
      aria-label={`Compatibility status: ${presentation.label}`}
      data-compatibility-status={status}
      className={cn(
        'flex w-full items-start gap-3 rounded-md border px-3 py-2.5',
        presentation.className,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <div className="text-sm font-black">{presentation.label}</div>
        <p className="mt-0.5 text-xs font-semibold leading-5 opacity-80">
          {presentation.detail}
        </p>
      </div>
    </div>
  )
}

type ContextualFinding = {
  finding: CompatibilityFinding
  itemName?: string
}

const findingGroups: Array<{
  severity: CompatibilityFinding['severity']
  title: string
  className: string
}> = [
  {
    severity: 'error',
    title: 'Errors',
    className: 'border-[#dfb3a5] bg-[#fff4ee] text-[#613126]',
  },
  {
    severity: 'warning',
    title: 'Warnings',
    className: 'border-[#aac4dc] bg-[#f1f7fc] text-[#244a68]',
  },
  {
    severity: 'unknown',
    title: 'Unknowns',
    className: 'border-[#dfc483] bg-[#fff8df] text-[#5d4814]',
  },
]

export function CompatibilityFindingGroups({
  findings,
}: {
  findings: ContextualFinding[]
}) {
  return (
    <div className="space-y-3">
      {findingGroups.map((group) => {
        const matching = findings.filter(({ finding }) => finding.severity === group.severity)
        if (matching.length === 0) return null

        return (
          <section key={group.severity} aria-labelledby={`compatibility-${group.severity}-heading`}>
            <h3
              id={`compatibility-${group.severity}-heading`}
              className="mb-1.5 text-[11px] font-black uppercase tracking-[0.09em] text-[#75695d]"
            >
              {group.title}
            </h3>
            <ul className="space-y-1.5">
              {matching.map(({ finding, itemName }, index) => (
                <li
                  key={`${finding.code}:${finding.resourceId ?? ''}:${index}`}
                  className={cn('rounded-md border px-3 py-2 text-xs font-semibold leading-5', group.className)}
                >
                  {itemName ? <span className="font-black">{itemName}: </span> : null}
                  {finding.message}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function allocationGroupLabel(
  allocation: CompatibilityAllocation,
  host: HostCompatibility,
): string | undefined {
  if (!allocation.groupId) return undefined

  const groups = allocation.resourceType === 'storage'
    ? host.storageSlots
    : host.expansionSlots

  return groups?.find((group) => group.id === allocation.groupId)?.label
}

function positionLabel(positions: number[]): string {
  const oneBased = [...positions].sort((left, right) => left - right).map((position) => position + 1)
  if (oneBased.length === 1) return `position ${oneBased[0]}`

  const consecutive = oneBased.every(
    (position, index) => index === 0 || position === oneBased[index - 1] + 1,
  )
  return consecutive
    ? `positions ${oneBased[0]}-${oneBased[oneBased.length - 1]}`
    : `positions ${oneBased.join(', ')}`
}

export function formatCompatibilityAllocation(
  allocation: CompatibilityAllocation | undefined,
  host: HostCompatibility,
): string {
  if (!allocation) return 'No resource position allocated'

  const groupLabel = allocationGroupLabel(allocation, host)
  const resourceLabel = allocation.resourceType === 'memory'
    ? 'Memory'
    : allocation.resourceType === 'storage'
      ? 'Storage'
      : 'Expansion'

  return groupLabel
    ? `${groupLabel}, ${positionLabel(allocation.positions)}`
    : `${resourceLabel} ${positionLabel(allocation.positions)}`
}
