import type { InspectorAuditWarning } from '@/components/inspector/audit/audit-section'
import {
  ConnectionEditor,
  PortTabsEditor,
} from '@/components/inspector/connections/connection-editor'
import {
  EditableSpecsSection,
} from '@/components/inspector/shared/editable-specs-section'
import { updateEditorPorts } from '@/components/inspector/shared/inventory-editor-ports'
import { itemFromEditorValues } from '@/components/inspector/shared/item-editor-adapters'
import { InspectorTabs } from '@/components/inspector/inspector-tabs'
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

export function SwitchInspectorTabs({
  project,
  item,
  pendingEndpoint,
  auditWarnings,
  onUpdateItem,
  onCreateConnection,
  onEndpointConnectionClick,
  onUpdateConnectionLabel,
  onRemoveConnection,
}: {
  project: ProjectState
  item: InventoryItem
  pendingEndpoint: ConnectionEndpoint | null
  auditWarnings: InspectorAuditWarning[]
  onUpdateItem: (itemId: string, input: InventoryItemInput) => void
  onCreateConnection: (from: ConnectionEndpoint, to: ConnectionEndpoint) => void
  onEndpointConnectionClick: (endpoint: ConnectionEndpoint) => void
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
              title="Switch Details"
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
              <PortGroupsEditor
                type="switch"
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
      ]}
    />
  )
}
