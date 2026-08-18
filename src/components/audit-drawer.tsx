import { AlertCircle, AlertTriangle, CircleHelp, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { RIGHT_DRAWER_LAYOUT_CLASS_NAME } from '@/components/right-drawer-layout'
import {
  useCompatibilityFindings,
  useSetCompatibilityFindingIgnored,
} from '@/hooks/use-compatibility-audit'
import { getProjectAuditWarnings, type ProjectAuditGroup } from '@/lib/audit'
import { runtimeItemKey } from '@/lib/item-keys'
import type { TopologyQueryData } from '@/hooks/use-topology-query'
import type { CompatibilitySeverity } from '@/types/compatibility'
import type { CompatibilityAuditFinding } from '@/types/compatibility-audit'
import type { InventoryType, ProjectState } from '@/types/inventory'

type AuditFilter = 'all' | 'server' | 'patchPanel' | 'switch' | 'stale' | 'metadata' | 'ignored'
type OpenAuditFilter = Exclude<AuditFilter, 'metadata' | 'ignored'>

const FILTERS: Array<{ label: string; value: AuditFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Servers', value: 'server' },
  { label: 'Patch Panels', value: 'patchPanel' },
  { label: 'Switches', value: 'switch' },
  { label: 'Stale', value: 'stale' },
  { label: 'Missing metadata', value: 'metadata' },
  { label: 'Ignored', value: 'ignored' },
]

function mergeAuditGroups(...collections: ProjectAuditGroup[][]): ProjectAuditGroup[] {
  const groups = new Map<string, ProjectAuditGroup>()
  for (const collection of collections) {
    for (const group of collection) {
      const key = runtimeItemKey(group.item)
      const existing = groups.get(key)
      groups.set(key, existing
        ? { ...existing, warnings: [...existing.warnings, ...group.warnings] }
        : group)
    }
  }
  return [...groups.values()].sort((left, right) => left.item.name.localeCompare(right.item.name))
}

function compatibilityGroupsFor(
  findings: readonly CompatibilityAuditFinding[],
  project: ProjectState,
): ProjectAuditGroup[] {
  const grouped = new Map<string, ProjectAuditGroup>()
  for (const finding of findings) {
    const itemKey = `${finding.host.type}:${finding.host.legacyId}`
    const item = project.items[itemKey]
    if (!item) continue
    const current = grouped.get(itemKey) ?? { item, warnings: [] }
    current.warnings.push({
      id: `compatibility-audit:${finding.id}`,
      itemId: itemKey,
      message: finding.component ? `${finding.component.name}: ${finding.message}` : finding.message,
      code: finding.ruleKey,
      severity: finding.classification === 'informational'
        ? 'unknown'
        : finding.severity === 'error' ? 'error' : 'warning',
    })
    grouped.set(itemKey, current)
  }
  return [...grouped.values()]
}

function itemTypeLabel(type: InventoryType): string {
  if (type === 'patchPanel') {
    return 'Patch panel'
  }

  return type.charAt(0).toUpperCase() + type.slice(1)
}

function filterGroups(groups: ProjectAuditGroup[], filter: OpenAuditFilter): ProjectAuditGroup[] {
  if (filter === 'all') {
    return groups
  }

  if (filter === 'stale') {
    return groups
      .map((group) => ({
        ...group,
        warnings: group.warnings.filter((warning) => warning.id.startsWith('stale-')),
      }))
      .filter((group) => group.warnings.length > 0)
  }

  return groups.filter((group) => group.item.type === filter)
}

const WARNING_STYLES: Record<
  CompatibilitySeverity,
  { className: string; icon: typeof AlertTriangle }
> = {
  error: {
    className:
      'border-[#e4b4aa] bg-[#fff0ed] text-[#742a20] hover:border-[#cf8d80] hover:bg-[#ffe5df] focus-visible:ring-[#cf8d80]',
    icon: AlertCircle,
  },
  warning: {
    className:
      'border-[#ead9a5] bg-[#fff8df] text-[#5d4814] hover:border-[#ddb668] hover:bg-[#fff2c7] focus-visible:ring-[#ddb668]',
    icon: AlertTriangle,
  },
  unknown: {
    className:
      'border-[#c9c4d8] bg-[#f4f2fa] text-[#4d4761] hover:border-[#aaa2c1] hover:bg-[#ebe8f4] focus-visible:ring-[#aaa2c1]',
    icon: CircleHelp,
  },
}

function warningSeverity(severity?: CompatibilitySeverity): CompatibilitySeverity {
  return severity ?? 'warning'
}

export function AuditDrawer({
  project,
  topologyData = null,
  open,
  onClose,
  onSelectItem,
  onSetWarningIgnored,
}: {
  project: ProjectState
  topologyData?: TopologyQueryData | null
  open: boolean
  onClose: () => void
  onSelectItem: (itemId: string) => void
  onSetWarningIgnored?: (warningId: string, ignored: boolean) => void
}) {
  const [filter, setFilter] = useState<AuditFilter>('all')
  const projectId = project.metadata.projectId ?? 1
  const compatibility = useCompatibilityFindings(projectId, { visibility: 'open' }, open)
  const ignoredCompatibility = useCompatibilityFindings(
    projectId,
    { visibility: 'ignored' },
    open && filter === 'ignored',
  )
  const setCompatibilityIgnored = useSetCompatibilityFindingIgnored(projectId)
  const auditTopology = useMemo(() => topologyData ? {
    endpoints: topologyData.endpoints,
    networkTraces: topologyData.networkTraces,
    powerEndpoints: topologyData.power.endpoints,
    powerFindings: topologyData.power.findings,
  } : undefined, [topologyData])
  const compatibilityGroups = useMemo(
    () => compatibilityGroupsFor(compatibility.data?.findings ?? [], project),
    [compatibility.data?.findings, project],
  )
  const ignoredCompatibilityGroups = useMemo(
    () => compatibilityGroupsFor(ignoredCompatibility.data?.findings ?? [], project),
    [ignoredCompatibility.data?.findings, project],
  )
  const actionableCompatibilityGroups = useMemo(() => compatibilityGroups.map((group) => ({
    ...group,
    warnings: group.warnings.filter((warning) => warning.severity !== 'unknown'),
  })).filter((group) => group.warnings.length > 0), [compatibilityGroups])
  const informationalCompatibilityGroups = useMemo(() => compatibilityGroups.map((group) => ({
    ...group,
    warnings: group.warnings.filter((warning) => warning.severity === 'unknown'),
  })).filter((group) => group.warnings.length > 0), [compatibilityGroups])
  const openGroups = useMemo(() => mergeAuditGroups(
    getProjectAuditWarnings(project, {}, auditTopology),
    actionableCompatibilityGroups,
  ), [actionableCompatibilityGroups, auditTopology, project])
  const filteredGroups = useMemo(
    () =>
      filter === 'ignored'
        ? mergeAuditGroups(
            getProjectAuditWarnings(project, { visibility: 'ignored' }, auditTopology),
            ignoredCompatibilityGroups,
          )
        : filter === 'metadata'
          ? informationalCompatibilityGroups
          : filterGroups(openGroups, filter),
    [auditTopology, filter, ignoredCompatibilityGroups, informationalCompatibilityGroups, openGroups, project],
  )
  const totalWarnings = openGroups.reduce((count, group) => count + group.warnings.length, 0)
  const filteredWarnings = filteredGroups.reduce((count, group) => count + group.warnings.length, 0)
  const showingIgnored = filter === 'ignored'
  const activeCompatibilityQuery = showingIgnored ? ignoredCompatibility : compatibility

  return (
    <aside
      className={`${RIGHT_DRAWER_LAYOUT_CLASS_NAME} z-50 flex min-h-0 flex-col border-l border-[#d6ccbd] bg-[#fffdf8] shadow-[-18px_0_36px_rgba(32,36,44,0.18)] transition-transform duration-200 ease-out ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
      aria-hidden={!open}
      inert={!open}
      data-testid="audit-drawer"
    >
      <div className="flex items-start justify-between gap-3 border-b border-[#e5dccf] p-4">
        <div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-[#a66f1f]" />
            <h2 className="text-lg font-bold text-[#20242c]">Audit</h2>
            <span
              className="rounded bg-[#fff2c7] px-2 py-1 text-xs font-black text-[#3d2a08]"
              aria-label={`${totalWarnings} open audit warnings`}
            >
              {totalWarnings}
            </span>
          </div>
          <div className="mt-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#75695d]">
            {filteredWarnings} shown
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label="Close audit"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="border-b border-[#e5dccf] p-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant={filter === option.value ? 'default' : 'outline'}
              size="sm"
              className="h-8 px-2.5 text-xs"
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {activeCompatibilityQuery.isPending ? (
          <div role="status" className="mb-3 rounded-md border border-[#e5dccf] bg-[#f8f3eb] px-3 py-2 text-xs font-semibold text-[#75695d]">
            Loading compatibility findings...
          </div>
        ) : activeCompatibilityQuery.isError ? (
          <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#e4b4aa] bg-[#fff0ed] px-3 py-2 text-xs font-semibold text-[#742a20]">
            <span>Compatibility findings could not be loaded.</span>
            <Button type="button" variant="outline" size="xs" onClick={() => void activeCompatibilityQuery.refetch()}>
              Try again
            </Button>
          </div>
        ) : null}
        {setCompatibilityIgnored.isError ? (
          <div role="alert" className="mb-3 rounded-md border border-[#e4b4aa] bg-[#fff0ed] px-3 py-2 text-xs font-semibold text-[#742a20]">
            The compatibility finding could not be updated. Try again.
          </div>
        ) : null}
        {filteredGroups.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#d6ccbd] bg-[#f8f3eb] p-4 text-sm font-semibold text-[#75695d]">
            No audit warnings in this filter.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredGroups.map((group) => (
              <div key={runtimeItemKey(group.item)} className="rounded-lg border border-[#e5dccf] bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-[#20242c]">{group.item.name}</div>
                    <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#75695d]">
                      {itemTypeLabel(group.item.type)}
                    </div>
                  </div>
                  <span className="rounded bg-[#fff2c7] px-2 py-1 text-xs font-black text-[#3d2a08]">
                    {group.warnings.length}
                  </span>
                </div>

                <div className="mt-3 space-y-2">
                  {group.warnings.map((warning) => {
                    const severity = warningSeverity(warning.severity)
                    const style = WARNING_STYLES[severity]
                    const WarningIcon = style.icon

                    return (
                      <div key={warning.id} className="flex items-start gap-2">
                        <button
                          type="button"
                          data-severity={severity}
                          className={`flex min-w-0 flex-1 items-start gap-2 rounded-md border p-2 text-left text-xs font-semibold leading-snug transition focus-visible:outline-none focus-visible:ring-2 ${style.className}`}
                          onClick={() => onSelectItem(warning.itemId)}
                        >
                          <WarningIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                          <span className="min-w-0">{warning.message}</span>
                        </button>
                        {(onSetWarningIgnored || warning.id.startsWith('compatibility-audit:')) ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            className="mt-0.5 px-2 text-[11px]"
                            onClick={(event) => {
                              event.stopPropagation()
                              if (warning.id.startsWith('compatibility-audit:')) {
                                const findingId = Number(warning.id.slice('compatibility-audit:'.length))
                                setCompatibilityIgnored.mutate({ findingId, ignored: !showingIgnored })
                              } else {
                                onSetWarningIgnored?.(warning.id, !showingIgnored)
                              }
                            }}
                          >
                            {showingIgnored ? 'Unignore' : 'Ignore'}
                          </Button>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
