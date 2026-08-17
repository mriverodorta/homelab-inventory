import { ChevronDown, Rows3, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SystemsFilterMenu } from './systems-filter-menu'
import { SystemsColumnMenu } from './systems-column-menu'
import type { SystemsDensity, SystemsHostType, SystemsSavedView, SystemsViewColumn } from '@/types/systems'
import type { SystemsRegistrationFilter, SystemsRegistryFilter } from '@/lib/systems-preferences'

export type SystemsViewSelection = 'all' | 'attention' | number

export function SystemsToolbar({
  selection, views, modified, types, registrations, registryStates, typeOptions, columns, density, query,
  onSelection, onTypes, onRegistrations, onRegistryStates, onColumns, onDensity, onQuery,
  onSaveNew, onUpdate, onReset, onRename, onDelete, onSetDefault,
}: {
  selection: SystemsViewSelection
  views: readonly SystemsSavedView[]
  modified: boolean
  types: readonly SystemsHostType[]
  registrations: readonly SystemsRegistrationFilter[]
  registryStates: readonly SystemsRegistryFilter[]
  typeOptions: readonly { value: SystemsHostType; label: string }[]
  columns: readonly SystemsViewColumn[]
  density: SystemsDensity
  query: string
  onSelection(selection: SystemsViewSelection): void
  onTypes(values: SystemsHostType[]): void
  onRegistrations(values: SystemsRegistrationFilter[]): void
  onRegistryStates(values: SystemsRegistryFilter[]): void
  onColumns(values: SystemsViewColumn[]): void
  onDensity(value: SystemsDensity): void
  onQuery(value: string): void
  onSaveNew(): void
  onUpdate(): void
  onReset(): void
  onRename(): void
  onDelete(): void
  onSetDefault(): void
}) {
  const active = typeof selection === 'number' ? views.find((view) => view.id === selection) ?? null : null
  const selectionLabel = selection === 'all' ? 'All Systems' : selection === 'attention' ? 'Needs Attention' : active?.name ?? 'All Systems'
  return (
    <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2" data-testid="systems-toolbar">
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button type="button" variant="outline" size="sm" className="h-9 min-w-40 justify-between bg-white font-normal"><span className="truncate">{selectionLabel}{modified ? ' · Modified' : ''}</span><ChevronDown className="size-3.5" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Saved view</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => onSelection('all')}>All Systems</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onSelection('attention')}>Needs Attention</DropdownMenuItem>
          {views.length ? <DropdownMenuSeparator /> : null}
          {views.map((view) => <DropdownMenuItem key={view.id} onSelect={() => onSelection(view.id)}>{view.name}{view.isDefault ? <span className="ml-auto text-xs text-muted-foreground">Default</span> : null}</DropdownMenuItem>)}
          <DropdownMenuSeparator />
          {active && modified ? <DropdownMenuItem onSelect={onUpdate}>Update view</DropdownMenuItem> : null}
          {active && modified ? <DropdownMenuItem onSelect={onReset}>Reset changes</DropdownMenuItem> : null}
          <DropdownMenuItem onSelect={onSaveNew}>Save as new view</DropdownMenuItem>
          {active ? <><DropdownMenuSeparator /><DropdownMenuItem onSelect={onRename}>Rename</DropdownMenuItem><DropdownMenuItem onSelect={onSetDefault}>Set as default</DropdownMenuItem><DropdownMenuItem variant="destructive" onSelect={onDelete}>Delete view</DropdownMenuItem></> : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <SystemsFilterMenu label="System type" options={typeOptions} selected={types} onChange={onTypes} />
      <SystemsFilterMenu label="Agent" options={[{ value: 'registered', label: 'Registered' }, { value: 'unregistered', label: 'Unregistered' }]} selected={registrations} onChange={onRegistrations} />
      <SystemsFilterMenu label="Registry" options={[{ value: 'linked', label: 'Linked' }, { value: 'unlinked', label: 'Unlinked' }]} selected={registryStates} onChange={onRegistryStates} />
      <SystemsColumnMenu columns={columns} onChange={onColumns} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button type="button" variant="outline" size="icon-sm" className="size-9 bg-white" aria-label="Row density"><Rows3 /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start"><DropdownMenuLabel>Row density</DropdownMenuLabel><DropdownMenuRadioGroup value={density} onValueChange={(value) => onDensity(value as SystemsDensity)}><DropdownMenuRadioItem value="dense">Dense</DropdownMenuRadioItem><DropdownMenuRadioItem value="comfortable">Comfortable</DropdownMenuRadioItem></DropdownMenuRadioGroup></DropdownMenuContent>
      </DropdownMenu>
      <div className="relative ml-auto min-w-48 flex-1 sm:max-w-[300px]">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-[#81786e]" />
        <Input data-systems-search value={query} className="h-9 w-full bg-white pl-8" placeholder="Search systems" onChange={(event) => onQuery(event.target.value)} />
      </div>
    </div>
  )
}
