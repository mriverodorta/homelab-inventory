import { describe, expect, it } from 'vitest'

import {
  parseShareManifest,
  parseShareViewBlob,
  type ShareManifest,
} from '../src'

const hash = 'a'.repeat(64)

export const validManifest: ShareManifest = {
  shareContractVersion: 1,
  projectPublicId: 'project_public_01',
  projectLabel: 'Primary Homelab',
  title: 'Primary Homelab',
  description: 'A sanitized public view.',
  visibility: { type: 'public' },
  publication: { type: 'replaceable', updateMode: 'manual' },
  expiration: { type: 'indefinite' },
  comments: { enabled: false },
  reactions: { enabled: false },
  embed: { enabled: false },
  resourceSnapshots: { included: false },
  rendererFeatures: ['workbook-tabs', 'deep-links', 'inspector'],
  initialViewPublicId: 'view_systems_001',
  views: [
    {
      publicViewId: 'view_systems_001',
      type: 'systems',
      schemaVersion: 1,
      contentHash: hash,
      sortOrder: 0,
      name: 'Systems',
    },
  ],
}

describe('share manifest schema', () => {
  it('rejects unknown signed fields', () => {
    expect(() => parseShareManifest({ ...validManifest, unknown: true })).toThrow()
  })

  it('rejects unsupported view schema versions', () => {
    const manifest = structuredClone(validManifest)
    manifest.views[0]!.schemaVersion = 2

    expect(() => parseShareManifest(manifest)).toThrow(/schema version/i)
  })

  it('rejects wildcard embedding for protected shares', () => {
    expect(() => parseShareManifest({
      ...validManifest,
      visibility: { type: 'protected' },
      embed: { enabled: true, origins: { type: 'any' } },
    })).toThrow(/protected/i)
  })

  it('rejects an initial view that is not declared', () => {
    expect(() => parseShareManifest({
      ...validManifest,
      initialViewPublicId: 'view_missing_001',
    })).toThrow(/initial view/i)
  })
})

describe('share view blob schema', () => {
  it('rejects forbidden nested private fields', () => {
    expect(() => parseShareViewBlob({
      shareContractVersion: 1,
      viewType: 'systems',
      schemaVersion: 1,
      publicViewId: 'view_systems_001',
      items: [{
        publicItemId: 'item_server_0001',
        type: 'server',
        name: 'Server',
        source: {
          type: 'custom',
          definition: { hardware: { serialNumber: 'private' } },
        },
        ports: [],
      }],
    })).toThrow(/serialNumber/)
  })
})
