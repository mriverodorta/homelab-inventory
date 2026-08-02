import { describe, expect, it } from 'vitest'
import { assertSafeArchivePath, deriveArchiveKey } from './archive-security.mjs'

describe('backup archive security', () => {
  it('rejects traversal and absolute paths', () => {
    for (const value of ['../secret', '/data/secret', 'folder/../secret', 'folder\\secret']) {
      expect(() => assertSafeArchivePath(value)).toThrow(/unsafe path/)
    }
    expect(() => assertSafeArchivePath('sections/inventory.json')).not.toThrow()
  })

  it('requires a bounded passphrase', async () => {
    await expect(deriveArchiveKey('short', Buffer.alloc(16))).rejects.toThrow(/12/)
  })
})
