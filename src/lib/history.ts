export const MAX_HISTORY_ENTRIES = 50

export type HistoryState<T> = {
  past: T[]
  future: T[]
}

export function createEmptyHistory<T>(): HistoryState<T> {
  return {
    past: [],
    future: [],
  }
}

export function pushHistory<T>(history: HistoryState<T>, snapshot: T): HistoryState<T> {
  return {
    past: [...history.past, snapshot].slice(-MAX_HISTORY_ENTRIES),
    future: [],
  }
}

export function undoHistory<T>(
  history: HistoryState<T>,
  current: T,
): { history: HistoryState<T>; project: T } | null {
  const previous = history.past.at(-1)

  if (!previous) {
    return null
  }

  return {
    project: previous,
    history: {
      past: history.past.slice(0, -1),
      future: [current, ...history.future].slice(0, MAX_HISTORY_ENTRIES),
    },
  }
}

export function redoHistory<T>(
  history: HistoryState<T>,
  current: T,
): { history: HistoryState<T>; project: T } | null {
  const next = history.future[0]

  if (!next) {
    return null
  }

  return {
    project: next,
    history: {
      past: [...history.past, current].slice(-MAX_HISTORY_ENTRIES),
      future: history.future.slice(1),
    },
  }
}
