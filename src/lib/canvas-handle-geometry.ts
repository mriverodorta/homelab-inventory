export type CanvasHandleGeometry = {
  id: string | null
  position: string
  x: number
  y: number
  width: number
  height: number
}

export type CanvasNodeHandleGeometry = {
  nodeId: string
  source: CanvasHandleGeometry[]
  target: CanvasHandleGeometry[]
}

type MeasuredHandle = {
  id?: string | null
  position: string
  x: number
  y: number
  width: number
  height: number
}

export type MeasuredHandleNode = {
  id: string
  internals: {
    handleBounds?: {
      source?: MeasuredHandle[] | null
      target?: MeasuredHandle[] | null
    }
  }
}

function normalizeHandle(handle: MeasuredHandle): CanvasHandleGeometry {
  return {
    id: handle.id ?? null,
    position: handle.position,
    x: handle.x,
    y: handle.y,
    width: handle.width,
    height: handle.height,
  }
}

function compareHandles(first: CanvasHandleGeometry, second: CanvasHandleGeometry): number {
  return `${first.id ?? ''}:${first.position}`.localeCompare(`${second.id ?? ''}:${second.position}`)
}

export function normalizeCanvasHandleGeometry(
  nodes: Iterable<MeasuredHandleNode>,
): CanvasNodeHandleGeometry[] {
  return [...nodes].map((node) => ({
    nodeId: node.id,
    source: (node.internals.handleBounds?.source ?? []).map(normalizeHandle).sort(compareHandles),
    target: (node.internals.handleBounds?.target ?? []).map(normalizeHandle).sort(compareHandles),
  })).sort((first, second) => first.nodeId.localeCompare(second.nodeId))
}

function handlesEqual(
  first: readonly CanvasHandleGeometry[],
  second: readonly CanvasHandleGeometry[],
): boolean {
  return first.length === second.length && first.every((handle, index) => {
    const candidate = second[index]
    return handle.id === candidate.id &&
      handle.position === candidate.position &&
      handle.x === candidate.x &&
      handle.y === candidate.y &&
      handle.width === candidate.width &&
      handle.height === candidate.height
  })
}

export function canvasHandleGeometryEqual(
  first: readonly CanvasNodeHandleGeometry[],
  second: readonly CanvasNodeHandleGeometry[],
): boolean {
  return first.length === second.length && first.every((node, index) => {
    const candidate = second[index]
    return node.nodeId === candidate.nodeId &&
      handlesEqual(node.source, candidate.source) &&
      handlesEqual(node.target, candidate.target)
  })
}

function hasRequiredHandles(
  geometry: CanvasNodeHandleGeometry,
  requiredHandleIds: ReadonlySet<string>,
): boolean {
  if (requiredHandleIds.size === 0) return true

  const availableHandleIds = new Set(
    [...geometry.source, ...geometry.target].flatMap((handle) => (
      handle.id &&
      Number.isFinite(handle.x) &&
      Number.isFinite(handle.y) &&
      handle.width > 0 &&
      handle.height > 0
        ? [handle.id]
        : []
    )),
  )

  return [...requiredHandleIds].every((handleId) => availableHandleIds.has(handleId))
}

export function reconcileCanvasHandleGeometry(
  current: CanvasNodeHandleGeometry[],
  next: readonly CanvasNodeHandleGeometry[],
  requiredHandlesByNodeId: ReadonlyMap<string, ReadonlySet<string>>,
): CanvasNodeHandleGeometry[] {
  const currentByNodeId = new Map(current.map((node) => [node.nodeId, node]))
  const nextByNodeId = new Map(next.map((node) => [node.nodeId, node]))
  const nodeIds = new Set(nextByNodeId.keys())

  for (const nodeId of requiredHandlesByNodeId.keys()) {
    nodeIds.add(nodeId)
  }

  const reconciled = [...nodeIds]
    .flatMap((nodeId) => {
      const nextNode = nextByNodeId.get(nodeId)
      const currentNode = currentByNodeId.get(nodeId)
      const requiredHandleIds = requiredHandlesByNodeId.get(nodeId)

      if (
        requiredHandleIds?.size &&
        (!nextNode || !hasRequiredHandles(nextNode, requiredHandleIds)) &&
        currentNode
      ) {
        return [currentNode]
      }

      return nextNode ? [nextNode] : []
    })
    .sort((first, second) => first.nodeId.localeCompare(second.nodeId))

  return canvasHandleGeometryEqual(current, reconciled)
    ? current
    : reconciled
}
