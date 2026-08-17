import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SystemsSaveViewDialog } from '@/components/workbook/systems/systems-save-view-dialog'
import { SystemsTable } from '@/components/workbook/systems/systems-table'
import { filterAndSortSystems, mergeSystemsLive, systemsViewConfigurationsEqual } from '@/components/workbook/systems/systems-table-model'
import { SystemsToolbar, type SystemsViewSelection } from '@/components/workbook/systems/systems-toolbar'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useAuth } from '@/hooks/use-auth'
import { useSystems, useSystemsViews } from '@/hooks/use-systems'
import { browserPreferenceScope } from '@/lib/browser-preference-scope'
import {
  DEFAULT_SYSTEMS_TABLE_PREFERENCES,
  readSystemsColumnWidths,
  readSystemsTablePreferences,
  type SystemsSortKey,
  type SystemsTablePreferences,
  writeSystemsColumnWidths,
  writeSystemsTablePreferences,
} from '@/lib/systems-preferences'
import type { ProjectState } from '@/types/inventory'
import type { SystemsColumnKey, SystemsHostRow, SystemsHostType, SystemsSavedView, SystemsViewConfiguration } from '@/types/systems'

const TYPE_LABELS: Record<SystemsHostType, string> = { server: 'Server', nas: 'NAS', pcBuild: 'PC' }

type SystemsWorkspaceProps = {
  project: ProjectState
  selectedItemId: string | null
  onSelectItem(itemId: string): void
  onCloseInspector(): void
}

type ViewDialogState = { mode: 'create' | 'rename'; open: boolean; error: string | null }

function viewConfiguration(preferences: SystemsTablePreferences): SystemsViewConfiguration {
  return {
    types: preferences.types,
    registrations: preferences.registrations,
    registryStates: preferences.registryStates,
    sortKey: preferences.sortKey,
    sortDirection: preferences.sortDirection,
    density: preferences.density,
    columns: preferences.columns,
  }
}

function applyConfiguration(current: SystemsTablePreferences, configuration: SystemsViewConfiguration, activeViewId: number | null) {
  return { ...current, ...configuration, activeViewId }
}

function needsAttention(system: SystemsHostRow) {
  return system.attentionCount > 0
    || system.agentUpdateAvailable
    || system.agentState === 'stale'
    || system.agentState === 'offline'
}

function mutationMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The saved view could not be changed.'
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
  const [preferences, setPreferences] = useState<SystemsTablePreferences>(() => readSystemsTablePreferences(preferenceScope))
  const [selection, setSelection] = useState<SystemsViewSelection>(() => preferences.activeViewId ?? 'all')
  const [widths, setWidths] = useState<Partial<Record<SystemsColumnKey, number>>>(() => readSystemsColumnWidths(preferenceScope, preferences.activeViewId))
  const [dialog, setDialog] = useState<ViewDialogState>({ mode: 'create', open: false, error: null })
  const [deleteOpen, setDeleteOpen] = useState(false)
  const selectionInitialized = useRef(false)
  const systems = useSystems(projectId, true)
  const savedViews = useSystemsViews(projectId, true)
  const views = useMemo(() => savedViews.views.data ?? [], [savedViews.views.data])
  const activeView = typeof selection === 'number' ? views.find((view) => view.id === selection) ?? null : null

  useEffect(() => { writeSystemsTablePreferences(preferenceScope, preferences) }, [preferenceScope, preferences])
  useEffect(() => { writeSystemsColumnWidths(preferenceScope, typeof selection === 'number' ? selection : null, widths) }, [preferenceScope, selection, widths])
  useEffect(() => {
    if (selectionInitialized.current || !savedViews.views.isSuccess) return
    selectionInitialized.current = true
    const preferred = views.find((view) => view.id === preferences.activeViewId) ?? views.find((view) => view.isDefault) ?? null
    if (!preferred) { setSelection('all'); setPreferences((current) => ({ ...current, activeViewId: null })); return }
    setSelection(preferred.id)
    setPreferences((current) => applyConfiguration(current, preferred.configuration, preferred.id))
    setWidths(readSystemsColumnWidths(preferenceScope, preferred.id))
  }, [preferenceScope, preferences.activeViewId, savedViews.views.isSuccess, views])

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

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return
      const target = event.target
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]')) return
      const search = document.querySelector<HTMLInputElement>('[data-systems-search]')
      if (!search) return
      event.preventDefault()
      search.focus()
      search.select()
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  const rows = useMemo(() => {
    const live = new Map(systems.live.data?.systems.map((system) => [system.itemId, system]) ?? [])
    const merged = mergeSystemsLive(systems.initial.data?.systems ?? [], live)
    return filterAndSortSystems(selection === 'attention' ? merged.filter(needsAttention) : merged, preferences)
  }, [preferences, selection, systems.initial.data?.systems, systems.live.data?.systems])
  const typeOptions = useMemo(() => (
    [...new Set(systems.initial.data?.systems.map((system) => system.type) ?? [])]
      .sort((left, right) => TYPE_LABELS[left].localeCompare(TYPE_LABELS[right]))
      .map((value) => ({ value, label: TYPE_LABELS[value] }))
  ), [systems.initial.data?.systems])
  const modified = activeView
    ? !systemsViewConfigurationsEqual(viewConfiguration(preferences), activeView.configuration)
    : !systemsViewConfigurationsEqual(viewConfiguration(preferences), viewConfiguration(DEFAULT_SYSTEMS_TABLE_PREFERENCES))

  const updatePreferences = (changes: Partial<SystemsTablePreferences>) => setPreferences((current) => ({ ...current, ...changes }))
  const sort = (sortKey: SystemsSortKey) => setPreferences((current) => ({
    ...current,
    sortKey,
    sortDirection: current.sortKey === sortKey && current.sortDirection === 'ascending' ? 'descending' : 'ascending',
  }))
  const selectView = (next: SystemsViewSelection) => {
    setSelection(next)
    if (typeof next === 'number') {
      const view = views.find((entry) => entry.id === next)
      if (view) setPreferences((current) => applyConfiguration(current, view.configuration, view.id))
    } else {
      setPreferences((current) => applyConfiguration(current, viewConfiguration(DEFAULT_SYSTEMS_TABLE_PREFERENCES), null))
    }
    setWidths(readSystemsColumnWidths(preferenceScope, typeof next === 'number' ? next : null))
  }
  const replaceView = async (view: SystemsSavedView, name = view.name) => {
    const updated = await savedViews.replace.mutateAsync({ id: view.id, revision: view.revision, input: { name, ...viewConfiguration(preferences) } })
    setSelection(updated.id)
    setPreferences((current) => applyConfiguration(current, updated.configuration, updated.id))
  }
  const submitDialog = async (name: string) => {
    setDialog((current) => ({ ...current, error: null }))
    try {
      if (dialog.mode === 'rename' && activeView) await replaceView(activeView, name.trim())
      else {
        const created = await savedViews.create.mutateAsync({ name: name.trim(), ...viewConfiguration(preferences) })
        setSelection(created.id)
        setPreferences((current) => ({ ...current, activeViewId: created.id }))
        setWidths(readSystemsColumnWidths(preferenceScope, created.id))
      }
      setDialog((current) => ({ ...current, open: false }))
    } catch (error) {
      setDialog((current) => ({ ...current, error: mutationMessage(error) }))
    }
  }
  const deleteActiveView = async () => {
    if (!activeView) return
    try {
      await savedViews.remove.mutateAsync({ id: activeView.id, revision: activeView.revision })
      setDeleteOpen(false)
      selectView('all')
    } catch (error) {
      setDeleteOpen(false)
      setDialog({ mode: 'rename', open: true, error: mutationMessage(error) })
    }
  }
  const openAttention = useCallback((itemId: string) => {
    onSelectItem(itemId)
    queueMicrotask(() => window.dispatchEvent(new CustomEvent('homelab-inventory:inspector-tab', { detail: { itemId, tab: 'attention' } })))
  }, [onSelectItem])
  const openSystem = useCallback((itemId: string) => {
    onSelectItem(itemId)
    queueMicrotask(() => window.dispatchEvent(new CustomEvent('homelab-inventory:inspector-tab', { detail: { itemId, tab: 'specs' } })))
  }, [onSelectItem])

  return (
    <main className="relative min-w-0 flex-1 overflow-hidden bg-[#f8f6f1]">
      <div className="flex h-full min-h-0 flex-col px-3">
        <header className="shrink-0 pb-3 pt-16">
          <h1 className="text-xl font-semibold text-[#20242c]">Systems</h1>
          <SystemsToolbar
            selection={selection}
            views={views}
            modified={modified}
            types={preferences.types}
            registrations={preferences.registrations}
            registryStates={preferences.registryStates}
            typeOptions={typeOptions}
            columns={preferences.columns}
            density={preferences.density}
            query={preferences.query}
            onSelection={selectView}
            onTypes={(types) => updatePreferences({ types })}
            onRegistrations={(registrations) => updatePreferences({ registrations })}
            onRegistryStates={(registryStates) => updatePreferences({ registryStates })}
            onColumns={(columns) => updatePreferences({ columns })}
            onDensity={(density) => updatePreferences({ density })}
            onQuery={(query) => updatePreferences({ query })}
            onSaveNew={() => setDialog({ mode: 'create', open: true, error: null })}
            onUpdate={() => { if (activeView) void replaceView(activeView).catch((error) => setDialog({ mode: 'rename', open: true, error: mutationMessage(error) })) }}
            onReset={() => selectView(selection)}
            onRename={() => setDialog({ mode: 'rename', open: true, error: null })}
            onDelete={() => setDeleteOpen(true)}
            onSetDefault={() => { if (activeView) void savedViews.setDefault.mutateAsync({ id: activeView.id, revision: activeView.revision }) }}
          />
        </header>
        <div className="min-h-0 flex-1 overflow-hidden rounded-t-md border-x border-t border-[#d8d0c5] bg-[#fffdf8]">
          {systems.initial.isPending ? <div className="grid h-full place-items-center text-sm text-[#756d62]">Loading systems...</div> : systems.initial.isError ? (
            <div className="grid h-full place-items-center px-6 text-center text-sm text-[#9a4137]">{systems.initial.error instanceof Error ? systems.initial.error.message : 'Systems could not be loaded.'}</div>
          ) : (
            <SystemsTable
              systems={rows}
              columns={preferences.columns}
              density={preferences.density}
              widths={widths}
              selectedItemId={selectedItemId}
              sortKey={preferences.sortKey}
              sortDirection={preferences.sortDirection}
              onSort={sort}
              onSelect={openSystem}
              onAttention={openAttention}
              onWidthsChange={setWidths}
            />
          )}
        </div>
      </div>
      <SystemsSaveViewDialog
        open={dialog.open}
        title={dialog.mode === 'rename' ? 'Rename saved view' : 'Save current view'}
        description={dialog.mode === 'rename' ? 'Change the shared name without changing its current configuration.' : 'Filters, sorting, columns, and density synchronize with this view. Search and column widths stay on this browser.'}
        initialName={dialog.mode === 'rename' ? activeView?.name ?? '' : ''}
        busy={savedViews.create.isPending || savedViews.replace.isPending}
        error={dialog.error}
        onOpenChange={(open) => setDialog((current) => ({ ...current, open, error: open ? current.error : null }))}
        onSubmit={(name) => void submitDialog(name)}
      />
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {activeView?.name}?</AlertDialogTitle>
            <AlertDialogDescription>This removes the synchronized view. It does not change any inventory data.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savedViews.remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={savedViews.remove.isPending} onClick={() => void deleteActiveView()}>Delete view</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}
