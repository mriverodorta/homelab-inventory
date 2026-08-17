import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NotificationStore } from './store.mjs'

const directories = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

async function createStore() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'notification-store-'))
  directories.push(dataDir)
  return new NotificationStore({ dataDir, now: () => 1_000 }).init()
}

describe('NotificationStore', () => {
  it('does not rewrite or revise a store when a mutation is a no-op', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'notification-store-'))
    directories.push(dataDir)
    let now = 0
    const store = await new NotificationStore({ dataDir, now: () => now }).init()
    const before = store.readConfig()
    const statBefore = await fs.stat(store.paths.config)

    now = 60_000
    await store.mutateConfig(() => 'unchanged')

    expect(store.readConfig()).toEqual(before)
    expect((await fs.stat(store.paths.config)).mtimeMs).toBe(statBefore.mtimeMs)
  })
  it('creates isolated persistence files with restricted modes', async () => {
    const store = await createStore()
    expect(store.readConfig().enabled).toBe(false)
    for (const filePath of Object.values(store.paths)) {
      expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600)
    }
  })

  it('serializes concurrent mutations without losing revisions', async () => {
    const store = await createStore()
    await Promise.all([
      store.mutateConfig((draft) => { draft.enabled = true }),
      store.mutateConfig((draft) => { draft.retention.incidentDays = 30 }),
    ])
    expect(store.readConfig()).toMatchObject({ enabled: true, revision: 3, retention: { incidentDays: 30 } })
  })

  it('publishes persisted changes to subscribers but skips no-op mutations', async () => {
    const store = await createStore()
    const events = []
    const unsubscribe = store.subscribe((event) => events.push(event))
    await store.mutateConfig((draft) => { draft.enabled = true })
    await store.mutateConfig(() => 'unchanged')
    unsubscribe()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ section: 'config', previous: { enabled: false }, current: { enabled: true } })
  })

  it('keeps monitoring policy revisions monotonic when restoring older configuration', async () => {
    const store = await createStore()
    await store.mutateConfig((draft) => { draft.enabled = true })
    const revisionBeforeRestore = store.readConfig().revision
    const restored = store.readConfig()
    restored.revision = 1
    restored.enabled = false

    await store.replace({ config: restored })

    expect(store.readConfig()).toMatchObject({ enabled: false, revision: revisionBeforeRestore + 1 })
  })

  it('does not replace valid state when a mutation fails validation', async () => {
    const store = await createStore()
    await expect(store.mutateConfig((draft) => {
      draft.rules[0].contactPointIds = [9]
    })).rejects.toThrow('missing contact point')
    expect(store.readConfig().rules[0].contactPointIds).toEqual([])
  })
})
