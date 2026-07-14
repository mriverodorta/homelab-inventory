import { AlertTriangle } from 'lucide-react'
import { TabsContent } from '@/components/ui/tabs'
import { FieldError, FieldLabel } from './field-primitives'
import type { InventoryFormErrors, InventoryFormValues } from './model'
import {
  InventoryCommonFields,
  InventoryTypeFields,
  type InventoryFieldChangeMode,
} from './type-fields'

export type InventorySpecsTabContentProps = {
  values: InventoryFormValues
  errors: InventoryFormErrors
  validationMessage?: string | null
  saveError?: string | null
  onChange: (
    patch: Partial<InventoryFormValues>,
    mode: InventoryFieldChangeMode,
  ) => void
  onSelectOpenChange?: (open: boolean) => void
}

export function InventoryFormStatus({
  validationMessage,
  saveError,
}: Pick<InventorySpecsTabContentProps, 'validationMessage' | 'saveError'>) {
  if (!validationMessage && !saveError) return null

  return (
    <div
      role="region"
      aria-label="Inspector errors"
      aria-live="polite"
      className="flex items-start gap-2 border-b border-[#dfb3a5] bg-[#fff4ee] px-2 py-2 text-xs font-semibold text-[#713325]"
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 space-y-0.5">
        {validationMessage ? <p>{validationMessage}</p> : null}
        {saveError ? <p>{saveError}</p> : null}
      </div>
    </div>
  )
}

export function InventorySpecsFormContent({
  values,
  errors,
  validationMessage,
  saveError,
  onChange,
  onSelectOpenChange,
}: InventorySpecsTabContentProps) {
  const handleFieldChange = (
    patch: Partial<InventoryFormValues>,
    mode: InventoryFieldChangeMode = 'debounced',
  ) => onChange(patch, mode)

  return (
    <>
      <InventoryFormStatus validationMessage={validationMessage} saveError={saveError} />
      <div className="min-w-0 space-y-4">
        <InventoryCommonFields
          type={values.type}
          values={values}
          errors={errors}
          onChange={handleFieldChange}
          onSelectOpenChange={onSelectOpenChange}
        />
        <InventoryTypeFields
          type={values.type}
          values={values}
          errors={errors}
          onChange={handleFieldChange}
          onSelectOpenChange={onSelectOpenChange}
        />
        <FieldLabel>
          <span>Notes</span>
          <textarea
            aria-label="Notes"
            aria-invalid={Boolean(errors.notes)}
            name="notes"
            value={values.notes}
            placeholder="Optional notes"
            className="min-h-20 w-full resize-y rounded-md border border-[#ded8ce] bg-[#fffdf8] px-3 py-2 text-sm text-[#20242c] outline-none transition placeholder:text-[#8d857b] focus-visible:border-[#20242c] focus-visible:ring-2 focus-visible:ring-[#ddb668]/40"
            onChange={(event) => onChange({ notes: event.target.value }, 'debounced')}
          />
          <FieldError message={errors.notes} />
        </FieldLabel>
      </div>
    </>
  )
}

export function InventorySpecsTabContent(props: InventorySpecsTabContentProps) {
  return (
    <TabsContent value="specs" className="m-0 min-w-0">
      <InventorySpecsFormContent {...props} />
    </TabsContent>
  )
}
