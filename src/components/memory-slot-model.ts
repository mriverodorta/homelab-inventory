import type { ComponentAssignment, InventoryItem } from '@/types/inventory'

export function hostMemorySlotCount(host: InventoryItem | undefined): number | null {
  const slots = host?.compatibility?.host?.memory?.slots
  return Number.isSafeInteger(slots) && Number(slots) >= 0 ? Number(slots) : null
}

export function assignmentMemoryPosition(assignment: ComponentAssignment): number | null {
  const positions = assignment.allocation?.resourceType === 'memory'
    ? assignment.allocation.positions
    : undefined
  return Array.isArray(positions) && positions.length === 1 && Number.isSafeInteger(positions[0]) && positions[0] >= 0
    ? positions[0]
    : null
}
