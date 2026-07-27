import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HomelabInventoryStore } from '../../server/db/store.mjs'

const temporaryDirectories: string[] = []

async function createStore() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'homelab-onboarding-'))
  temporaryDirectories.push(dataDir)
  const store = new HomelabInventoryStore({
    appVersion: '0.0.0-test',
    dataDir,
    legacyProjectPath: path.join(dataDir, 'legacy.json'),
    saveDebounceMs: 1,
    seedEmptyData: false,
    seedDir: path.resolve('server/seed'),
  })
  await store.init()
  return store
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true }),
  ))
})

describe('onboarding store integration', () => {
  it('loads and removes the example in one revision each', async () => {
    const store = await createStore()
    expect(store.getOnboardingStatus()).toMatchObject({ status: 'available', shouldInvite: true })

    const loaded = await store.loadOnboardingExample()
    expect(loaded.project.revision).toBe(2)
    expect(loaded.status).toMatchObject({ status: 'sample_active', projectRevision: 2 })
    expect(Object.keys(loaded.project.items)).toHaveLength(10)

    const repeated = await store.loadOnboardingExample()
    expect(repeated.project.revision).toBe(2)
    expect(Object.keys(repeated.project.items)).toHaveLength(10)

    const removed = await store.finishOnboardingExample('remove')
    expect(removed.project.revision).toBe(3)
    expect(Object.keys(removed.project.items)).toHaveLength(0)
    expect(removed.status.status).toBe('checklist_active')
    await store.flush()
  })

  it('updates walkthrough progress without invalidating the project', async () => {
    const store = await createStore()
    await store.loadOnboardingExample()
    const revision = store.getEngineRevision()

    expect(store.setOnboardingWalkthroughStep(2)).toMatchObject({ walkthroughStep: 2 })
    expect(store.getEngineRevision()).toBe(revision)
    await store.flush()
  })
})
