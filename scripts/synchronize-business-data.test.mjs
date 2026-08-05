import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const directories = []

afterEach(async () => Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))))

async function environment(label, identity) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `hli-sync-${label}-`))
  directories.push(root)
  await fs.mkdir(path.join(root, 'stores'), { recursive: true })
  await fs.mkdir(path.join(root, 'registry'), { recursive: true })
  await fs.writeFile(path.join(root, 'stores', 'inventory.json'), JSON.stringify({ label }))
  await fs.writeFile(path.join(root, 'stores', 'project.json'), JSON.stringify({ revision: 1, label }))
  await fs.writeFile(path.join(root, 'stores', 'registry.json'), JSON.stringify({ settings: { label }, installationIdentity: identity }))
  await fs.writeFile(path.join(root, 'stores', 'routing-cache.json'), JSON.stringify({ label }))
  for (const [name, value] of Object.entries({
    'installation-instance.json': `${label}-instance`,
    'installation-ed25519.pem': `${label}-private-key`,
    'installation-credentials.json': `${label}-credentials`,
  })) await fs.writeFile(path.join(root, 'registry', name), value)
  return root
}

async function identityHashes(root) {
  const result = {}
  for (const name of ['installation-instance.json', 'installation-ed25519.pem', 'installation-credentials.json']) {
    result[name] = createHash('sha256').update(await fs.readFile(path.join(root, 'registry', name))).digest('hex')
  }
  return result
}

describe('private business-data synchronization', () => {
  for (const direction of ['production-to-local', 'local-to-production']) {
    it(`preserves destination registry identity for ${direction}`, async () => {
      const sourceIdentity = { state: 'active', clientInstanceId: 'source-instance' }
      const destinationIdentity = { state: 'active', clientInstanceId: 'destination-instance' }
      const source = await environment('source', sourceIdentity)
      const destination = await environment('destination', destinationIdentity)
      const output = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'hli-sync-output-')), 'data')
      directories.push(path.dirname(output))
      const sourceHashes = await identityHashes(source)
      const destinationHashes = await identityHashes(destination)

      await execFileAsync('bash', [
        path.resolve('scripts/synchronize-business-data.sh'),
        source,
        destination,
        output,
      ])

      expect(await identityHashes(output)).toEqual(destinationHashes)
      expect(await identityHashes(output)).not.toEqual(sourceHashes)
      expect(JSON.parse(await fs.readFile(path.join(output, 'stores', 'registry.json'), 'utf8')).installationIdentity)
        .toEqual(destinationIdentity)
      expect(JSON.parse(await fs.readFile(path.join(output, 'stores', 'inventory.json'), 'utf8')).label).toBe('source')
    })
  }
})
