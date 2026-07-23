import {
  buildOrthogonalCablePoints,
  type OrthogonalPoint,
  type OrthogonalSide,
} from '@/lib/orthogonal-cable'
import { getCanvasItemHeight, getCanvasItemWidth } from '@/lib/project'
import type { ConnectionBendPoint, ProjectState } from '@/types/inventory'

export const CABLE_OBSTACLE_CLEARANCE = 12
export const CABLE_ROUTING_GRID_SIZE = 12
const ROUTE_CACHE_LIMIT = 300

export type CableObstacle = {
  itemId: string
  left: number
  top: number
  right: number
  bottom: number
}

export type CableObstacleSize = {
  width: number
  height: number
}

export type CableReservedSegment = {
  start: OrthogonalPoint
  end: OrthogonalPoint
}

export type CableRouteRequest = {
  source: OrthogonalPoint
  target: OrthogonalPoint
  sourceSide: OrthogonalSide
  targetSide: OrthogonalSide
  laneOffset: number
  obstacles: readonly CableObstacle[]
  sourceItemId: string
  targetItemId: string
  manualBendPoints?: readonly ConnectionBendPoint[]
  reservedSegments?: readonly CableReservedSegment[]
  snapToGrid: boolean
}

export type CableRouteResult = {
  points: OrthogonalPoint[]
  manualAnchorPointIndexes: number[]
  usedFallback: boolean
}

type Direction = 'horizontal' | 'vertical' | 'none'
type GraphNode = OrthogonalPoint & { id: number }
type GraphEdge = { to: number; direction: Exclude<Direction, 'none'>; distance: number }
type SearchScore = { bends: number; distance: number }
type SearchState = {
  nodeId: number
  direction: Direction
  phase: number
  score: SearchScore
  previousKey: string | null
}

const routeCache = new Map<string, CableRouteResult>()

function pointKey(point: OrthogonalPoint): string {
  return `${point.x},${point.y}`
}

function stateKey(nodeId: number, direction: Direction, phase: number): string {
  return `${nodeId}:${direction}:${phase}`
}

function pointsEqual(first: OrthogonalPoint, second: OrthogonalPoint): boolean {
  return first.x === second.x && first.y === second.y
}

function segmentOrientation(
  segment: CableReservedSegment,
): Exclude<Direction, 'none'> | null {
  if (segment.start.y === segment.end.y && segment.start.x !== segment.end.x) return 'horizontal'
  if (segment.start.x === segment.end.x && segment.start.y !== segment.end.y) return 'vertical'
  return null
}

function rangesOverlapBeyondPoint(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
): boolean {
  return Math.min(Math.max(firstStart, firstEnd), Math.max(secondStart, secondEnd)) >
    Math.max(Math.min(firstStart, firstEnd), Math.min(secondStart, secondEnd))
}

export function segmentsHaveCollinearConflict(
  first: CableReservedSegment,
  second: CableReservedSegment,
  separation = CABLE_ROUTING_GRID_SIZE,
): boolean {
  const firstOrientation = segmentOrientation(first)
  const secondOrientation = segmentOrientation(second)

  if (!firstOrientation || firstOrientation !== secondOrientation) return false

  if (firstOrientation === 'horizontal') {
    return Math.abs(first.start.y - second.start.y) < separation && rangesOverlapBeyondPoint(
      first.start.x,
      first.end.x,
      second.start.x,
      second.end.x,
    )
  }

  return Math.abs(first.start.x - second.start.x) < separation && rangesOverlapBeyondPoint(
    first.start.y,
    first.end.y,
    second.start.y,
    second.end.y,
  )
}

export function getReservableCableSegments(
  points: readonly OrthogonalPoint[],
): CableReservedSegment[] {
  const segments: CableReservedSegment[] = []

  for (let index = 1; index < points.length - 2; index += 1) {
    const start = points[index]
    const end = points[index + 1]

    if (start && end && segmentOrientation({ start, end })) segments.push({ start, end })
  }

  return segments
}

function sideOrientation(side: OrthogonalSide): Exclude<Direction, 'none'> {
  return side === 'left' || side === 'right' ? 'horizontal' : 'vertical'
}

function sideOffset(point: OrthogonalPoint, side: OrthogonalSide, distance: number): OrthogonalPoint {
  if (side === 'left') return { x: point.x - distance, y: point.y }
  if (side === 'right') return { x: point.x + distance, y: point.y }
  if (side === 'top') return { x: point.x, y: point.y - distance }
  return { x: point.x, y: point.y + distance }
}

function safeSideOffset(
  point: OrthogonalPoint,
  side: OrthogonalSide,
  preferredDistance: number,
  obstacles: readonly CableObstacle[],
): OrthogonalPoint {
  const distances = [...new Set([
    preferredDistance,
    Math.min(preferredDistance, CABLE_ROUTING_GRID_SIZE),
    0,
  ])].sort((first, second) => second - first)

  return distances
    .map((distance) => sideOffset(point, side, distance))
    .find((candidate) => (
      !pointInsideAnyObstacle(candidate, obstacles) && segmentClear(point, candidate, obstacles)
    )) ?? point
}

function obstacleSidePortal(
  point: OrthogonalPoint,
  side: OrthogonalSide,
  obstacle: CableObstacle | undefined,
  snapToGrid: boolean,
  fallbackDistance: number,
  obstacles: readonly CableObstacle[],
): OrthogonalPoint {
  if (!obstacle) {
    return safeSideOffset(point, side, fallbackDistance, obstacles)
  }

  if (side === 'left') {
    return { x: snapToGrid ? snapBefore(obstacle.left) : obstacle.left, y: point.y }
  }
  if (side === 'right') {
    return { x: snapToGrid ? snapAfter(obstacle.right) : obstacle.right, y: point.y }
  }
  if (side === 'top') {
    return { x: point.x, y: snapToGrid ? snapBefore(obstacle.top) : obstacle.top }
  }
  return { x: point.x, y: snapToGrid ? snapAfter(obstacle.bottom) : obstacle.bottom }
}

function snap(value: number): number {
  return Math.round(value / CABLE_ROUTING_GRID_SIZE) * CABLE_ROUTING_GRID_SIZE
}

function snapBefore(value: number): number {
  return Math.floor(value / CABLE_ROUTING_GRID_SIZE) * CABLE_ROUTING_GRID_SIZE
}

function snapAfter(value: number): number {
  return Math.ceil(value / CABLE_ROUTING_GRID_SIZE) * CABLE_ROUTING_GRID_SIZE
}

function pointInsideObstacle(point: OrthogonalPoint, obstacle: CableObstacle): boolean {
  return point.x > obstacle.left && point.x < obstacle.right &&
    point.y > obstacle.top && point.y < obstacle.bottom
}

function pointInsideAnyObstacle(point: OrthogonalPoint, obstacles: readonly CableObstacle[]): boolean {
  return obstacles.some((obstacle) => pointInsideObstacle(point, obstacle))
}

export function segmentCrossesObstacleInterior(
  first: OrthogonalPoint,
  second: OrthogonalPoint,
  obstacle: CableObstacle,
): boolean {
  if (first.y === second.y) {
    const left = Math.min(first.x, second.x)
    const right = Math.max(first.x, second.x)
    return first.y > obstacle.top && first.y < obstacle.bottom &&
      right > obstacle.left && left < obstacle.right
  }

  if (first.x === second.x) {
    const top = Math.min(first.y, second.y)
    const bottom = Math.max(first.y, second.y)
    return first.x > obstacle.left && first.x < obstacle.right &&
      bottom > obstacle.top && top < obstacle.bottom
  }

  return true
}

function segmentClear(
  first: OrthogonalPoint,
  second: OrthogonalPoint,
  obstacles: readonly CableObstacle[],
): boolean {
  return !obstacles.some((obstacle) => segmentCrossesObstacleInterior(first, second, obstacle))
}

export function buildCableObstacles(
  project: ProjectState,
  clearance = CABLE_OBSTACLE_CLEARANCE,
  measuredSizes: ReadonlyMap<string, CableObstacleSize> = new Map(),
): CableObstacle[] {
  return project.placements.flatMap((placement) => {
    const item = project.items[placement.serverId]
    if (!item) return []
    const measuredSize = measuredSizes.get(placement.serverId)
    const width = measuredSize?.width ?? getCanvasItemWidth(project, placement.serverId)
    const height = measuredSize?.height ?? getCanvasItemHeight(project, placement.serverId)

    return [{
      itemId: placement.serverId,
      left: placement.x - clearance,
      top: placement.y - clearance,
      right: placement.x + width + clearance,
      bottom: placement.y + height + clearance,
    }]
  })
}

function resolveCoveredAnchor(
  anchor: OrthogonalPoint,
  obstacles: readonly CableObstacle[],
  snapToGrid: boolean,
): OrthogonalPoint {
  if (!pointInsideAnyObstacle(anchor, obstacles)) return anchor

  const candidates = obstacles.flatMap((obstacle) => {
    if (!pointInsideObstacle(anchor, obstacle)) return []
    const left = snapToGrid ? snapBefore(obstacle.left) : obstacle.left
    const right = snapToGrid ? snapAfter(obstacle.right) : obstacle.right
    const top = snapToGrid ? snapBefore(obstacle.top) : obstacle.top
    const bottom = snapToGrid ? snapAfter(obstacle.bottom) : obstacle.bottom

    return [
      { x: left, y: snapToGrid ? snap(anchor.y) : anchor.y },
      { x: right, y: snapToGrid ? snap(anchor.y) : anchor.y },
      { x: snapToGrid ? snap(anchor.x) : anchor.x, y: top },
      { x: snapToGrid ? snap(anchor.x) : anchor.x, y: bottom },
    ]
  }).filter((candidate) => !pointInsideAnyObstacle(candidate, obstacles))

  return candidates.sort((first, second) => {
    const firstDistance = Math.abs(first.x - anchor.x) + Math.abs(first.y - anchor.y)
    const secondDistance = Math.abs(second.x - anchor.x) + Math.abs(second.y - anchor.y)
    return firstDistance - secondDistance || first.x - second.x || first.y - second.y
  })[0] ?? anchor
}

function coordinateValues(
  start: OrthogonalPoint,
  end: OrthogonalPoint,
  anchors: readonly OrthogonalPoint[],
  obstacles: readonly CableObstacle[],
  reservedSegments: readonly CableReservedSegment[],
  snapToGrid: boolean,
): { xs: number[]; ys: number[] } {
  const xs = new Set<number>([start.x, end.x, ...anchors.map((anchor) => anchor.x)])
  const ys = new Set<number>([start.y, end.y, ...anchors.map((anchor) => anchor.y)])

  for (const obstacle of obstacles) {
    xs.add(snapToGrid ? snapBefore(obstacle.left) : obstacle.left)
    xs.add(snapToGrid ? snapAfter(obstacle.right) : obstacle.right)
    ys.add(snapToGrid ? snapBefore(obstacle.top) : obstacle.top)
    ys.add(snapToGrid ? snapAfter(obstacle.bottom) : obstacle.bottom)
  }

  for (const segment of reservedSegments) {
    const orientation = segmentOrientation(segment)

    if (orientation === 'horizontal') {
      xs.add(segment.start.x)
      xs.add(segment.end.x)
      ys.add(segment.start.y - CABLE_ROUTING_GRID_SIZE)
      ys.add(segment.start.y + CABLE_ROUTING_GRID_SIZE)
    } else if (orientation === 'vertical') {
      ys.add(segment.start.y)
      ys.add(segment.end.y)
      xs.add(segment.start.x - CABLE_ROUTING_GRID_SIZE)
      xs.add(segment.start.x + CABLE_ROUTING_GRID_SIZE)
    }
  }

  const allX = [...xs]
  const allY = [...ys]
  const minimumX = Math.min(...allX)
  const maximumX = Math.max(...allX)
  const minimumY = Math.min(...allY)
  const maximumY = Math.max(...allY)
  xs.add((snapToGrid ? snapBefore(minimumX) : minimumX) - CABLE_ROUTING_GRID_SIZE)
  xs.add((snapToGrid ? snapAfter(maximumX) : maximumX) + CABLE_ROUTING_GRID_SIZE)
  ys.add((snapToGrid ? snapBefore(minimumY) : minimumY) - CABLE_ROUTING_GRID_SIZE)
  ys.add((snapToGrid ? snapAfter(maximumY) : maximumY) + CABLE_ROUTING_GRID_SIZE)

  return {
    xs: [...xs].sort((first, second) => first - second),
    ys: [...ys].sort((first, second) => first - second),
  }
}

function buildVisibilityGraph(
  start: OrthogonalPoint,
  end: OrthogonalPoint,
  anchors: readonly OrthogonalPoint[],
  obstacles: readonly CableObstacle[],
  reservedSegments: readonly CableReservedSegment[],
  snapToGrid: boolean,
): { nodes: GraphNode[]; edges: GraphEdge[][]; nodeIdByPoint: Map<string, number> } {
  const { xs, ys } = coordinateValues(start, end, anchors, obstacles, reservedSegments, snapToGrid)
  const nodes: GraphNode[] = []
  const nodeIdByPoint = new Map<string, number>()

  for (const y of ys) {
    for (const x of xs) {
      const point = { x, y }
      if (pointInsideAnyObstacle(point, obstacles)) continue
      const node = { ...point, id: nodes.length }
      nodes.push(node)
      nodeIdByPoint.set(pointKey(point), node.id)
    }
  }

  const edges = nodes.map(() => [] as GraphEdge[])
  const rows = new Map<number, GraphNode[]>()
  const columns = new Map<number, GraphNode[]>()

  for (const node of nodes) {
    rows.set(node.y, [...(rows.get(node.y) ?? []), node])
    columns.set(node.x, [...(columns.get(node.x) ?? []), node])
  }

  function connect(first: GraphNode, second: GraphNode, direction: Exclude<Direction, 'none'>) {
    if (!segmentClear(first, second, obstacles)) return
    const candidate = { start: first, end: second }
    if (reservedSegments.some((reserved) => segmentsHaveCollinearConflict(candidate, reserved))) return
    const distance = Math.abs(second.x - first.x) + Math.abs(second.y - first.y)
    if (distance === 0) return
    edges[first.id].push({ to: second.id, direction, distance })
    edges[second.id].push({ to: first.id, direction, distance })
  }

  for (const row of rows.values()) {
    row.sort((first, second) => first.x - second.x)
    for (let index = 0; index < row.length - 1; index += 1) {
      connect(row[index], row[index + 1], 'horizontal')
    }
  }

  for (const column of columns.values()) {
    column.sort((first, second) => first.y - second.y)
    for (let index = 0; index < column.length - 1; index += 1) {
      connect(column[index], column[index + 1], 'vertical')
    }
  }

  for (const nodeEdges of edges) {
    nodeEdges.sort((first, second) => first.to - second.to || first.direction.localeCompare(second.direction))
  }

  return { nodes, edges, nodeIdByPoint }
}

function scoreBetter(first: SearchScore, second: SearchScore | undefined): boolean {
  return !second || first.distance < second.distance ||
    (first.distance === second.distance && first.bends < second.bends)
}

class SearchHeap {
  private values: SearchState[] = []

  get size() {
    return this.values.length
  }

  push(value: SearchState) {
    this.values.push(value)
    let index = this.values.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (!this.before(this.values[index], this.values[parent])) break
      ;[this.values[index], this.values[parent]] = [this.values[parent], this.values[index]]
      index = parent
    }
  }

  pop(): SearchState | undefined {
    const first = this.values[0]
    const last = this.values.pop()
    if (!first || !last || this.values.length === 0) return first
    this.values[0] = last
    let index = 0
    while (true) {
      const left = index * 2 + 1
      const right = left + 1
      let smallest = index
      if (left < this.values.length && this.before(this.values[left], this.values[smallest])) smallest = left
      if (right < this.values.length && this.before(this.values[right], this.values[smallest])) smallest = right
      if (smallest === index) break
      ;[this.values[index], this.values[smallest]] = [this.values[smallest], this.values[index]]
      index = smallest
    }
    return first
  }

  private before(first: SearchState, second: SearchState): boolean {
    return first.score.distance < second.score.distance ||
      (first.score.distance === second.score.distance && (
        first.score.bends < second.score.bends ||
        (first.score.bends === second.score.bends && stateKey(first.nodeId, first.direction, first.phase) < stateKey(second.nodeId, second.direction, second.phase))
      ))
  }
}

function advancePhase(
  node: OrthogonalPoint,
  phase: number,
  anchors: readonly OrthogonalPoint[],
): number {
  let nextPhase = phase
  while (nextPhase < anchors.length && pointsEqual(node, anchors[nextPhase])) nextPhase += 1
  return nextPhase
}

function findGraphPath({
  start,
  end,
  anchors,
  obstacles,
  reservedSegments,
  snapToGrid,
  initialDirection,
  finalDirection,
}: {
  start: OrthogonalPoint
  end: OrthogonalPoint
  anchors: readonly OrthogonalPoint[]
  obstacles: readonly CableObstacle[]
  reservedSegments: readonly CableReservedSegment[]
  snapToGrid: boolean
  initialDirection: Exclude<Direction, 'none'>
  finalDirection: Exclude<Direction, 'none'>
}): OrthogonalPoint[] | null {
  const graph = buildVisibilityGraph(start, end, anchors, obstacles, reservedSegments, snapToGrid)
  const startId = graph.nodeIdByPoint.get(pointKey(start))
  const endId = graph.nodeIdByPoint.get(pointKey(end))
  if (startId === undefined || endId === undefined) return null

  const initialPhase = advancePhase(start, 0, anchors)
  const initial: SearchState = {
    nodeId: startId,
    direction: initialDirection,
    phase: initialPhase,
    score: { bends: 0, distance: 0 },
    previousKey: null,
  }
  const heap = new SearchHeap()
  const bestScores = new Map<string, SearchScore>()
  const states = new Map<string, SearchState>()
  const initialKey = stateKey(initial.nodeId, initial.direction, initial.phase)
  bestScores.set(initialKey, initial.score)
  states.set(initialKey, initial)
  heap.push(initial)
  let bestEnd: { key: string; score: SearchScore } | null = null

  while (heap.size > 0) {
    const current = heap.pop()!
    const currentKey = stateKey(current.nodeId, current.direction, current.phase)
    const knownScore = bestScores.get(currentKey)
    if (!knownScore || knownScore.bends !== current.score.bends || knownScore.distance !== current.score.distance) continue
    if (bestEnd && !scoreBetter(current.score, bestEnd.score)) continue

    if (current.nodeId === endId && current.phase === anchors.length) {
      const finalScore = {
        bends: current.score.bends + Number(current.direction !== finalDirection),
        distance: current.score.distance,
      }
      if (scoreBetter(finalScore, bestEnd?.score)) bestEnd = { key: currentKey, score: finalScore }
      continue
    }

    for (const edge of graph.edges[current.nodeId]) {
      const nextNode = graph.nodes[edge.to]
      const nextPhase = advancePhase(nextNode, current.phase, anchors)
      const nextScore = {
        bends: current.score.bends + Number(current.direction !== edge.direction),
        distance: current.score.distance + edge.distance,
      }
      const nextKey = stateKey(edge.to, edge.direction, nextPhase)
      if (!scoreBetter(nextScore, bestScores.get(nextKey))) continue
      const nextState: SearchState = {
        nodeId: edge.to,
        direction: edge.direction,
        phase: nextPhase,
        score: nextScore,
        previousKey: currentKey,
      }
      bestScores.set(nextKey, nextScore)
      states.set(nextKey, nextState)
      heap.push(nextState)
    }
  }

  if (!bestEnd) return null
  const path: OrthogonalPoint[] = []
  let key: string | null = bestEnd.key
  while (key) {
    const state = states.get(key)
    if (!state) break
    path.push({ x: graph.nodes[state.nodeId].x, y: graph.nodes[state.nodeId].y })
    key = state.previousKey
  }
  return path.reverse()
}

function simplifyPoints(
  points: readonly OrthogonalPoint[],
  protectedPoints: readonly OrthogonalPoint[],
): OrthogonalPoint[] {
  const protectedKeys = new Set(protectedPoints.map(pointKey))
  const unique = points.reduce<OrthogonalPoint[]>((result, point) => {
    if (!result.at(-1) || !pointsEqual(result.at(-1)!, point)) result.push(point)
    return result
  }, [])

  return unique.reduce<OrthogonalPoint[]>((result, point) => {
    const previous = result.at(-1)
    const beforePrevious = result.at(-2)
    const collinear = beforePrevious && previous && (
      (beforePrevious.x === previous.x && previous.x === point.x) ||
      (beforePrevious.y === previous.y && previous.y === point.y)
    )
    if (collinear && !protectedKeys.has(pointKey(previous))) {
      result[result.length - 1] = point
    } else {
      result.push(point)
    }
    return result
  }, [])
}

function cacheKey(request: CableRouteRequest, obstacles: readonly CableObstacle[]): string {
  return JSON.stringify({
    source: request.source,
    target: request.target,
    sourceSide: request.sourceSide,
    targetSide: request.targetSide,
    laneOffset: request.laneOffset,
    sourceItemId: request.sourceItemId,
    targetItemId: request.targetItemId,
    manualBendPoints: request.manualBendPoints ?? [],
    reservedSegments: request.reservedSegments ?? [],
    snapToGrid: request.snapToGrid,
    obstacles,
  })
}

function rememberRoute(key: string, result: CableRouteResult): CableRouteResult {
  routeCache.delete(key)
  routeCache.set(key, result)
  while (routeCache.size > ROUTE_CACHE_LIMIT) {
    const oldest = routeCache.keys().next().value
    if (oldest === undefined) break
    routeCache.delete(oldest)
  }
  return result
}

export function routeCableAroundObstacles(request: CableRouteRequest): CableRouteResult {
  const allObstacles = request.obstacles
  const routeCoordinates = [
    request.source,
    request.target,
    ...(request.manualBendPoints ?? []),
  ]
  const routingMargin = Math.max(96, request.laneOffset * 3)
  const routeBounds = {
    left: Math.min(...routeCoordinates.map((point) => point.x)) - routingMargin,
    right: Math.max(...routeCoordinates.map((point) => point.x)) + routingMargin,
    top: Math.min(...routeCoordinates.map((point) => point.y)) - routingMargin,
    bottom: Math.max(...routeCoordinates.map((point) => point.y)) + routingMargin,
  }
  const relevantObstacles = allObstacles.filter((obstacle) => (
    obstacle.right >= routeBounds.left && obstacle.left <= routeBounds.right &&
    obstacle.bottom >= routeBounds.top && obstacle.top <= routeBounds.bottom
  ))

  function routeIntersectsAny(points: readonly OrthogonalPoint[], obstacles: readonly CableObstacle[]) {
    return points.slice(0, -1).some((point, index) => {
      const next = points[index + 1]
      return next && obstacles.some((obstacle) => {
        if (index === 0 && obstacle.itemId === request.sourceItemId) return false
        if (index === points.length - 2 && obstacle.itemId === request.targetItemId) return false
        return segmentCrossesObstacleInterior(point, next, obstacle)
      })
    })
  }

  function calculate(obstacles: readonly CableObstacle[]): CableRouteResult {
    const key = cacheKey(request, obstacles)
    const cached = routeCache.get(key)
    if (cached && !routeIntersectsAny(cached.points, allObstacles)) {
      routeCache.delete(key)
      routeCache.set(key, cached)
      return cached
    }

    const sourceObstacle = obstacles.find((obstacle) => obstacle.itemId === request.sourceItemId)
    const targetObstacle = obstacles.find((obstacle) => obstacle.itemId === request.targetItemId)
    const sourceExit = obstacleSidePortal(
      request.source,
      request.sourceSide,
      sourceObstacle,
      request.snapToGrid,
      request.laneOffset,
      obstacles,
    )
    const targetEntry = obstacleSidePortal(
      request.target,
      request.targetSide,
      targetObstacle,
      request.snapToGrid,
      request.laneOffset,
      obstacles,
    )
    const anchors = (request.manualBendPoints ?? []).map((anchor) => (
      resolveCoveredAnchor(anchor, obstacles, request.snapToGrid)
    ))
    const graphPath = findGraphPath({
      start: sourceExit,
      end: targetEntry,
      anchors,
      obstacles,
      reservedSegments: request.reservedSegments ?? [],
      snapToGrid: request.snapToGrid,
      initialDirection: sideOrientation(request.sourceSide),
      finalDirection: sideOrientation(request.targetSide),
    })

    if (!graphPath) {
      const points = buildOrthogonalCablePoints({
        source: request.source,
        target: request.target,
        sourceSide: request.sourceSide,
        targetSide: request.targetSide,
        laneOffset: request.laneOffset,
        bendPoints: request.manualBendPoints ? [...request.manualBendPoints] : undefined,
      })
      return rememberRoute(key, { points, manualAnchorPointIndexes: [], usedFallback: true })
    }

    const points = simplifyPoints(
      [request.source, ...graphPath, request.target],
      [sourceExit, targetEntry, ...anchors],
    )
    const manualAnchorPointIndexes: number[] = []
    let searchFrom = 0
    for (const anchor of anchors) {
      const index = points.findIndex((point, pointIndex) => pointIndex >= searchFrom && pointsEqual(point, anchor))
      if (index >= 0) {
        manualAnchorPointIndexes.push(index)
        searchFrom = index + 1
      }
    }

    return rememberRoute(key, { points, manualAnchorPointIndexes, usedFallback: false })
  }

  const localResult = calculate(relevantObstacles)
  return routeIntersectsAny(localResult.points, allObstacles) && relevantObstacles.length !== allObstacles.length
    ? calculate(allObstacles)
    : localResult
}
