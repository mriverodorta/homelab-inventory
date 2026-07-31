import {
  inventoryFormValuesToInput,
  inventoryItemToFormValues,
  inventoryPortsToFormPatch,
  type InventoryFormValues,
} from '@/components/inventory-form/model'
import type { InventoryItemInput } from '@/lib/db'
import type { InventoryItem, InventoryPort } from '@/types/inventory'

export function itemFromEditorValues(
  item: InventoryItem,
  values: InventoryFormValues,
): InventoryItem {
  try {
    const input = inventoryFormValuesToInput(values)

    return {
      ...item,
      ...input,
      subtype: input.subtype,
      manufacturer: input.manufacturer,
      family: input.family,
      model: input.model,
      number: input.number,
      specs: input.specs,
      properties: input.properties,
      ports: input.ports,
      notes: input.notes,
    }
  } catch {
    return item
  }
}

export function itemInputWithPorts(
  item: InventoryItem,
  ports: InventoryPort[],
): InventoryItemInput {
  return inventoryFormValuesToInput({
    ...inventoryItemToFormValues(item),
    ...inventoryPortsToFormPatch(ports),
  })
}
