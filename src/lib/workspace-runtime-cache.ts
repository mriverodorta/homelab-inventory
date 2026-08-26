export type WorkspaceRuntimeRecord = {
  key: string
  busy: boolean
}

export type WorkspaceRuntimeAdapter<T extends WorkspaceRuntimeRecord> = {
  dispose(entry: T): void
}

type StoredRuntime<T> = {
  entry: T
  accessSequence: number
}

export class WorkspaceRuntimeCache<T extends WorkspaceRuntimeRecord> {
  private readonly entries = new Map<string, StoredRuntime<T>>()
  private readonly capacity: number
  private readonly adapter: WorkspaceRuntimeAdapter<T>
  private activeKey: string | null = null
  private sequence = 0

  constructor(
    capacity: number,
    adapter: WorkspaceRuntimeAdapter<T>,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error('Workspace runtime cache capacity must be a positive safe integer.')
    }
    this.capacity = capacity
    this.adapter = adapter
  }

  get size() {
    return this.entries.size
  }

  get active() {
    return this.activeKey
  }

  get(key: string) {
    return this.entries.get(key)?.entry
  }

  keys() {
    return [...this.entries.keys()]
  }

  values() {
    return [...this.entries.values()].map(({ entry }) => entry)
  }

  insert(entry: T) {
    const existing = this.entries.get(entry.key)
    if (existing && existing.entry !== entry) this.disposeStored(entry.key, existing)
    this.entries.set(entry.key, { entry, accessSequence: this.nextSequence() })
    this.prune()
    return entry
  }

  activate(key: string | null) {
    this.activeKey = key
    if (key !== null) {
      const stored = this.entries.get(key)
      if (!stored) throw new Error(`Workspace runtime ${key} is not cached.`)
      stored.accessSequence = this.nextSequence()
    }
    this.prune()
  }

  setBusy(key: string, busy: boolean) {
    const stored = this.entries.get(key)
    if (!stored) return
    stored.entry.busy = busy
    if (!busy) this.prune()
  }

  remove(key: string) {
    const stored = this.entries.get(key)
    if (!stored) return false
    if (this.activeKey === key) this.activeKey = null
    this.disposeStored(key, stored)
    return true
  }

  clear() {
    this.activeKey = null
    const storedEntries = [...this.entries.entries()]
    this.entries.clear()
    for (const [, stored] of storedEntries) this.adapter.dispose(stored.entry)
  }

  prune() {
    while (this.entries.size > this.capacity) {
      const candidate = [...this.entries.values()]
        .filter(({ entry }) => entry.key !== this.activeKey && !entry.busy)
        .sort((left, right) => left.accessSequence - right.accessSequence)[0]
      if (!candidate) return
      this.disposeStored(candidate.entry.key, candidate)
    }
  }

  private disposeStored(key: string, stored: StoredRuntime<T>) {
    if (this.entries.get(key) !== stored) return
    this.entries.delete(key)
    this.adapter.dispose(stored.entry)
  }

  private nextSequence() {
    this.sequence += 1
    return this.sequence
  }
}
