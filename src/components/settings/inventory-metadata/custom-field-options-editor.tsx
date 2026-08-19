import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { inventoryMetadataColorTokens, type InventoryMetadataColorToken } from '@/types/inventory-metadata'
import { COLOR_STYLES } from './metadata-presentation'

export type EditableOption = {
  id?: number
  label: string
  colorToken: InventoryMetadataColorToken
}

export function CustomFieldOptionsEditor({
  options,
  onChange,
}: {
  options: EditableOption[]
  onChange: (options: EditableOption[]) => void
}) {
  function update(index: number, patch: Partial<EditableOption>) {
    onChange(options.map((option, optionIndex) => optionIndex === index ? { ...option, ...patch } : option))
  }

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-bold text-foreground">Options</legend>
      {options.map((option, index) => (
        <div key={option.id ?? `new-${index}`} className="grid grid-cols-[minmax(0,1fr)_132px_32px] items-center gap-2">
          <Input
            aria-label={`Option ${index + 1} label`}
            value={option.label}
            maxLength={80}
            onChange={(event) => update(index, { label: event.target.value })}
          />
          <Select value={option.colorToken} onValueChange={(value) => update(index, { colorToken: value as InventoryMetadataColorToken })}>
            <SelectTrigger aria-label={`Option ${index + 1} color`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {inventoryMetadataColorTokens.map((color) => (
                <SelectItem key={color} value={color}>
                  <span className="flex items-center gap-2 capitalize">
                    <span className={`size-2.5 rounded-full ${COLOR_STYLES[color]}`} aria-hidden="true" />
                    {color}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove option ${index + 1}`}
            onClick={() => onChange(options.filter((_, optionIndex) => optionIndex !== index))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => onChange([...options, { label: '', colorToken: 'gray' }])}
      >
        <Plus /> Add option
      </Button>
    </fieldset>
  )
}
