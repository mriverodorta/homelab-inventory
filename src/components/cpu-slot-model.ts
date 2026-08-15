import type { ComponentAssignment, InventoryItem } from '@/types/inventory'

export function hostCpuSocketCount(host: InventoryItem | undefined): number {
  const socketCount = host?.compatibility?.host?.cpu?.socketCount
  if (Number.isSafeInteger(socketCount) && Number(socketCount) >= 0) return Number(socketCount)
  const hasFixedCpu = host?.fixedComponents?.some((component) => (
    component.componentType === 'cpu' || component.item.type === 'cpu'
  ))
  return hasFixedCpu ? 0 : 1
}

export function assignmentCpuPosition(assignment: ComponentAssignment): number | null {
  const positions = assignment.allocation?.resourceType === 'cpu'
    ? assignment.allocation.positions
    : undefined
  return Array.isArray(positions) && positions.length === 1 && Number.isSafeInteger(positions[0]) && positions[0] >= 0
    ? positions[0]
    : null
}
