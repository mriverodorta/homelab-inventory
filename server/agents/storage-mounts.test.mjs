import { describe, expect, it } from 'vitest'
import { isEligibleLocalMount, summarizeLocalStorage } from './storage-mounts.mjs'

const mount = (overrides = {}) => ({
  mountPoint: '/', source: '/dev/sda2', fsType: 'ext4', majorMinor: '8:2', root: '/',
  totalBytes: 1000, usedBytes: 400, availableBytes: 550, ...overrides,
})

describe('agent local storage aggregation', () => {
  it('excludes remote, pseudo, loop, and container filesystems', () => {
    expect(isEligibleLocalMount(mount())).toBe(true)
    expect(isEligibleLocalMount(mount({ fsType: 'overlay', source: 'overlay' }))).toBe(false)
    expect(isEligibleLocalMount(mount({ fsType: 'nfs4', source: 'nas:/data' }))).toBe(false)
    expect(isEligibleLocalMount(mount({ source: '/dev/loop0', fsType: 'squashfs' }))).toBe(false)
    expect(isEligibleLocalMount(mount({ mountPoint: '/var/lib/docker/overlay2/abc', source: '/dev/sda2' }))).toBe(false)
  })

  it('deduplicates bind mounts and counts btrfs storage only once', () => {
    const summary = summarizeLocalStorage([
      mount(),
      mount({ mountPoint: '/srv/root-bind' }),
      mount({ source: '/dev/nvme0n1p2', majorMinor: '259:2', fsType: 'btrfs', mountPoint: '/data', totalBytes: 2000, usedBytes: 1000 }),
      mount({ source: '/dev/nvme0n1p2', majorMinor: '259:2', fsType: 'btrfs', mountPoint: '/var/lib/data', root: '/@data', totalBytes: 2000, usedBytes: 1000 }),
    ])
    expect(summary.mounts.map(({ mountPoint }) => mountPoint)).toEqual(['/', '/data', '/var/lib/data'])
    expect(summary.totalBytes).toBe(3000)
    expect(summary.usedBytes).toBe(1400)
  })
})
