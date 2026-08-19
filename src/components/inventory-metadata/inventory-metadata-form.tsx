import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { CustomFieldDefinition, InventoryTag } from '@/types/inventory-metadata'
import type { InventoryMetadataDraft, InventoryMetadataDraftValue } from './inventory-metadata-draft'
import { COLOR_STYLES } from '@/components/settings/inventory-metadata/metadata-presentation'

function inputValue(value: InventoryMetadataDraftValue | undefined) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function dateTimeInputValue(value: InventoryMetadataDraftValue | undefined) {
  if (typeof value !== 'string' || !value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  const offset = parsed.getTimezoneOffset() * 60_000
  return new Date(parsed.getTime() - offset).toISOString().slice(0, 16)
}

function FieldControl({
  id,
  definition,
  value,
  disabled,
  onChange,
}: {
  id: string
  definition: CustomFieldDefinition
  value: InventoryMetadataDraftValue | undefined
  disabled: boolean
  onChange: (value: InventoryMetadataDraftValue) => void
}) {
  if (definition.fieldType === 'boolean') {
    return (
      <div className="flex min-h-9 items-center gap-2">
        <Switch id={id} checked={value === true} disabled={disabled} onCheckedChange={onChange} />
        <span className="text-sm text-muted-foreground">{value === true ? 'Yes' : 'No'}</span>
      </div>
    )
  }

  if (definition.fieldType === 'singleSelect') {
    return (
      <Select value={typeof value === 'number' ? String(value) : '__none'} disabled={disabled} onValueChange={(next) => onChange(next === '__none' ? null : Number(next))}>
        <SelectTrigger id={id} className="w-full"><SelectValue placeholder="Not set" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">Not set</SelectItem>
          {definition.options.filter((option) => !option.archivedAt).map((option) => (
            <SelectItem key={option.id} value={String(option.id)}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (definition.fieldType === 'multiSelect') {
    const selected = new Set(Array.isArray(value) ? value : [])
    return (
      <div className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2">
        {definition.options.filter((option) => !option.archivedAt).map((option) => (
          <label key={option.id} className="flex min-w-0 items-center gap-2 text-sm">
            <Checkbox
              checked={selected.has(option.id)}
              disabled={disabled}
              onCheckedChange={(checked) => onChange(checked
                ? [...selected, option.id].sort((left, right) => left - right)
                : [...selected].filter((id) => id !== option.id))}
            />
            <span className={cn('size-2.5 shrink-0 rounded-full', COLOR_STYLES[option.colorToken])} />
            <span className="truncate">{option.label}</span>
          </label>
        ))}
      </div>
    )
  }

  if (definition.fieldType === 'longText') {
    return <Textarea id={id} value={inputValue(value)} disabled={disabled} maxLength={5000} onChange={(event) => onChange(event.target.value)} />
  }

  const type = definition.fieldType === 'number'
    ? 'number'
    : definition.fieldType === 'date'
      ? 'date'
      : definition.fieldType === 'dateTime'
        ? 'datetime-local'
        : definition.fieldType === 'url'
          ? 'url'
          : 'text'
  const step = definition.fieldType === 'number'
    ? definition.numberPrecision === null || definition.numberPrecision === 0
      ? '1'
      : String(10 ** -definition.numberPrecision)
    : undefined

  return (
    <div className="relative">
      <Input
        id={id}
        type={type}
        value={definition.fieldType === 'dateTime' ? dateTimeInputValue(value) : inputValue(value)}
        disabled={disabled}
        min={definition.fieldType === 'number' ? definition.numberMinimum ?? undefined : undefined}
        max={definition.fieldType === 'number' ? definition.numberMaximum ?? undefined : undefined}
        step={step}
        onChange={(event) => {
          if (definition.fieldType === 'number') {
            const parsed = Number(event.target.value)
            onChange(event.target.value === '' || !Number.isFinite(parsed) ? null : parsed)
            return
          }
          if (definition.fieldType === 'dateTime') {
            onChange(event.target.value === '' ? null : new Date(event.target.value).toISOString())
            return
          }
          onChange(event.target.value)
        }}
      />
      {definition.unit ? <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-muted-foreground">{definition.unit}</span> : null}
    </div>
  )
}

export function InventoryMetadataForm({
  definitions,
  tags,
  draft,
  disabled = false,
  onChange,
}: {
  definitions: readonly CustomFieldDefinition[]
  tags: readonly InventoryTag[]
  draft: InventoryMetadataDraft
  disabled?: boolean
  onChange: (draft: InventoryMetadataDraft) => void
}) {
  const activeDefinitions = definitions.filter((definition) => !definition.archivedAt)
  const activeTags = tags.filter((tag) => !tag.archivedAt)

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-bold text-foreground">Tags</h3>
          <p className="text-xs text-muted-foreground">Reusable private labels for search and filtering.</p>
        </div>
        {activeTags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {activeTags.map((tag) => {
              const selected = draft.tagIds.includes(tag.id)
              return (
                <label key={tag.id} className={cn('flex items-center gap-2 rounded-md border px-2.5 py-2 text-sm transition-colors', selected ? 'border-foreground/30 bg-muted' : 'border-border bg-background')}>
                  <Checkbox
                    checked={selected}
                    disabled={disabled}
                    onCheckedChange={(checked) => onChange({
                      ...draft,
                      tagIds: checked
                        ? [...draft.tagIds, tag.id].sort((left, right) => left - right)
                        : draft.tagIds.filter((id) => id !== tag.id),
                    })}
                  />
                  <span className={cn('size-2.5 rounded-full', COLOR_STYLES[tag.colorToken])} />
                  <span>{tag.name}</span>
                </label>
              )
            })}
          </div>
        ) : <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">No active tags are available.</p>}
      </section>

      <section className="space-y-4 border-t border-border pt-5">
        <div>
          <h3 className="text-sm font-bold text-foreground">Custom fields</h3>
          <p className="text-xs text-muted-foreground">Installation-defined data that stays outside Registry catalog content.</p>
        </div>
        {activeDefinitions.length > 0 ? activeDefinitions.map((definition) => {
          const controlId = `inventory-metadata-field-${definition.id}`
          return (
          <div key={definition.id} className="grid gap-1.5">
            <label htmlFor={controlId} className="text-sm font-semibold text-foreground">{definition.name}</label>
            {definition.description ? <span className="text-xs leading-5 text-muted-foreground">{definition.description}</span> : null}
            <FieldControl
              id={controlId}
              definition={definition}
              value={draft.values[definition.id]}
              disabled={disabled}
              onChange={(value) => onChange({ ...draft, values: { ...draft.values, [definition.id]: value } })}
            />
          </div>
          )
        }) : <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">No custom fields apply to this inventory type.</p>}
      </section>
    </div>
  )
}
