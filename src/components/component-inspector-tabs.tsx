import { useContext, useState } from 'react'
import {
  inventoryTypeHasPorts,
  type InventoryFormValues,
} from '@/components/inventory-form/model'
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
import type { AgentStorageItemTelemetry } from '@/types/agent'
import { StorageUsageTab } from '@/components/inspector/equipment/storage-usage-tab'
import { InventoryItemMetadataEditor } from '@/components/inventory-metadata/inventory-item-metadata-editor'
import { InspectorInventoryMetadataContext } from '@/components/inspector/inspector-inventory-metadata-context'

export type ComponentInspectorTabsProps = InventorySpecsTabContentProps & {
  project: ProjectState
  item: InventoryItem
  storageTelemetry?: AgentStorageItemTelemetry | null
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
  agentSuggestions,
  storageTelemetry,
}: ComponentInspectorTabsProps) {
  const metadata = useContext(InspectorInventoryMetadataContext)
  const [activeTab, setActiveTab] = useState('specs')
  if (!componentTypes.has(values.type)) return null

  const hasPortsTab = inventoryTypeHasPorts(values.type, values.networkTechnology)

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="min-w-0 gap-3">
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
        {values.type === 'storage' && storageTelemetry ? (
          <TabsTrigger
            value="usage"
            className="!h-9 flex-none rounded-none px-2 text-[11px] font-black uppercase tracking-[0.09em] text-[#75695d] data-active:text-[#20242c]"
          >
            Usage
          </TabsTrigger>
        ) : null}
        <TabsTrigger
          value="compatibility"
          className="!h-9 flex-none rounded-none px-2 text-[11px] font-black uppercase tracking-[0.09em] text-[#75695d] data-active:text-[#20242c]"
        >
          Compatibility
        </TabsTrigger>
        {metadata ? (
          <TabsTrigger
            value="metadata"
            className="!h-9 flex-none rounded-none px-2 text-[11px] font-black uppercase tracking-[0.09em] text-[#75695d] data-active:text-[#20242c]"
          >
            Metadata
          </TabsTrigger>
        ) : null}
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
        includeCompatibility={false}
        agentSuggestions={agentSuggestions}
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

      {values.type === 'storage' && storageTelemetry ? (
        <TabsContent value="usage" className="m-0 min-w-0">
          <StorageUsageTab storage={storageTelemetry} />
        </TabsContent>
      ) : null}

      <TabsContent value="compatibility" className="m-0 min-w-0">
        <ComponentCompatibilityTab
          project={project}
          item={item}
          values={values}
          errors={errors}
          onChange={(patch, mode = 'debounced') => onChange(patch, mode)}
          onSelectOpenChange={onSelectOpenChange}
        />
      </TabsContent>
      {metadata ? (
        <TabsContent value="metadata" className="m-0 min-w-0">
          <InventoryItemMetadataEditor
            projectId={metadata.projectId}
            item={metadata.item}
            canEdit={metadata.canEdit}
            enabled={activeTab === 'metadata'}
            onSaved={metadata.onSaved}
          />
        </TabsContent>
      ) : null}
    </Tabs>
  )
}
