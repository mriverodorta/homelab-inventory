import { AlertTriangle } from 'lucide-react'
import { FieldError, FieldLabel } from '@/components/inventory-form/field-primitives'
import type {
  InventoryFormErrors,
  InventoryFormValues,
} from '@/components/inventory-form/model'
import { PortGroupsEditor } from '@/components/inventory-form/port-groups-editor'
import {
  InventoryCommonFields,
  InventoryTypeFields,
  type InventoryFieldChangeMode,
} from '@/components/inventory-form/type-fields'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'

export type ComponentInspectorTabsProps = {
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

const componentTypes = new Set<InventoryFormValues['type']>([
  'cpu',
  'ram',
  'storage',
  'gpu',
  'network',
])

function InspectorErrors({
  validationMessage,
  saveError,
}: Pick<ComponentInspectorTabsProps, 'validationMessage' | 'saveError'>) {
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

export function ComponentInspectorTabs({
  values,
  errors,
  validationMessage,
  saveError,
  onChange,
  onSelectOpenChange,
}: ComponentInspectorTabsProps) {
  if (!componentTypes.has(values.type)) return null

  const hasPortsTab = values.type === 'gpu' || values.type === 'network'
  const handleFieldChange = (
    patch: Partial<InventoryFormValues>,
    mode: InventoryFieldChangeMode = 'debounced',
  ) => onChange(patch, mode)

  return (
    <Tabs defaultValue="specs" className="min-w-0 gap-3">
      <TabsList
        variant="line"
        aria-label="Component inspector sections"
        className="flex !h-auto w-full justify-start gap-2 overflow-x-auto overflow-y-hidden border-b border-[#e5dccf] bg-transparent px-0 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <TabsTrigger
          value="specs"
          className="!h-9 flex-none rounded-none px-2 text-[11px] font-black uppercase tracking-[0.09em] text-[#75695d] data-active:text-[#20242c]"
        >
          Specs
        </TabsTrigger>
        {hasPortsTab ? (
          <TabsTrigger
            value="ports"
            className="!h-9 flex-none rounded-none px-2 text-[11px] font-black uppercase tracking-[0.09em] text-[#75695d] data-active:text-[#20242c]"
          >
            Ports
          </TabsTrigger>
        ) : null}
      </TabsList>

      <InspectorErrors validationMessage={validationMessage} saveError={saveError} />

      <TabsContent value="specs" className="m-0 min-w-0 space-y-4">
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
      </TabsContent>

      {hasPortsTab ? (
        <TabsContent value="ports" className="m-0 min-w-0">
          <PortGroupsEditor
            type={values.type}
            groups={values.portGroups}
            error={errors.portGroups}
            onChange={(portGroups) => onChange({ portGroups }, 'immediate')}
            onSelectOpenChange={onSelectOpenChange}
          />
        </TabsContent>
      ) : null}
    </Tabs>
  )
}
