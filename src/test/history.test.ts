import { describe, expect, it } from 'vitest'
import {
  createEmptyHistory,
  MAX_HISTORY_ENTRIES,
  pushHistory,
  redoHistory,
  undoHistory,
} from '@/lib/history'
import { updateConnectionRoute } from '@/lib/project'
import type { ProjectState } from '@/types/inventory'

describe('project history', () => {
  it('keeps only the last 50 snapshots', () => {
    const history = Array.from({ length: MAX_HISTORY_ENTRIES + 5 }, (_, index) => index).reduce(
      (current, snapshot) => pushHistory(current, snapshot),
      createEmptyHistory<number>(),
    )

    expect(history.past).toHaveLength(MAX_HISTORY_ENTRIES)
    expect(history.past[0]).toBe(5)
    expect(history.past.at(-1)).toBe(54)
  })

  it('moves backward and forward through snapshots', () => {
    const history = pushHistory(pushHistory(createEmptyHistory<number>(), 1), 2)
    const undo = undoHistory(history, 3)

    expect(undo?.project).toBe(2)
    expect(undo?.history.future).toEqual([3])

    const redo = undo ? redoHistory(undo.history, undo.project) : null

    expect(redo?.project).toBe(3)
    expect(redo?.history.past).toEqual([1, 2])
  })

  it('clears redo entries when a new snapshot is pushed', () => {
    const history = pushHistory(pushHistory(createEmptyHistory<number>(), 1), 2)
    const undo = undoHistory(history, 3)

    expect(undo).not.toBeNull()
    expect(pushHistory(undo!.history, 9).future).toEqual([])
  })

  it('undoes and redoes a newly inserted cable bend exactly', () => {
    const project: ProjectState = {
      id: 'default',
      metadata: { name: 'History', version: 1, updatedAt: '2026-07-22T00:00:00.000Z' },
      items: {},
      placements: [],
      assignments: [],
      connections: [{
        id: 1,
        type: 'network',
        createdAt: '2026-07-22T00:00:00.000Z',
        from: { itemId: 'server:1', portId: 1 },
        to: { itemId: 'switch:1', portId: 1 },
      }],
    }
    const routed = updateConnectionRoute(project, 1, {
      bendPoints: [{ x: 120, y: 240 }],
    })
    const history = pushHistory(createEmptyHistory<ProjectState>(), project)
    const undone = undoHistory(history, routed)
    const redone = undone ? redoHistory(undone.history, undone.project) : null

    expect(undone?.project.connections[0].route).toBeUndefined()
    expect(redone?.project.connections[0].route?.bendPoints).toEqual([{ x: 120, y: 240 }])
  })

  it('undoes and redoes a per-cable overlap preference', () => {
    const project: ProjectState = {
      id: 'default',
      metadata: { name: 'History', version: 1, updatedAt: '2026-07-22T00:00:00.000Z' },
      items: {},
      placements: [],
      assignments: [],
      connections: [{
        id: 1,
        type: 'network',
        createdAt: '2026-07-22T00:00:00.000Z',
        from: { itemId: 'server:1', portId: 1 },
        to: { itemId: 'switch:1', portId: 1 },
      }],
    }
    const routed = updateConnectionRoute(project, 1, { avoidCableOverlap: true })
    const history = pushHistory(createEmptyHistory<ProjectState>(), project)
    const undone = undoHistory(history, routed)
    const redone = undone ? redoHistory(undone.history, undone.project) : null

    expect(routed.connections[0].route).toEqual({ avoidCableOverlap: true })
    expect(undone?.project.connections[0].route).toBeUndefined()
    expect(redone?.project.connections[0].route).toEqual({ avoidCableOverlap: true })
    expect(updateConnectionRoute(routed, 1, { avoidCableOverlap: false }).connections[0].route).toBeUndefined()
  })
})
