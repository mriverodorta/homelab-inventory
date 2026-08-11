import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readLatestLegacySnapshot } from './snapshot-reader.ts'
import { legacySemanticSnapshot } from './semantic-snapshot.ts'

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

describe('legacy snapshot reader', () => {
  test('reads schema 29 without mutating source files and summarizes stable semantics', async () => {
    const root = await mkdtemp(join(tmpdir(), 'homelab-legacy-reader-'))
    directories.push(root)
    const stores = join(root, 'stores')
    await mkdir(stores)
    const files = {
      meta: { schemaVersion: 29, appLastOpenedWith: '0.10.0', updatedAt: '2026-01-01T00:00:00.000Z' },
      inventory: { servers: [], nas: [], pcBuilds: [], cpus: [], ram: [{ id: 1, type: 'ram', name: 'RAM', specs: { capacityGb: 16 } }], storage: [], gpus: [], networkCards: [], motherboards: [], cpuCoolers: [], cases: [], powerSupplies: [], soundCards: [], wirelessCards: [], powerAdapters: [], switches: [], patchPanels: [], monitors: [], upsSystems: [], powerStrips: [] },
      project: { id: 'default', revision: 1, metadata: { name: 'Lab', version: 1 }, placements: [], assignments: [], connections: [], compatibilityPolicy: { disabledHosts: [], ignoredWarningIds: [] } },
    }
    await writeFile(join(root, 'meta.json'), JSON.stringify(files.meta))
    await writeFile(join(stores, 'inventory.json'), JSON.stringify(files.inventory))
    await writeFile(join(stores, 'project.json'), JSON.stringify(files.project))
    const before = await Bun.file(join(stores, 'inventory.json')).text()

    const loaded = await readLatestLegacySnapshot(root)
    expect(loaded.meta.schemaVersion).toBe(29)
    expect(await Bun.file(join(stores, 'inventory.json')).text()).toBe(before)
    expect(legacySemanticSnapshot(loaded)).toMatchObject({
      schemaVersion: 29,
      inventory: { total: 1, byType: { ram: 1 }, memoryCapacityMiB: 16 * 1024 },
      topology: { assignments: 0, placements: 0, connections: 0 },
    })
  })

  test('rejects future schemas explicitly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'homelab-legacy-future-'))
    directories.push(root)
    const stores = join(root, 'stores')
    await mkdir(stores)
    await writeFile(join(root, 'meta.json'), JSON.stringify({ schemaVersion: 30 }))
    await writeFile(join(stores, 'inventory.json'), '{}')
    await writeFile(join(stores, 'project.json'), '{}')
    await expect(readLatestLegacySnapshot(root)).rejects.toThrow(/newer than schema 29/iu)
  })

  test('upgrades older stores in an isolated clone without modifying the source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'homelab-legacy-upgrade-'))
    directories.push(root)
    const stores = join(root, 'stores')
    await mkdir(stores)
    const inventory = {
      servers: [], nas: [], pcBuilds: [], cpus: [],
      ram: [{ id: 1, type: 'ram', name: 'RAM', specs: { capacityGb: 16, speed: 3200, formFactor: 'SODIMM' } }],
      storage: [], gpus: [], networkCards: [], motherboards: [], cpuCoolers: [], cases: [],
      powerSupplies: [], soundCards: [], wirelessCards: [], powerAdapters: [], switches: [],
      patchPanels: [], monitors: [], upsSystems: [], powerStrips: [],
    }
    const project = {
      id: 'default', revision: 1, metadata: { name: 'Lab', version: 1 },
      placements: [], assignments: [], connections: [],
      compatibilityPolicy: { disabledHosts: [], ignoredWarningIds: [] },
    }
    await writeFile(join(root, 'meta.json'), JSON.stringify({
      schemaVersion: 28,
      onboarding: {
        version: 1, status: 'dismissed', sampleBatchId: null, sampleInventoryRefs: [],
        sampleAssignmentIds: [], sampleConnectionIds: [], walkthroughStep: 0,
        startedAt: null, completedAt: null,
      },
    }))
    await writeFile(join(stores, 'inventory.json'), JSON.stringify(inventory))
    await writeFile(join(stores, 'project.json'), JSON.stringify(project))
    const beforeMeta = await Bun.file(join(root, 'meta.json')).text()
    const beforeInventory = await Bun.file(join(stores, 'inventory.json')).text()

    const loaded = await readLatestLegacySnapshot(root)

    expect(loaded.meta.schemaVersion).toBe(29)
    expect(loaded.inventory.ram[0].specs).toMatchObject({ speedMt: 3200, formFactor: 'SO-DIMM' })
    expect(await Bun.file(join(root, 'meta.json')).text()).toBe(beforeMeta)
    expect(await Bun.file(join(stores, 'inventory.json')).text()).toBe(beforeInventory)
  })
})
