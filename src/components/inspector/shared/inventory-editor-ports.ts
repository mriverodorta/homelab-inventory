import { inventoryPortsToFormPatch } from '@/components/inventory-form/model'
import type { useInventoryItemEditor } from '@/hooks/use-inventory-item-editor'
import type { InventoryPort } from '@/types/inventory'

export function updateEditorPorts(
  editor: ReturnType<typeof useInventoryItemEditor>,
  ports: InventoryPort[],
): void {
  editor.updateValues(inventoryPortsToFormPatch(ports), 'immediate')
}
