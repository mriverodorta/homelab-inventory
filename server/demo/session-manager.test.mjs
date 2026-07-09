import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sanitizeDemoStores } from './sanitizer.mjs'

const tempDirs = []

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'homelab-demo-'))
  tempDirs.push(dir)

  return dir
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`)
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('demo data sanitizer', () => {
  it('copies only public stores and removes private fields', async () => {
    const sourceDir = await makeTempDir()
    const targetDir = await makeTempDir()

    await writeJson(path.join(sourceDir, 'meta.json'), {
      schemaVersion: 3,
      appLastOpenedWith: '0.1.10',
      lastSeenReleaseNotesVersion: '0.1.10',
      updatedAt: '2026-07-09T00:00:00.000Z',
    })
    await writeJson(path.join(sourceDir, 'stores', 'inventory.json'), {
      servers: [
        {
          id: 1,
          name: 'SkyWatch',
          type: 'server',
          specs: {
            manufacturer: 'Dell',
            model: 'OptiPlex Micro 7090',
            serialNumber: 'SECRET-SERIAL',
          },
          properties: {
            name: 'skywatch.local',
            lanIp: '10.10.10.5',
            tailscaleIp: '100.76.116.58',
            notes: 'token=abc123',
          },
        },
      ],
      cpus: [],
      ram: [],
      storage: [],
      networkCards: [],
      gpus: [],
      nas: [],
      switches: [],
      patchPanels: [],
    })
    await writeJson(path.join(sourceDir, 'stores', 'project.json'), {
      id: 'default',
      metadata: {
        name: 'Private Homelab',
        version: 1,
        updatedAt: '2026-07-09T00:00:00.000Z',
      },
      placements: [{ itemType: 'server', itemId: 1, x: 24, y: 48 }],
      assignments: [],
      connections: [],
    })
    await writeJson(path.join(sourceDir, 'stores', 'agents.json'), {
      enrollments: { secret: { tokenHash: 'hash' } },
      devices: { secret: { tokenHash: 'hash' } },
    })
    await writeJson(path.join(sourceDir, 'stores', 'agent-status.json'), {
      servers: { 1: { hostname: 'skywatch' } },
    })
    await writeJson(path.join(sourceDir, 'backups', 'backup.json'), { private: true })

    await sanitizeDemoStores({ sourceDir, targetDir, appVersion: '0.1.11' })

    const inventory = await readJson(path.join(targetDir, 'stores', 'inventory.json'))
    const project = await readJson(path.join(targetDir, 'stores', 'project.json'))
    const agents = await readJson(path.join(targetDir, 'stores', 'agents.json'))
    const agentStatus = await readJson(path.join(targetDir, 'stores', 'agent-status.json'))

    expect(inventory.servers[0].name).toBe('Demo Server 1')
    expect(inventory.servers[0].specs.serialNumber).toBeUndefined()
    expect(inventory.servers[0].properties.lanIp).toBe('')
    expect(inventory.servers[0].properties.tailscaleIp).toBe('')
    expect(inventory.servers[0].properties.notes).toBe('')
    expect(project.metadata.name).toBe('Homelab Inventory Demo')
    expect(agents).toEqual({ enrollments: {}, devices: {} })
    expect(agentStatus).toEqual({ servers: {} })
    await expect(fs.access(path.join(targetDir, 'backups'))).rejects.toThrow()
  })
})
