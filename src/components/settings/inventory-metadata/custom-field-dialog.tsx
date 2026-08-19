import { useEffect, useMemo, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { INVENTORY_TYPES, TYPE_LABELS } from '@/components/inventory-form/options'
import {
  inventoryMetadataFieldTypes,
  type CustomFieldDefinition,
  type CustomFieldDefinitionInput,
  type InventoryMetadataFieldType,
} from '@/types/inventory-metadata'
import { CustomFieldOptionsEditor, type EditableOption } from './custom-field-options-editor'
import { FIELD_TYPE_LABELS } from './metadata-presentation'

type FieldForm = {
  name: string
  description: string
  fieldType: InventoryMetadataFieldType
  unit: string
  numberMinimum: string
  numberMaximum: string
  numberPrecision: string
  applicableItemTypes: string[]
  options: EditableOption[]
}

function initialForm(definition: CustomFieldDefinition | null): FieldForm {
  return {
    name: definition?.name ?? '',
    description: definition?.description ?? '',
    fieldType: definition?.fieldType ?? 'shortText' as InventoryMetadataFieldType,
    unit: definition?.unit ?? '',
    numberMinimum: definition?.numberMinimum?.toString() ?? '',
    numberMaximum: definition?.numberMaximum?.toString() ?? '',
    numberPrecision: definition?.numberPrecision?.toString() ?? '',
    applicableItemTypes: definition?.applicableItemTypes ?? [],
    options: definition?.options.map(({ id, label, colorToken }) => ({ id, label, colorToken })) ?? [],
  }
}

function optionalNumber(value: string): number | null {
  return value.trim() === '' ? null : Number(value)
}

export function CustomFieldDialog({
  open,
  definition,
  pending,
  error,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  definition: CustomFieldDefinition | null
  pending: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onSubmit: (input: CustomFieldDefinitionInput) => void
}) {
  const [form, setForm] = useState(() => initialForm(definition))
  useEffect(() => {
    if (open) setForm(initialForm(definition))
  }, [definition, open])
  const isSelect = form.fieldType === 'singleSelect' || form.fieldType === 'multiSelect'
  const valid = useMemo(() => (
    form.name.trim().length > 0
    && form.applicableItemTypes.length > 0
    && (!isSelect || (form.options.length > 0 && form.options.every((option) => option.label.trim().length > 0)))
  ), [form, isSelect])

  function submit() {
    onSubmit({
      name: form.name,
      description: form.description.trim() || null,
      fieldType: form.fieldType,
      unit: form.fieldType === 'number' ? form.unit.trim() || null : null,
      numberMinimum: form.fieldType === 'number' ? optionalNumber(form.numberMinimum) : null,
      numberMaximum: form.fieldType === 'number' ? optionalNumber(form.numberMaximum) : null,
      numberPrecision: form.fieldType === 'number' ? optionalNumber(form.numberPrecision) : null,
      applicableItemTypes: form.applicableItemTypes,
      options: isSelect ? form.options : [],
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[min(760px,calc(100dvh-2rem))] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{definition ? 'Edit custom field' : 'New custom field'}</DialogTitle>
          <DialogDescription>Define one private inventory value and the equipment types where it appears.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-bold">
              Name
              <Input value={form.name} maxLength={80} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <label className="grid gap-1.5 text-sm font-bold">
              Type
              <Select
                value={form.fieldType}
                disabled={definition !== null}
                onValueChange={(value) => setForm({ ...form, fieldType: value as InventoryMetadataFieldType })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {inventoryMetadataFieldTypes.map((type) => <SelectItem key={type} value={type}>{FIELD_TYPE_LABELS[type]}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
          </div>
          <label className="grid gap-1.5 text-sm font-bold">
            Description
            <Textarea value={form.description} maxLength={500} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </label>
          {form.fieldType === 'number' ? (
            <div className="grid gap-2 sm:grid-cols-4">
              <label className="grid gap-1.5 text-sm font-bold">Unit<Input value={form.unit} maxLength={24} onChange={(event) => setForm({ ...form, unit: event.target.value })} /></label>
              <label className="grid gap-1.5 text-sm font-bold">Minimum<Input type="number" value={form.numberMinimum} onChange={(event) => setForm({ ...form, numberMinimum: event.target.value })} /></label>
              <label className="grid gap-1.5 text-sm font-bold">Maximum<Input type="number" value={form.numberMaximum} onChange={(event) => setForm({ ...form, numberMaximum: event.target.value })} /></label>
              <label className="grid gap-1.5 text-sm font-bold">Decimals<Input type="number" min={0} max={6} value={form.numberPrecision} onChange={(event) => setForm({ ...form, numberPrecision: event.target.value })} /></label>
            </div>
          ) : null}
          {isSelect ? (
            <CustomFieldOptionsEditor options={form.options} onChange={(options) => setForm({ ...form, options })} />
          ) : null}
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-bold">Inventory types</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {INVENTORY_TYPES.map((type) => {
                const checked = form.applicableItemTypes.includes(type)
                return (
                  <label key={type} className="flex min-h-9 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(next) => setForm({
                        ...form,
                        applicableItemTypes: next
                          ? [...form.applicableItemTypes, type]
                          : form.applicableItemTypes.filter((candidate) => candidate !== type),
                      })}
                    />
                    {TYPE_LABELS[type]}
                  </label>
                )
              })}
            </div>
          </fieldset>
          {error ? <p role="alert" className="text-sm font-semibold text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={!valid || pending}>{pending ? 'Saving…' : 'Save field'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
