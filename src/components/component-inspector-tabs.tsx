import type { InventoryFormValues } from '@/components/inventory-form/model'
import { ComponentCompatibilityTab } from '@/components/component-compatibility-tab'
import { PortGroupsEditor } from '@/components/inventory-form/port-groups-editor'
import {
  InventoryFormStatus,
  InventorySpecsTabContent,
  type InventorySpecsTabContentProps,
} from '@/components/inventory-form/specs-tab-content'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import type { InventoryItem, ProjectState } from '@/types/inventory'

export type ComponentInspectorTabsProps = InventorySpecsTabContentProps & {
  project: ProjectState
  item: InventoryItem
}

const componentTypes = new Set<InventoryFormValues['type']>([
  'cpu',
  'ram',
  'storage',
  'gpu',
  'network',
])

export function ComponentInspectorTabs({
  project,
  item,
  values,
  errors,
  validationMessage,
  saveError,
  onChange,
  onSelectOpenChange,
}: ComponentInspectorTabsProps) {
  if (!componentTypes.has(values.type)) return null

  const hasPortsTab = values.type === 'gpu' || values.type === 'network'

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
        <TabsTrigger
          value="compatibility"
          className="!h-9 flex-none rounded-none px-2 text-[11px] font-black uppercase tracking-[0.09em] text-[#75695d] data-active:text-[#20242c]"
        >
          Compatibility
        </TabsTrigger>
      </TabsList>

      <InventoryFormStatus
        validationMessage={validationMessage}
        saveError={saveError}
      />

      <InventorySpecsTabContent
        values={values}
        errors={errors}
        onChange={onChange}
        onSelectOpenChange={onSelectOpenChange}
      />

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

      <TabsContent value="compatibility" className="m-0 min-w-0">
        <ComponentCompatibilityTab project={project} item={item} />
      </TabsContent>
    </Tabs>
  )
}
