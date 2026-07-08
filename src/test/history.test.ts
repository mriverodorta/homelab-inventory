import { describe, expect, it } from 'vitest'
import {
  createEmptyHistory,
  MAX_HISTORY_ENTRIES,
  pushHistory,
  redoHistory,
  undoHistory,
} from '@/lib/history'

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
})
