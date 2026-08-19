import { SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { CustomFieldDefinition, InventoryMetadataCatalog, InventoryMetadataFilter } from '@/types/inventory-metadata'

function filterFor(filters: readonly InventoryMetadataFilter[], definitionId: number) {
  return filters.find((filter) => 'definitionId' in filter && filter.definitionId === definitionId)
}

function replaceDefinitionFilter(
  filters: readonly InventoryMetadataFilter[],
  definitionId: number,
  next: InventoryMetadataFilter | null,
) {
  return [...filters.filter((filter) => !('definitionId' in filter) || filter.definitionId !== definitionId), ...(next ? [next] : [])]
}

function FieldFilter({ definition, filters, onChange }: {
  definition: CustomFieldDefinition
  filters: readonly InventoryMetadataFilter[]
  onChange(filters: InventoryMetadataFilter[]): void
}) {
  const active = filterFor(filters, definition.id)
  const set = (next: InventoryMetadataFilter | null) => onChange(replaceDefinitionFilter(filters, definition.id, next))
  const common = [{ value: 'any', label: 'Any value' }, { value: 'set', label: 'Is set' }, { value: 'unset', label: 'Not set' }]
  const operators = definition.fieldType === 'boolean'
    ? [...common, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]
    : definition.fieldType === 'singleSelect' || definition.fieldType === 'multiSelect'
      ? [...common, { value: 'options', label: 'Selected options' }]
      : definition.fieldType === 'number'
        ? [...common, { value: 'range', label: 'Range' }]
        : definition.fieldType === 'date' || definition.fieldType === 'dateTime'
          ? [...common, { value: 'date-range', label: 'Date range' }]
          : [...common, { value: 'contains', label: 'Contains' }]
  return (
    <div className="space-y-2 border-t border-border pt-3 first:border-0 first:pt-0">
      <div className="text-xs font-semibold text-foreground">{definition.name}</div>
      <Select
        value={active?.operator ?? 'any'}
        onValueChange={(operator) => {
          if (operator === 'any') set(null)
          else if (operator === 'set' || operator === 'unset' || operator === 'yes' || operator === 'no') set({ operator, definitionId: definition.id })
          else if (operator === 'contains') set({ operator, definitionId: definition.id, text: '' })
          else if (operator === 'range') set({ operator, definitionId: definition.id, minimum: null, maximum: null })
          else if (operator === 'date-range') set({ operator, definitionId: definition.id, after: null, before: null })
          else set({ operator: 'options', definitionId: definition.id, optionIds: [] })
        }}
      >
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{operators.map((operator) => <SelectItem key={operator.value} value={operator.value}>{operator.label}</SelectItem>)}</SelectContent>
      </Select>
      {active?.operator === 'contains' ? (
        <Input value={active.text} placeholder="Contains text" onChange={(event) => set({ ...active, text: event.target.value })} />
      ) : null}
      {active?.operator === 'range' ? (
        <div className="grid grid-cols-2 gap-2">
          <Input type="number" aria-label={`${definition.name} minimum`} placeholder="Minimum" value={active.minimum ?? ''} onChange={(event) => set({ ...active, minimum: event.target.value === '' ? null : Number(event.target.value) })} />
          <Input type="number" aria-label={`${definition.name} maximum`} placeholder="Maximum" value={active.maximum ?? ''} onChange={(event) => set({ ...active, maximum: event.target.value === '' ? null : Number(event.target.value) })} />
        </div>
      ) : null}
      {active?.operator === 'date-range' ? (
        <div className="grid grid-cols-2 gap-2">
          <Input type={definition.fieldType === 'dateTime' ? 'datetime-local' : 'date'} aria-label={`${definition.name} after`} value={active.after ?? ''} onChange={(event) => set({ ...active, after: event.target.value || null })} />
          <Input type={definition.fieldType === 'dateTime' ? 'datetime-local' : 'date'} aria-label={`${definition.name} before`} value={active.before ?? ''} onChange={(event) => set({ ...active, before: event.target.value || null })} />
        </div>
      ) : null}
      {active?.operator === 'options' ? (
        <div className="grid gap-1.5">
          {definition.options.filter((option) => !option.archivedAt).map((option) => (
            <label key={option.id} className="flex items-center gap-2 text-xs">
              <Checkbox checked={active.optionIds.includes(option.id)} onCheckedChange={(checked) => set({ ...active, optionIds: checked ? [...active.optionIds, option.id] : active.optionIds.filter((id) => id !== option.id) })} />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function InventoryMetadataFilters({ catalog, filters, onChange, dark = false }: {
  catalog: InventoryMetadataCatalog
  filters: readonly InventoryMetadataFilter[]
  onChange(filters: InventoryMetadataFilter[]): void
  dark?: boolean
}) {
  const tagFilter = filters.find((filter) => ['tags-any', 'has-tags', 'no-tags'].includes(filter.operator))
  const activeCount = filters.length
  const replaceTagFilter = (next: InventoryMetadataFilter | null) => onChange([
    ...filters.filter((filter) => filter.operator !== 'tags-any' && filter.operator !== 'has-tags' && filter.operator !== 'no-tags'),
    ...(next ? [next] : []),
  ])
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={dark ? 'h-9 border-white/10 bg-[#11151b] text-[#f7f1e8] hover:bg-white/10 hover:text-white' : 'h-9 bg-white'}>
          <SlidersHorizontal className="size-3.5" /> Metadata {activeCount ? <span className="font-bold">{activeCount}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <PopoverHeader className="flex-row items-center justify-between border-b border-border px-4 py-3">
          <PopoverTitle>Metadata filters</PopoverTitle>
          {activeCount ? <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}><X className="size-3.5" /> Clear</Button> : null}
        </PopoverHeader>
        <ScrollArea className="h-[min(32rem,70vh)]">
          <div className="space-y-4 p-4">
            {catalog.tags.length ? (
              <section className="space-y-2">
                <div className="text-xs font-semibold">Tags</div>
                <Select value={tagFilter?.operator ?? 'any'} onValueChange={(operator) => {
                  if (operator === 'any') replaceTagFilter(null)
                  else if (operator === 'has-tags' || operator === 'no-tags') replaceTagFilter({ operator })
                  else replaceTagFilter({ operator: 'tags-any', tagIds: [] })
                }}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any tags</SelectItem>
                    <SelectItem value="tags-any">Selected tags</SelectItem>
                    <SelectItem value="has-tags">Has tags</SelectItem>
                    <SelectItem value="no-tags">No tags</SelectItem>
                  </SelectContent>
                </Select>
                {tagFilter?.operator === 'tags-any' ? (
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {catalog.tags.filter((tag) => !tag.archivedAt).map((tag) => (
                      <label key={tag.id} className="flex items-center gap-2 text-xs">
                        <Checkbox checked={tagFilter.tagIds.includes(tag.id)} onCheckedChange={(checked) => {
                          const tagIds = checked ? [...tagFilter.tagIds, tag.id] : tagFilter.tagIds.filter((id) => id !== tag.id)
                          replaceTagFilter({ operator: 'tags-any', tagIds })
                        }} />
                        <span>{tag.name}</span>
                      </label>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}
            {catalog.definitions.filter((definition) => !definition.archivedAt).map((definition) => (
              <FieldFilter key={definition.id} definition={definition} filters={filters} onChange={onChange} />
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
