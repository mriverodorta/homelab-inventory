import { AlertTriangle } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { CatalogSourcePanel } from '@/components/inventory/catalog-source-panel'
import { PrivateTemplatePanel } from '@/components/inventory/private-template-panel'
import {
  CpuCompatibilityFields,
  ExpansionCompatibilityFields,
  HostRequirementFields,
  HostResourceFields,
} from '@/components/inventory-form/compatibility-fields'
import {
  findFirstInventoryDialogErrorTab,
  getInventoryDialogTabs,
  type InventoryDialogFormErrors,
  type InventoryDialogTabId,
} from '@/components/inventory-form/dialog-tab-policy'
import { FieldError, FieldLabel } from '@/components/inventory-form/field-primitives'
import {
  createInventoryFormValues,
  inventoryFormValuesToInput,
  validateInventoryFormValues,
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
import { SmartPowerStripFields } from '@/components/inventory-form/smart-power-strip-fields'
import { SmartPowerStripDisableDialog } from '@/components/smart-power-strip-disable-dialog'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { InventoryItemInput } from '@/lib/db'
import { cn } from '@/lib/utils'
import type { InventoryType } from '@/types/inventory'
import {
  DEFAULT_REGISTRY_STATE,
  type InventorySourceTab,
  type RegistryState,
} from '@/types/registry'

const DIALOG_TAB_LABELS: Record<InventoryDialogTabId, string> = {
  specs: 'Specs',
  compatibility: 'Compatibility',
  resources: 'Resources',
  ports: 'Ports',
  smart: 'Smart',
}

function availableDefaultSource(registry: RegistryState): InventorySourceTab {
  const preferred = registry.settings.defaultInventorySource
  if (preferred === 'catalog' && (registry.settings.mode === 'disabled' || !registry.snapshot)) return 'manual'
  return preferred
}

export function InventoryItemDialog({
  open,
  onOpenChange,
  onCreate,
  registry = DEFAULT_REGISTRY_STATE,
  onDuplicatePrivateTemplate,
  onDeletePrivateTemplate,
  onOpenRegistrySettings,
  onCreateCatalogItem,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (item: InventoryItemInput, quantity: number) => Promise<void>
  registry?: RegistryState
  onDuplicatePrivateTemplate?: (id: number) => Promise<void>
  onDeletePrivateTemplate?: (id: number) => Promise<void>
  onOpenRegistrySettings?: () => void
  onCreateCatalogItem?: (templateKey: string, quantity: number, usageRole?: 'server' | 'desktop' | 'workstation' | 'other') => Promise<void>
}) {
  const [activeSource, setActiveSource] = useState<InventorySourceTab>(() => availableDefaultSource(registry))
  const [values, setValues] = useState<InventoryFormValues>(() => createInventoryFormValues('server'))
  const [quantity, setQuantity] = useState('1')
  const [errors, setErrors] = useState<InventoryDialogFormErrors>({})
  const [activeTab, setActiveTab] = useState<InventoryDialogTabId>('specs')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [smartDisableOpen, setSmartDisableOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const formRef = useRef<HTMLFormElement>(null)
  const quantityErrorId = useId()
  const selectMenuOpenRef = useRef(false)
  const lastSelectInteractionRef = useRef(0)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (open && !wasOpenRef.current) setActiveSource(availableDefaultSource(registry))
    wasOpenRef.current = open
  }, [open, registry])

  function resetDraft() {
    selectMenuOpenRef.current = false
    lastSelectInteractionRef.current = 0
    setValues(createInventoryFormValues('server'))
    setQuantity('1')
    setErrors({})
    setActiveTab('specs')
    setPending(false)
    setError(null)
    setDirty(false)
    setDiscardOpen(false)
    setSmartDisableOpen(false)
    setActiveSource(availableDefaultSource(registry))
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
    setActiveTab('specs')
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
    const nextErrors: InventoryDialogFormErrors = {
      ...validateInventoryFormValues(values),
    }
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 100) {
      nextErrors.quantity = 'Quantity must be between 1 and 100.'
    }
    setErrors(nextErrors)

    if (Object.keys(nextErrors).length) {
      const errorTab = findFirstInventoryDialogErrorTab(values.type, nextErrors) ?? 'specs'
      setActiveTab(errorTab)
      setError('Correct the highlighted fields.')
      requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      })
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

  async function handleTemplateCreate(item: InventoryItemInput, templateQuantity: number) {
    setPending(true)
    setError(null)
    try {
      await onCreate(item, templateQuantity)
      resetDraft()
      onOpenChange(false)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Template could not be added.')
    } finally {
      setPending(false)
    }
  }

  const tabs = getInventoryDialogTabs(values.type)
  const sharedFieldProps = {
    values,
    errors,
    onChange: updateValues,
    onSelectOpenChange: handleSelectOpenChange,
  }

  let activeTabContent: ReactNode
  if (activeTab === 'compatibility') {
    if (values.type === 'server' || values.type === 'nas' || values.type === 'motherboard') {
      activeTabContent = <HostRequirementFields {...sharedFieldProps} />
    } else if (values.type === 'cpu') {
      activeTabContent = <CpuCompatibilityFields {...sharedFieldProps} />
    } else if (values.type === 'ram') {
      activeTabContent = <InventoryTypeFields type="ram" {...sharedFieldProps} />
    } else {
      activeTabContent = <ExpansionCompatibilityFields {...sharedFieldProps} />
    }
  } else if (activeTab === 'resources') {
    activeTabContent = <HostResourceFields {...sharedFieldProps} />
  } else if (activeTab === 'ports') {
    activeTabContent = (
      <PortGroupsEditor
        type={values.type}
        groups={values.portGroups}
        error={errors.portGroups}
        onChange={(portGroups) => updateValues({ portGroups })}
        onSelectOpenChange={handleSelectOpenChange}
      />
    )
  } else if (activeTab === 'smart') {
    activeTabContent = (
      <SmartPowerStripFields
        values={values}
        onChange={updateValues}
        onDisableRequest={() => setSmartDisableOpen(true)}
      />
    )
  } else {
    activeTabContent = (
      <>
        <InventoryCommonFields
          type={values.type}
          values={values}
          errors={errors}
          onChange={updateValues}
          onSelectOpenChange={handleSelectOpenChange}
        />
        {values.type === 'ram' ? null : (
          <InventoryTypeFields
            type={values.type}
            values={values}
            errors={errors}
            onChange={updateValues}
            onSelectOpenChange={handleSelectOpenChange}
          />
        )}

        <FieldLabel>
          <span>Quantity</span>
          <Input
            aria-label="Quantity"
            aria-invalid={Boolean(errors.quantity)}
            aria-describedby={errors.quantity ? quantityErrorId : undefined}
            min={1}
            max={100}
            step={1}
            type="number"
            value={quantity}
            onChange={(event) => {
              markDirty()
              setQuantity(event.target.value)
              setErrors((current) => {
                const next = { ...current }
                delete next.quantity
                return next
              })
              setError(null)
            }}
          />
          <FieldError id={quantityErrorId} message={errors.quantity} />
        </FieldLabel>

        <FieldLabel>
          <span>Notes</span>
          <textarea aria-label="Notes" name="notes" value={values.notes} onChange={(event) => updateValues({ notes: event.target.value })} className="min-h-20 w-full rounded-lg border border-[#ded8ce] bg-[#fffdf8] px-3 py-2 text-sm text-[#20242c] outline-none transition placeholder:text-[#8d857b] focus-visible:border-[#20242c] focus-visible:ring-2 focus-visible:ring-[#ddb668]/40" placeholder="Optional notes" />
        </FieldLabel>
      </>
    )
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          data-testid="inventory-item-dialog-content"
          className={cn(
            '!flex max-h-[calc(100dvh-2rem)] !flex-col gap-0 overflow-hidden bg-[#fffdf8] p-0 text-[#20242c]',
            activeSource === 'catalog'
              ? 'h-[calc(100dvh-2rem)] sm:h-[min(52rem,calc(100dvh-2rem))] sm:max-w-[min(96vw,88rem)]'
              : 'sm:max-w-3xl',
          )}
        >
          <DialogHeader className="border-b border-[#ded8ce] px-4 py-4">
            <DialogTitle>Add inventory item</DialogTitle>
          </DialogHeader>
          <Tabs value={activeSource} onValueChange={(value) => setActiveSource(value as InventorySourceTab)} className="min-h-0 flex-1 gap-0 overflow-hidden">
            <div className="shrink-0 overflow-x-auto overflow-y-hidden border-b border-[#ded8ce] px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <TabsList variant="line" className="h-12 min-w-max justify-start gap-6 p-0">
                <TabsTrigger value="catalog" className="h-12 flex-none px-1">Catalog</TabsTrigger>
                <TabsTrigger value="manual" className="h-12 flex-none px-1">Manual</TabsTrigger>
                <TabsTrigger value="private-templates" className="h-12 flex-none px-1">Private templates</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent
              value="catalog"
              data-testid="catalog-tab-content"
              className="m-0 min-h-0 flex-1 overflow-y-auto lg:flex lg:overflow-hidden"
            >
              <CatalogSourcePanel
                registry={registry}
                onCreate={onCreateCatalogItem ? async (templateKey, catalogQuantity, usageRole) => {
                  setPending(true)
                  setError(null)
                  try {
                    await onCreateCatalogItem(templateKey, catalogQuantity, usageRole)
                    resetDraft()
                    onOpenChange(false)
                  } catch (createError) {
                    setError(createError instanceof Error ? createError.message : 'Catalog item could not be added.')
                    throw createError
                  } finally {
                    setPending(false)
                  }
                } : undefined}
                onOpenSettings={onOpenRegistrySettings ? () => {
                  resetDraft()
                  onOpenChange(false)
                  onOpenRegistrySettings()
                } : undefined}
              />
            </TabsContent>
            <TabsContent value="private-templates" className="m-0 min-h-0 flex-1 overflow-hidden">
              <PrivateTemplatePanel
                templates={registry.privateTemplates}
                pending={pending}
                onCreate={handleTemplateCreate}
                onDuplicate={onDuplicatePrivateTemplate}
                onDelete={onDeletePrivateTemplate}
              />
              {error ? <div className="mx-4 mb-4 rounded-md border border-[#dfb3a5] bg-[#fff4ef] px-3 py-2 text-sm text-[#8b3322]">{error}</div> : null}
            </TabsContent>
            <TabsContent value="manual" className="m-0 min-h-0 flex-1 overflow-hidden">
              <form ref={formRef} key={formKey} noValidate onSubmit={handleSubmit} onChange={markDirty} className="flex h-full min-h-0 flex-col">
                <div className="shrink-0 border-b border-[#ded8ce] px-4 py-3">
                  <FieldLabel>
                    <span>Type</span>
                    <Select value={values.type} onValueChange={(value) => changeType(value as InventoryType)} onOpenChange={handleSelectOpenChange}>
                      <SelectTrigger className={fieldClassName()} aria-label="Inventory type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {INVENTORY_TYPES.map((inventoryType) => <SelectItem key={inventoryType} value={inventoryType}>{TYPE_LABELS[inventoryType]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FieldLabel>
                </div>
                <Tabs value={activeTab} onValueChange={(tab) => setActiveTab(tab as InventoryDialogTabId)} className="min-h-0 flex-1 gap-0 overflow-hidden">
                  <div className="shrink-0 overflow-x-auto overflow-y-hidden border-b border-[#ded8ce] px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <TabsList variant="line" className="h-11 min-w-max justify-start gap-5 p-0">
                      {tabs.map((tab) => (
                        <TabsTrigger key={tab} value={tab} className="h-11 flex-none px-1 uppercase tracking-[0.08em]">{DIALOG_TAB_LABELS[tab]}</TabsTrigger>
                      ))}
                    </TabsList>
                  </div>
                  <TabsContent key={activeTab} value={activeTab} className="m-0 min-h-0 overflow-y-auto px-4 py-4">
                    <div className="space-y-4">
                      {activeTabContent}
                      {error ? <div className="rounded-md border border-[#dfb3a5] bg-[#fff4ef] px-3 py-2 text-sm text-[#8b3322]">{error}</div> : null}
                    </div>
                  </TabsContent>
                </Tabs>
                <DialogFooter className="!mx-0 !mb-0 shrink-0 rounded-b-xl border-t border-[#ded8ce] bg-[#f5f0e8] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                  <Button type="button" variant="outline" onClick={requestClose}>Cancel</Button>
                  <Button type="submit" disabled={pending}>{pending ? 'Adding...' : 'Add item'}</Button>
                </DialogFooter>
              </form>
            </TabsContent>
          </Tabs>
          {activeSource !== 'manual' ? (
            <DialogFooter className="!mx-0 !mb-0 shrink-0 rounded-b-xl border-t border-[#ded8ce] bg-[#f5f0e8] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <Button type="button" variant="outline" onClick={requestClose}>Close</Button>
            </DialogFooter>
          ) : null}
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
      <SmartPowerStripDisableDialog
        open={smartDisableOpen}
        onOpenChange={setSmartDisableOpen}
        onConfirm={() => {
          updateValues({
            smartEnabled: false,
            smartDisplayName: '',
            smartManagementIp: '',
            smartMacAddress: '',
            smartOutletNames: [],
          })
          setSmartDisableOpen(false)
        }}
      />
    </>
  )
}
