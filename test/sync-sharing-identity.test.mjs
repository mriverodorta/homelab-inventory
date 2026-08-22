import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
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
  const identityNames = [
    'installation-instance.json',
    'installation-ed25519.pem',
    'installation-credentials.json',
    'installation-recovery-ed25519.pem',
    'public-id-key',
  ]

  async function identityHashes(directory) {
    return Object.fromEntries(await Promise.all(identityNames.map(async (name) => [
      name,
      createHash('sha256').update(await fs.readFile(path.join(directory, 'sharing', name))).digest('hex'),
    ])))
  }

  it.each(['production-to-local', 'local-to-production'])('preserves every destination sharing identity for %s', async () => {
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
    for (const name of identityNames) {
      await fs.writeFile(path.join(source, 'sharing', name), `source-${name}`)
      await fs.writeFile(path.join(destination, 'sharing', name), `destination-${name}`)
    }
    const sourceHashes = await identityHashes(source)
    const destinationHashes = await identityHashes(destination)
    await expect(execFileAsync('bash', [path.resolve('scripts/synchronize-business-data.sh'), source, destination, output])).resolves.toBeDefined()
    expect(await identityHashes(output)).toEqual(destinationHashes)
    expect(await identityHashes(output)).not.toEqual(sourceHashes)
    expect(await fs.readFile(path.join(output, 'stores', 'inventory.json'), 'utf8')).toContain('"source":true')
    expect(await fs.readFile(path.join(output, 'stores', 'project.json'), 'utf8')).toContain('"source":true')
  })

  it('does not copy a source sharing identity into a destination without one', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-sharing-sync-empty-'))
    roots.push(root)
    const source = path.join(root, 'source')
    const destination = path.join(root, 'destination')
    const output = path.join(root, 'output')
    await Promise.all([
      fs.mkdir(path.join(source, 'stores'), { recursive: true }),
      fs.mkdir(path.join(source, 'sharing'), { recursive: true }),
      fs.mkdir(path.join(destination, 'stores'), { recursive: true }),
    ])
    for (const directory of [source, destination]) {
      await fs.writeFile(path.join(directory, 'stores', 'inventory.json'), '{}')
      await fs.writeFile(path.join(directory, 'stores', 'project.json'), '{}')
    }
    for (const name of identityNames) await fs.writeFile(path.join(source, 'sharing', name), `source-${name}`)
    await execFileAsync('bash', [path.resolve('scripts/synchronize-business-data.sh'), source, destination, output])
    for (const name of identityNames) await expect(fs.access(path.join(output, 'sharing', name))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
