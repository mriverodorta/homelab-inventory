import { Info } from 'lucide-react'
import { ComponentInspectorTabs } from '@/components/component-inspector-tabs'
import {
  PortTabsEditor,
} from '@/components/inspector/connections/connection-editor'
import { InspectorSection } from '@/components/inspector/inspector-section'
import { InspectorTabs, type InspectorTab } from '@/components/inspector/inspector-tabs'
import {
  updateEditorPorts,
} from '@/components/inspector/shared/inventory-editor-ports'
import { itemFromEditorValues } from '@/components/inspector/shared/item-editor-adapters'
import { itemTypeLabel } from '@/components/inspector/shared/item-formatters'
import { PortGroupsEditor } from '@/components/inventory-form/port-groups-editor'
import {
  HostCpuFields,
  HostExpansionFields,
  HostMemoryFields,
  HostStorageFields,
  HostTopologyCompletenessField,
  MotherboardPowerFields,
} from '@/components/inventory-form/compatibility-fields'
import {
  InventoryFormStatus,
  InventorySpecsFormContent,
} from '@/components/inventory-form/specs-tab-content'
import { useInventoryItemEditor } from '@/hooks/use-inventory-item-editor'
import type { InventoryItemInput } from '@/lib/db'
import { runtimeItemKey } from '@/lib/item-keys'
import type {
  ComponentType,
  ConnectionEndpoint,
  InventoryItem,
  InventoryPort,
  ProjectState,
} from '@/types/inventory'
import type { AgentHardwareSuggestion } from '@/types/agent'

const LEGACY_COMPONENT_INSPECTOR_TYPES = new Set<ComponentType>([
  'cpu',
  'ram',
  'storage',
  'gpu',
  'network',
])


export function ComponentItemEditor({
  project,
  item,
  validationMessage,
  pendingEndpoint,
  onUpdateItem,
  onEndpointConnectionClick,
  agentHardwareSuggestions,
}: {
  project: ProjectState
  item: InventoryItem & { type: ComponentType }
  validationMessage: string | null
  pendingEndpoint: ConnectionEndpoint | null
  onUpdateItem: (itemId: string, input: InventoryItemInput) => void
  onEndpointConnectionClick: (endpoint: ConnectionEndpoint) => void
  agentHardwareSuggestions: AgentHardwareSuggestion[]
}) {
  const editor = useInventoryItemEditor({
    item,
    onSave: (input) => onUpdateItem(runtimeItemKey(item), input),
  })
  const draftItem = itemFromEditorValues(item, editor.values)
  const handlePortsUpdate = (ports: InventoryPort[]) => updateEditorPorts(editor, ports)

  if (!LEGACY_COMPONENT_INSPECTOR_TYPES.has(item.type)) {
    const tabs: InspectorTab[] = [
      {
        value: 'specs',
        label: 'Specs',
        content: (
          <InspectorSection title={`${itemTypeLabel(item.type)} Details`} icon={Info}>
            <InventorySpecsFormContent
              values={editor.values}
              errors={editor.errors}
              onChange={editor.updateValues}
              includeCompatibility={false}
              agentSuggestions={agentHardwareSuggestions}
            />
          </InspectorSection>
        ),
      },
    ]

    if (item.type === 'motherboard') {
      const sharedFields = {
        values: editor.values,
        errors: editor.errors,
        onChange: editor.updateValues,
      }
      tabs.push(
        { value: 'cpu', label: 'CPU', content: <HostCpuFields {...sharedFields} /> },
        { value: 'memory', label: 'Memory', content: <HostMemoryFields {...sharedFields} /> },
        { value: 'storage', label: 'Storage', content: <HostStorageFields {...sharedFields} /> },
        { value: 'expansion', label: 'Expansion', content: <HostExpansionFields {...sharedFields} /> },
        {
          value: 'ports',
          label: 'Ports',
          content: (
            <>
              <PortGroupsEditor
                type="motherboard"
                groups={editor.values.portGroups}
                error={editor.errors.portGroups}
                onChange={(portGroups) => editor.updateValues({ portGroups }, 'immediate')}
              />
              <PortTabsEditor
                project={project}
                item={draftItem}
                pendingEndpoint={pendingEndpoint}
                onUpdate={handlePortsUpdate}
                onEndpointConnect={onEndpointConnectionClick}
              />
            </>
          ),
        },
        { value: 'power', label: 'Power', content: <MotherboardPowerFields {...sharedFields} /> },
        { value: 'compatibility', label: 'Compatibility', content: <HostTopologyCompletenessField {...sharedFields} /> },
      )
    }

    return (
      <InspectorTabs
        defaultValue="specs"
        status={<InventoryFormStatus validationMessage={validationMessage} saveError={editor.saveError} />}
        tabs={tabs}
      />
    )
  }

  return (
    <ComponentInspectorTabs
      project={project}
      item={draftItem}
      values={editor.values}
      errors={editor.errors}
      validationMessage={validationMessage}
      saveError={editor.saveError}
      onChange={editor.updateValues}
      agentSuggestions={agentHardwareSuggestions}
    />
  )
}
