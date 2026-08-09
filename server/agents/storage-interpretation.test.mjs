import { describe, expect, it } from 'vitest'
import { buildStorageTelemetry } from './storage-interpretation.mjs'

describe('agent storage interpretation', () => {
  it('maps physical topology and current mounts to the assigned inventory item', () => {
    const result = buildStorageTelemetry({
      heartbeat: { metrics: { filesystems: [{
        mountPoint: '/', source: '/dev/nvme0n1p2', fsType: 'ext4', majorMinor: '259:2', root: '/',
        totalBytes: 1000, usedBytes: 250, availableBytes: 700,
      }] } },
      snapshot: {
        host: { type: 'server', id: 7 },
        components: [{ kind: 'storage', locator: '/dev/nvme0n1', values: {
          model: 'SPCC M.2 PCIe SSD', size: 1024209543168, tran: 'nvme', pttype: 'gpt',
          children: [{ name: 'nvme0n1p2', path: '/dev/nvme0n1p2', majMin: '259:2', type: 'part', fstype: 'ext4' }],
        } }],
      },
      inventory: { storage: [{ id: 9, name: '1TB NVMe' }] },
      project: { assignments: [{ id: 1, hostType: 'server', hostId: 7, itemType: 'storage', itemId: 9 }] },
    })
    expect(result.summary.usagePercent).toBe(25)
    expect(result.items).toEqual([expect.objectContaining({
      itemId: 9,
      device: expect.objectContaining({ partitionTable: 'gpt', transport: 'nvme' }),
      mounts: [expect.objectContaining({ mountPoint: '/' })],
    })])
  })
})
