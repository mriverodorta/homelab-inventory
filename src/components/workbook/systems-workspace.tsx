import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { SystemsFilterMenu } from '@/components/workbook/systems/systems-filter-menu'
import { SystemsTable } from '@/components/workbook/systems/systems-table'
import { filterAndSortSystems, mergeSystemsLive } from '@/components/workbook/systems/systems-table-model'
import { useAuth } from '@/hooks/use-auth'
import { useSystems } from '@/hooks/use-systems'
import { browserPreferenceScope } from '@/lib/browser-preference-scope'
import {
  readSystemsTablePreferences,
  type SystemsSortKey,
  type SystemsTablePreferences,
  writeSystemsTablePreferences,
} from '@/lib/systems-preferences'
import type { ProjectState } from '@/types/inventory'
import type { SystemsHostType } from '@/types/systems'

const TYPE_LABELS: Record<SystemsHostType, string> = {
  server: 'Server',
  nas: 'NAS',
  pcBuild: 'PC',
}

type SystemsWorkspaceProps = {
  project: ProjectState
  selectedItemId: string | null
  onSelectItem(itemId: string): void
  onCloseInspector(): void
}

export function SystemsWorkspace(props: SystemsWorkspaceProps) {
  const auth = useAuth()
  const projectId = props.project.metadata.projectId ?? 1
  const scope = browserPreferenceScope(auth.status?.account?.id ?? null, projectId)
  return <ScopedSystemsWorkspace key={scope} {...props} projectId={projectId} preferenceScope={scope} />
}

function ScopedSystemsWorkspace({
  projectId,
  preferenceScope,
  selectedItemId,
  onSelectItem,
  onCloseInspector,
}: SystemsWorkspaceProps & { projectId: number; preferenceScope: string }) {
  const [preferences, setPreferences] = useState<SystemsTablePreferences>(() => (
    readSystemsTablePreferences(preferenceScope)
  ))
  const systems = useSystems(projectId, true)

  useEffect(() => {
    writeSystemsTablePreferences(preferenceScope, preferences)
  }, [preferenceScope, preferences])

  useEffect(() => {
    if (!selectedItemId) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return
      onCloseInspector()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onCloseInspector, selectedItemId])

  const rows = useMemo(() => {
    const live = new Map(systems.live.data?.systems.map((system) => [system.itemId, system]) ?? [])
    return filterAndSortSystems(mergeSystemsLive(systems.initial.data?.systems ?? [], live), preferences)
  }, [preferences, systems.initial.data?.systems, systems.live.data?.systems])
  const typeOptions = useMemo(() => (
    [...new Set(systems.initial.data?.systems.map((system) => system.type) ?? [])]
      .sort((left, right) => TYPE_LABELS[left].localeCompare(TYPE_LABELS[right]))
      .map((value) => ({ value, label: TYPE_LABELS[value] }))
  ), [systems.initial.data?.systems])
  const updatePreferences = (changes: Partial<SystemsTablePreferences>) => {
    setPreferences((current) => ({ ...current, ...changes }))
  }
  const sort = (sortKey: SystemsSortKey) => {
    setPreferences((current) => ({
      ...current,
      sortKey,
      sortDirection: current.sortKey === sortKey && current.sortDirection === 'ascending'
        ? 'descending'
        : 'ascending',
    }))
  }

  return (
    <main className="relative min-w-0 flex-1 overflow-hidden bg-[#f8f6f1]">
      <div className="flex h-full min-h-0 flex-col px-3">
        <header className="shrink-0 pb-3 pt-16">
          <h1 className="text-xl font-semibold text-[#20242c]">Systems</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <SystemsFilterMenu label="System type" options={typeOptions} selected={preferences.types} onChange={(types) => updatePreferences({ types })} />
            <SystemsFilterMenu
              label="Agent"
              options={[{ value: 'registered', label: 'Registered' }, { value: 'unregistered', label: 'Unregistered' }]}
              selected={preferences.registrations}
              onChange={(registrations) => updatePreferences({ registrations })}
            />
            <SystemsFilterMenu
              label="Registry"
              options={[{ value: 'linked', label: 'Linked' }, { value: 'unlinked', label: 'Unlinked' }]}
              selected={preferences.registryStates}
              onChange={(registryStates) => updatePreferences({ registryStates })}
            />
            <div className="relative ml-auto">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-[#81786e]" />
              <Input
                value={preferences.query}
                className="h-9 w-[min(300px,75vw)] bg-white pl-8"
                placeholder="Search systems"
                onChange={(event) => updatePreferences({ query: event.target.value })}
              />
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-hidden rounded-t-md border-x border-t border-[#d8d0c5] bg-[#fffdf8]">
          {systems.initial.isPending ? (
            <div className="grid h-full place-items-center text-sm text-[#756d62]">Loading systems...</div>
          ) : systems.initial.isError ? (
            <div className="grid h-full place-items-center px-6 text-center text-sm text-[#9a4137]">
              {systems.initial.error instanceof Error ? systems.initial.error.message : 'Systems could not be loaded.'}
            </div>
          ) : (
            <SystemsTable
              systems={rows}
              selectedItemId={selectedItemId}
              sortKey={preferences.sortKey}
              sortDirection={preferences.sortDirection}
              onSort={sort}
              onSelect={onSelectItem}
            />
          )}
        </div>
      </div>
    </main>
  )
}
