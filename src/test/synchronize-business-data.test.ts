import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(
    (directory) => rm(directory, { force: true, recursive: true }),
  ))
})

describe('business data synchronization', () => {
  it('preserves the destination routing cache instead of copying source geometry', async () => {
    const root = await temporaryDirectory()
    const source = resolve(root, 'source')
    const destination = resolve(root, 'destination')
    const output = resolve(root, 'output')
    await writeStores(source, 'source')
    await writeStores(destination, 'destination')

    await execFileAsync('bash', [
      resolve(process.cwd(), 'scripts/synchronize-business-data.sh'),
      source,
      destination,
      output,
    ])

    await expect(readStore(output, 'inventory.json')).resolves.toEqual({ owner: 'source' })
    await expect(readStore(output, 'project.json')).resolves.toEqual({ owner: 'source' })
    await expect(readStore(output, 'routing-cache.json')).resolves.toEqual({ owner: 'destination' })
  })

  it('does not create a routing cache when the destination has none', async () => {
    const root = await temporaryDirectory()
    const source = resolve(root, 'source')
    const destination = resolve(root, 'destination')
    const output = resolve(root, 'output')
    await writeStores(source, 'source')
    await writeStores(destination, 'destination', false)

    await execFileAsync('bash', [
      resolve(process.cwd(), 'scripts/synchronize-business-data.sh'),
      source,
      destination,
      output,
    ])

    await expect(readFile(resolve(output, 'stores/routing-cache.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
})

async function temporaryDirectory() {
  const directory = await mkdtemp(resolve(tmpdir(), 'homelab-sync-'))
  temporaryDirectories.push(directory)
  return directory
}

async function writeStores(directory: string, owner: string, includeCache = true) {
  const stores = resolve(directory, 'stores')
  await mkdir(stores, { recursive: true })
  await Promise.all([
    writeFile(resolve(stores, 'inventory.json'), JSON.stringify({ owner })),
    writeFile(resolve(stores, 'project.json'), JSON.stringify({ owner })),
    ...(includeCache
      ? [writeFile(resolve(stores, 'routing-cache.json'), JSON.stringify({ owner }))]
      : []),
  ])
}

async function readStore(directory: string, name: string) {
  return JSON.parse(await readFile(resolve(directory, 'stores', name), 'utf8')) as unknown
}
