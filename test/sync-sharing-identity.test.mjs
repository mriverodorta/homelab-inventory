import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const roots = []
const execFileAsync = promisify(execFile)

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('business-data synchronization sharing boundary', () => {
  it('preserves destination sharing identity and never copies source identity', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-sharing-sync-'))
    roots.push(root)
    const source = path.join(root, 'source')
    const destination = path.join(root, 'destination')
    const output = path.join(root, 'output')
    await Promise.all([
      fs.mkdir(path.join(source, 'stores'), { recursive: true }),
      fs.mkdir(path.join(source, 'sharing'), { recursive: true }),
      fs.mkdir(path.join(destination, 'stores'), { recursive: true }),
      fs.mkdir(path.join(destination, 'sharing'), { recursive: true }),
    ])
    for (const name of ['inventory.json', 'project.json']) {
      await fs.writeFile(path.join(source, 'stores', name), JSON.stringify({ source: true }))
      await fs.writeFile(path.join(destination, 'stores', name), JSON.stringify({ source: false }))
    }
    await fs.writeFile(path.join(source, 'sharing', 'installation-instance.json'), 'source-identity')
    await fs.writeFile(path.join(destination, 'sharing', 'installation-instance.json'), 'destination-identity')
    await expect(execFileAsync('bash', [path.resolve('scripts/synchronize-business-data.sh'), source, destination, output])).resolves.toBeDefined()
    expect(await fs.readFile(path.join(output, 'sharing', 'installation-instance.json'), 'utf8')).toBe('destination-identity')
    expect(await fs.readFile(path.join(output, 'stores', 'inventory.json'), 'utf8')).toContain('"source":true')
    expect(await fs.readFile(path.join(output, 'stores', 'project.json'), 'utf8')).toContain('"source":true')
  })
})
