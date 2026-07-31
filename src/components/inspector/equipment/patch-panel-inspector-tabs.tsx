import type { InspectorAuditWarning } from '@/components/inspector/audit/audit-section'
import {
  ConnectionEditor,
  PatchPanelLabelGrid,
  PatchPanelRowDisplayControls,
  PortTabsEditor,
} from '@/components/inspector/connections/connection-editor'
import { InspectorTabs } from '@/components/inspector/inspector-tabs'
import { NetworkTraceSection } from '@/components/inspector/network/server-network-tab'
import {
  EditableSpecsSection,
} from '@/components/inspector/shared/editable-specs-section'
import { updateEditorPorts } from '@/components/inspector/shared/inventory-editor-ports'
import { itemFromEditorValues } from '@/components/inspector/shared/item-editor-adapters'
import { PortGroupsEditor } from '@/components/inventory-form/port-groups-editor'
import { InventoryFormStatus } from '@/components/inventory-form/specs-tab-content'
import { useInventoryItemEditor } from '@/hooks/use-inventory-item-editor'
import type { InventoryItemInput } from '@/lib/db'
import { runtimeItemKey } from '@/lib/item-keys'
import type {
  ConnectionEndpoint,
  InventoryItem,
  InventoryPort,
  ProjectState,
} from '@/types/inventory'

export function PatchPanelInspectorTabs({
  project,
  item,
  pendingEndpoint,
  auditWarnings,
  activeNetworkTraceKey,
  onUpdateItem,
  onCreateConnection,
  onEndpointConnectionClick,
  onSelectNetworkTrace,
  onUpdateConnectionLabel,
  onRemoveConnection,
}: {
  project: ProjectState
  item: InventoryItem
  pendingEndpoint: ConnectionEndpoint | null
  auditWarnings: InspectorAuditWarning[]
  activeNetworkTraceKey: string | null
  onUpdateItem: (itemId: string, input: InventoryItemInput) => void
  onCreateConnection: (from: ConnectionEndpoint, to: ConnectionEndpoint) => void
  onEndpointConnectionClick: (endpoint: ConnectionEndpoint) => void
  onSelectNetworkTrace: (endpoint: ConnectionEndpoint) => void
  onUpdateConnectionLabel: (connectionId: string | number, label: string) => void
  onRemoveConnection: (connectionId: string | number) => void
}) {
  const editor = useInventoryItemEditor({
    item,
    onSave: (input) => onUpdateItem(runtimeItemKey(item), input),
  })
  const draftItem = itemFromEditorValues(item, editor.values)
  const handlePortsUpdate = (ports: InventoryPort[]) => updateEditorPorts(editor, ports)

  return (
    <InspectorTabs
      defaultValue="specs"
      status={<InventoryFormStatus saveError={editor.saveError} />}
      tabs={[
        {
          value: 'specs',
          label: 'Specs',
          content: (
            <EditableSpecsSection
              title="Patch Panel Details"
              editor={editor}
              auditWarnings={auditWarnings}
            />
          ),
        },
        {
          value: 'ports',
          label: 'Ports',
          content: (
            <>
              <PatchPanelRowDisplayControls
                item={draftItem}
                onUpdateProperties={(properties) => editor.updateValues({
                  properties: {
                    ...editor.values.properties,
                    ...properties,
                  },
                }, 'immediate')}
              />
              <PatchPanelLabelGrid item={draftItem} onUpdate={handlePortsUpdate} />
              <PortGroupsEditor
                type="patchPanel"
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
        {
          value: 'connections',
          label: 'Connections',
          content: (
            <ConnectionEditor
              project={project}
              item={draftItem}
              onCreate={onCreateConnection}
              onUpdateLabel={onUpdateConnectionLabel}
              onRemove={onRemoveConnection}
            />
          ),
        },
        {
          value: 'network',
          label: 'Network',
          content: (
            <NetworkTraceSection
              item={draftItem}
              activeTraceKey={activeNetworkTraceKey}
              onSelectTrace={onSelectNetworkTrace}
            />
          ),
        },
      ]}
    />
  )
}
