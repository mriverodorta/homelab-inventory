import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseShareManifest, parseShareViewBlob, shareContentHash } from '../src'

const packageFixtures = resolve(process.cwd(), 'packages/share-contract/test/fixtures')
const handoffRoot = resolve(process.cwd(), 'docs/handoffs/lab-gd-contract-v1')
const handoffFixtures = resolve(handoffRoot, 'fixtures')

const readJson = async (base: string, name: string): Promise<unknown> => JSON.parse(
  await readFile(resolve(base, name), 'utf8'),
)

describe('frozen share contract fixtures', () => {
  it('parses and matches every manifest content hash', async () => {
    const manifest = parseShareManifest(await readJson(packageFixtures, 'manifest-v1.json'))

    for (const descriptor of manifest.views) {
      const blob = parseShareViewBlob(await readJson(packageFixtures, `${descriptor.type}-v1.json`))
      expect(blob.publicViewId).toBe(descriptor.publicViewId)
      expect(await shareContentHash(blob)).toBe(descriptor.contentHash)
    }
  })

  it('copies the handoff fixtures byte-for-byte', async () => {
    for (const name of ['manifest-v1.json', 'systems-v1.json', 'canvas-v1.json']) {
      const packageBytes = await readFile(resolve(packageFixtures, name))
      const handoffBytes = await readFile(resolve(handoffFixtures, name))
      expect(handoffBytes.equals(packageBytes), resolve(handoffFixtures, name)).toBe(true)
    }
  })

  it('verifies the sorted handoff SHA-256 sidecar', async () => {
    const lines = (await readFile(resolve(handoffRoot, 'SHA256SUMS'), 'utf8')).trim().split('\n')
    const paths = lines.map((line) => line.slice(66))
    expect(paths).toEqual([...paths].sort())

    for (const line of lines) {
      const [expected, relativePath] = line.split('  ')
      const bytes = await readFile(resolve(handoffRoot, relativePath!))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(expected)
    }
  })
})
