import { AlertTriangle, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { getProjectAuditWarnings, type ProjectAuditGroup } from '@/lib/audit'
import { runtimeItemKey } from '@/lib/item-keys'
import type { InventoryType, ProjectState } from '@/types/inventory'

type AuditFilter = 'all' | 'server' | 'patchPanel' | 'switch' | 'stale'

const FILTERS: Array<{ label: string; value: AuditFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Servers', value: 'server' },
  { label: 'Patch Panels', value: 'patchPanel' },
  { label: 'Switches', value: 'switch' },
  { label: 'Stale', value: 'stale' },
]

function itemTypeLabel(type: InventoryType): string {
  if (type === 'patchPanel') {
    return 'Patch panel'
  }

  return type.charAt(0).toUpperCase() + type.slice(1)
}

function filterGroups(groups: ProjectAuditGroup[], filter: AuditFilter): ProjectAuditGroup[] {
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

export function AuditDrawer({
  project,
  open,
  onClose,
  onSelectItem,
}: {
  project: ProjectState
  open: boolean
  onClose: () => void
  onSelectItem: (itemId: string) => void
}) {
  const [filter, setFilter] = useState<AuditFilter>('all')
  const groups = useMemo(() => getProjectAuditWarnings(project), [project])
  const filteredGroups = useMemo(() => filterGroups(groups, filter), [filter, groups])
  const totalWarnings = groups.reduce((count, group) => count + group.warnings.length, 0)
  const filteredWarnings = filteredGroups.reduce((count, group) => count + group.warnings.length, 0)

  return (
    <aside
      className={`fixed bottom-0 right-0 top-0 z-50 flex min-h-0 w-[390px] flex-col border-l border-[#d6ccbd] bg-[#fffdf8] shadow-[-18px_0_36px_rgba(32,36,44,0.18)] transition-transform duration-200 ease-out ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
      aria-hidden={!open}
      data-testid="audit-drawer"
    >
      <div className="flex items-start justify-between gap-3 border-b border-[#e5dccf] p-4">
        <div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-[#a66f1f]" />
            <h2 className="text-lg font-bold text-[#20242c]">Audit</h2>
            <span className="rounded bg-[#fff2c7] px-2 py-1 text-xs font-black text-[#3d2a08]">
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
                  {group.warnings.map((warning) => (
                    <button
                      key={warning.id}
                      type="button"
                      className="w-full rounded-md border border-[#ead9a5] bg-[#fff8df] p-2 text-left text-xs font-semibold leading-snug text-[#5d4814] transition hover:border-[#ddb668] hover:bg-[#fff2c7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ddb668]"
                      onClick={() => onSelectItem(runtimeItemKey(group.item))}
                    >
                      {warning.message}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
