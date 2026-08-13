import { describe, expect, test } from 'bun:test'
import { ORAS_VERSION, orasDistribution } from './tools.mjs'

describe('pinned ORAS tool', () => {
  test('pins the Apple Silicon release archive and upstream checksum', () => {
    expect(orasDistribution('darwin', 'arm64')).toEqual({
      archive: `oras_${ORAS_VERSION}_darwin_arm64.tar.gz`,
      sha256: 'f33fc12753c54172b0d0d19eaa0318d3f90fe9b094d96e8b259c881713c92e1c',
      url: `https://github.com/oras-project/oras/releases/download/v${ORAS_VERSION}/oras_${ORAS_VERSION}_darwin_arm64.tar.gz`,
    })
  })

  test('rejects unsupported host combinations instead of downloading an unpinned binary', () => {
    expect(() => orasDistribution('win32', 'x64')).toThrow('is not pinned')
  })
})
