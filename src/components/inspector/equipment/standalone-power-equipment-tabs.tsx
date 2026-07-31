import { useEffect, useState } from 'react'
import type { InspectorAuditWarning } from '@/components/inspector/audit/audit-section'
import {
  PortTabsEditor,
  PowerEquipmentLayoutControls,
} from '@/components/inspector/connections/connection-editor'
import { InspectorTabs, type InspectorTab } from '@/components/inspector/inspector-tabs'
import { PowerEndpointsTab } from '@/components/inspector/power/power-endpoints-tab'
import {
  EditableSpecsSection,
} from '@/components/inspector/shared/editable-specs-section'
import { updateEditorPorts } from '@/components/inspector/shared/inventory-editor-ports'
import { itemFromEditorValues } from '@/components/inspector/shared/item-editor-adapters'
import { SmartPowerStripFields } from '@/components/inventory-form/smart-power-strip-fields'
import { InventoryFormStatus } from '@/components/inventory-form/specs-tab-content'
import { SmartPowerStripDisableDialog } from '@/components/smart-power-strip-disable-dialog'
import { useInventoryItemEditor } from '@/hooks/use-inventory-item-editor'
import type { InventoryItemInput } from '@/lib/db'
import { runtimeItemKey } from '@/lib/item-keys'
import { itemTypeLabel } from '@/components/inspector/shared/item-formatters'
import type {
  ConnectionEndpoint,
  InventoryItem,
  InventoryPort,
  InventoryProperties,
  ProjectState,
} from '@/types/inventory'

export function StandalonePowerEquipmentTabs({
  project,
  item,
  pendingEndpoint,
  auditWarnings,
  onUpdateItem,
  onUpdateItemProperties,
  onEndpointConnectionClick,
  onUpdateConnectionLabel,
  onRemoveConnection,
}: {
  project: ProjectState
  item: InventoryItem
  pendingEndpoint: ConnectionEndpoint | null
  auditWarnings: InspectorAuditWarning[]
  onUpdateItem: (itemId: string, input: InventoryItemInput) => void
  onUpdateItemProperties: (
    itemId: string,
    properties: InventoryProperties,
  ) => void | Promise<void>
  onEndpointConnectionClick: (endpoint: ConnectionEndpoint) => void
  onUpdateConnectionLabel: (connectionId: string | number, label: string) => void
  onRemoveConnection: (connectionId: string | number) => void
}) {
  const editor = useInventoryItemEditor({ item, onSave: (input) => onUpdateItem(runtimeItemKey(item), input) })
  const draftItem = itemFromEditorValues(item, editor.values)
  const [layoutProperties, setLayoutProperties] = useState<InventoryProperties>(item.properties ?? {})
  const [layoutSaving, setLayoutSaving] = useState(false)
  const [layoutSaveError, setLayoutSaveError] = useState<string | null>(null)
  const [smartDisableOpen, setSmartDisableOpen] = useState(false)
  const layoutItem = { ...draftItem, properties: layoutProperties }
  const inspectedItem = item.type === 'monitor'
    ? { ...draftItem, ports: draftItem.ports ?? item.ports }
    : draftItem
  const handlePortsUpdate = (ports: InventoryPort[]) => updateEditorPorts(editor, ports)
  const updateProperties = async (properties: InventoryProperties) => {
    const nextProperties = { ...layoutProperties, ...properties }
    setLayoutProperties(nextProperties)
    setLayoutSaving(true)
    setLayoutSaveError(null)

    try {
      await onUpdateItemProperties(runtimeItemKey(item), nextProperties)
    } catch (error) {
      setLayoutProperties(item.properties ?? {})
      setLayoutSaveError(error instanceof Error ? error.message : 'Layout could not be saved.')
    } finally {
      setLayoutSaving(false)
    }
  }

  useEffect(() => {
    setLayoutProperties(item.properties ?? {})
  }, [item.properties])
  const tabSignature = item.type === 'monitor'
    ? 'specs|ports'
    : item.type === 'powerStrip'
      ? 'specs|layout|outlets|smart'
      : 'specs|layout|outlets'

  return (
    <>
      <InspectorTabs
        key={tabSignature}
        defaultValue="specs"
        status={<InventoryFormStatus saveError={editor.saveError ?? layoutSaveError} />}
        tabs={[
        {
          value: 'specs',
          label: 'Specs',
          content: <EditableSpecsSection title={`${itemTypeLabel(item.type)} Details`} editor={editor} auditWarnings={auditWarnings} />,
        },
        ...(item.type === 'ups' || item.type === 'powerStrip'
          ? [{
              value: 'layout',
              label: 'Layout',
              content: (
                <PowerEquipmentLayoutControls
                  item={layoutItem}
                  disabled={layoutSaving}
                  onUpdateProperties={updateProperties}
                />
              ),
            } satisfies InspectorTab]
          : []),
        {
          value: item.type === 'monitor' ? 'ports' : 'outlets',
          label: item.type === 'monitor' ? 'Ports' : 'Outlets',
          content: (
            <>
              {item.type === 'monitor' && (inspectedItem.ports?.length ?? 0) > 0 ? (
                <PortTabsEditor
                  project={project}
                  item={inspectedItem}
                  pendingEndpoint={pendingEndpoint}
                  onUpdate={handlePortsUpdate}
                  onEndpointConnect={onEndpointConnectionClick}
                />
              ) : null}
              <PowerEndpointsTab
                project={project}
                item={inspectedItem}
                onUpdateConnectionLabel={onUpdateConnectionLabel}
                onRemoveConnection={onRemoveConnection}
              />
            </>
          ),
        },
        ...(item.type === 'powerStrip'
          ? [{
              value: 'smart',
              label: 'Smart',
              content: (
                <SmartPowerStripFields
                  values={editor.values}
                  onChange={editor.updateValues}
                  onDisableRequest={() => setSmartDisableOpen(true)}
                />
              ),
            } satisfies InspectorTab]
          : []),
        ]}
      />
      <SmartPowerStripDisableDialog
        open={smartDisableOpen}
        onOpenChange={setSmartDisableOpen}
        onConfirm={() => {
          editor.updateValues({
            smartEnabled: false,
            smartDisplayName: '',
            smartManagementIp: '',
            smartMacAddress: '',
            smartOutletNames: [],
          }, 'immediate')
          setSmartDisableOpen(false)
        }}
      />
    </>
  )
}
