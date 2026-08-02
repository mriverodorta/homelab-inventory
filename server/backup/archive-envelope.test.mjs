import { describe, expect, it } from 'vitest'
import { createArchiveBuffer, inspectArchiveBuffer } from './archive-envelope.mjs'
import { sha256 } from './archive-security.mjs'

function fixture() {
  const body = Buffer.from('{"servers":[]}\n')
  return {
    files: [{ name: 'sections/inventory.json', body }],
    manifest: {
      formatVersion: 1,
      files: [{ path: 'sections/inventory.json', sizeBytes: body.length, sha256: sha256(body) }],
    },
  }
}

describe('portable backup archive envelope', () => {
  it.each(['archive', ['archive'], { length: 128 }, new Uint8Array([1, 2, 3])])(
    'rejects non-Buffer archive input %#',
    async (archive) => {
      await expect(inspectArchiveBuffer(archive)).rejects.toThrow('Backup archive size is invalid.')
    },
  )

  it('round trips an unencrypted archive and verifies checksums', async () => {
    const archive = await createArchiveBuffer(fixture())
    const inspected = await inspectArchiveBuffer(archive)
    expect(inspected.encrypted).toBe(false)
    expect(inspected.files.get('sections/inventory.json').toString()).toContain('servers')
  })

  it('round trips AES-GCM and rejects wrong passphrases and tampering', async () => {
    const archive = await createArchiveBuffer({ ...fixture(), passphrase: 'correct horse battery staple' })
    expect((await inspectArchiveBuffer(archive, { passphrase: 'correct horse battery staple' })).encrypted).toBe(true)
    await expect(inspectArchiveBuffer(archive, { passphrase: 'incorrect passphrase value' })).rejects.toThrow(/incorrect|damaged/)
    const damaged = Buffer.from(archive)
    damaged[damaged.length - 20] ^= 1
    await expect(inspectArchiveBuffer(damaged, { passphrase: 'correct horse battery staple' })).rejects.toThrow(/incorrect|damaged/)
  })
})
