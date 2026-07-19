import { AlertTriangle } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { CompatibilityFields } from '@/components/inventory-form/compatibility-fields'
import { FieldLabel } from '@/components/inventory-form/field-primitives'
import {
  createInventoryFormValues,
  inventoryFormValuesToInput,
  validateInventoryFormValues,
  type InventoryFormErrors,
  type InventoryFormValues,
} from '@/components/inventory-form/model'
import {
  CPU_MANUFACTURERS,
  fieldClassName,
  GPU_MANUFACTURERS,
  INVENTORY_TYPES,
  TYPE_LABELS,
} from '@/components/inventory-form/options'
import { PortGroupsEditor } from '@/components/inventory-form/port-groups-editor'
import { InventoryCommonFields, InventoryTypeFields } from '@/components/inventory-form/type-fields'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { InventoryItemInput } from '@/lib/db'
import type { InventoryType } from '@/types/inventory'

export function InventoryItemDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (item: InventoryItemInput, quantity: number) => Promise<void>
}) {
  const [values, setValues] = useState<InventoryFormValues>(() => createInventoryFormValues('server'))
  const [quantity, setQuantity] = useState('1')
  const [errors, setErrors] = useState<InventoryFormErrors>({})
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const selectMenuOpenRef = useRef(false)
  const lastSelectInteractionRef = useRef(0)

  function resetDraft() {
    selectMenuOpenRef.current = false
    lastSelectInteractionRef.current = 0
    setValues(createInventoryFormValues('server'))
    setQuantity('1')
    setErrors({})
    setPending(false)
    setError(null)
    setDirty(false)
    setDiscardOpen(false)
    setFormKey((current) => current + 1)
  }

  function markDirty() {
    setDirty(true)
  }

  function updateValues(patch: Partial<InventoryFormValues>) {
    markDirty()
    setValues((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch) as Array<keyof InventoryFormValues>) delete next[key]
      return next
    })
    setError(null)
  }

  function requestClose() {
    if (pending) return
    if (selectMenuOpenRef.current || Date.now() - lastSelectInteractionRef.current < 200) return
    if (dirty) {
      setDiscardOpen(true)
      return
    }
    resetDraft()
    onOpenChange(false)
  }

  function handleDialogOpenChange(nextOpen: boolean) {
    if (nextOpen) onOpenChange(true)
    else requestClose()
  }

  function discardChanges() {
    resetDraft()
    onOpenChange(false)
  }

  function changeType(nextType: InventoryType) {
    const next = createInventoryFormValues(nextType)
    const constrainedManufacturers = nextType === 'cpu'
      ? CPU_MANUFACTURERS
      : nextType === 'gpu'
        ? GPU_MANUFACTURERS
        : null
    setValues((current) => ({
      ...next,
      name: current.name,
      manufacturer: constrainedManufacturers
        ? constrainedManufacturers.includes(current.manufacturer.trim())
          ? current.manufacturer.trim()
          : ''
        : current.manufacturer,
      model: current.model,
      notes: current.notes,
    }))
    setErrors({})
    setError(null)
    markDirty()
  }

  function handleSelectOpenChange(selectOpen: boolean) {
    selectMenuOpenRef.current = selectOpen
    lastSelectInteractionRef.current = Date.now()
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsedQuantity = Number(quantity)
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 100) {
      setError('Quantity must be between 1 and 100.')
      return
    }

    const nextErrors = validateInventoryFormValues(values)
    setErrors(nextErrors)

    if (Object.keys(nextErrors).length) {
      setError(nextErrors.name ?? nextErrors.portGroups ?? 'Correct the highlighted fields.')
      return
    }

    setPending(true)
    setError(null)
    try {
      await onCreate(inventoryFormValuesToInput(values), parsedQuantity)
      resetDraft()
      onOpenChange(false)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Item could not be created.')
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="!flex max-h-[calc(100dvh-2rem)] !flex-col gap-0 overflow-hidden bg-[#fffdf8] p-0 text-[#20242c] sm:max-w-2xl">
          <DialogHeader className="border-b border-[#ded8ce] px-4 py-4">
            <DialogTitle>Add inventory item</DialogTitle>
          </DialogHeader>
          <form key={formKey} noValidate onSubmit={handleSubmit} onChange={markDirty} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
              <FieldLabel>
                <span>Type</span>
                <Select value={values.type} onValueChange={(value) => changeType(value as InventoryType)} onOpenChange={handleSelectOpenChange}>
                  <SelectTrigger className={fieldClassName()} aria-label="Inventory type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INVENTORY_TYPES.map((inventoryType) => <SelectItem key={inventoryType} value={inventoryType}>{TYPE_LABELS[inventoryType]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FieldLabel>

              <InventoryCommonFields type={values.type} values={values} errors={errors} onChange={updateValues} onSelectOpenChange={handleSelectOpenChange} />
              <InventoryTypeFields type={values.type} values={values} errors={errors} onChange={updateValues} onSelectOpenChange={handleSelectOpenChange} />
              <CompatibilityFields values={values} errors={errors} onChange={updateValues} onSelectOpenChange={handleSelectOpenChange} />
              <PortGroupsEditor type={values.type} groups={values.portGroups} error={errors.portGroups} onChange={(portGroups) => updateValues({ portGroups })} onSelectOpenChange={handleSelectOpenChange} />

              <FieldLabel>
                <span>Quantity</span>
                <Input
                  aria-label="Quantity"
                  min={1}
                  max={100}
                  step={1}
                  type="number"
                  value={quantity}
                  onChange={(event) => {
                    markDirty()
                    setQuantity(event.target.value)
                    setError(null)
                  }}
                />
              </FieldLabel>

              <FieldLabel>
                <span>Notes</span>
                <textarea aria-label="Notes" name="notes" value={values.notes} onChange={(event) => updateValues({ notes: event.target.value })} className="min-h-20 w-full rounded-lg border border-[#ded8ce] bg-[#fffdf8] px-3 py-2 text-sm text-[#20242c] outline-none transition placeholder:text-[#8d857b] focus-visible:border-[#20242c] focus-visible:ring-2 focus-visible:ring-[#ddb668]/40" placeholder="Optional notes" />
              </FieldLabel>

              {error ? <div className="rounded-md border border-[#dfb3a5] bg-[#fff4ef] px-3 py-2 text-sm text-[#8b3322]">{error}</div> : null}
            </div>
            <DialogFooter className="!mx-0 !mb-0 shrink-0 rounded-b-xl border-t border-[#ded8ce] bg-[#f5f0e8] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <Button type="button" variant="outline" onClick={requestClose}>Cancel</Button>
              <Button type="submit" disabled={pending}>{pending ? 'Adding...' : 'Add item'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent className="bg-[#fffdf8] text-[#20242c] sm:max-w-md">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-[#fff2c7] p-2 text-[#8b6514]"><AlertTriangle className="size-5" /></div>
              <div className="space-y-2">
                <DialogTitle>Discard changes?</DialogTitle>
                <DialogDescription>This item has unsaved changes. Closing the form will lose this draft.</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <DialogFooter className="bg-[#f5f0e8]">
            <Button type="button" variant="outline" onClick={() => setDiscardOpen(false)}>Keep editing</Button>
            <Button type="button" variant="destructive" onClick={discardChanges}>Discard changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
