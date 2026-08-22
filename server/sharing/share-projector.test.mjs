import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SharingPublicIdService } from './public-id-service.mjs'
import { ShareProjector } from './share-projector.mjs'

const fixture = JSON.parse(await readFile(resolve('server/sharing/fixtures/private-project.json'), 'utf8'))
const expected = JSON.parse(await readFile(resolve('server/sharing/fixtures/expected-public-share.json'), 'utf8'))

function input({ metadata = true } = {}) {
  return {
    share: {
      title: 'Primary Homelab', description: 'Public diagram', visibility: 'public',
      mutability: 'replaceable', syncMode: 'manual', expirationType: 'indefinite',
      commentsEnabled: true, reactionsEnabled: false, embed: { enabled: false },
      fieldDefinitionIds: metadata ? [3] : [], tagIds: metadata ? [2] : [],
    },
    project: fixture.project,
    views: fixture.views,
    items: fixture.items,
    registryLinks: new Map(fixture.registryLinks.map((link) => [link.itemId, link])),
    metadataByItem: new Map(fixture.metadata.map((entry) => [entry.itemId, entry])),
  }
}

describe('privacy-safe share projector', () => {
  it('projects stable public IDs, exact Registry references, and selected metadata', async () => {
    const projector = new ShareProjector({ publicIds: new SharingPublicIdService({ key: Buffer.alloc(32, 7) }) })
    const first = await projector.project(input())
    const second = await projector.project(input())
    expect(second).toEqual(first)
    expect(first.manifest.views.map(({ contentHash }) => contentHash)).toEqual(first.blobs.map(({ contentHash }) => contentHash))
    expect(first.summary).toEqual(expected.summary)
    const systems = first.blobs[0].value
    expect(systems.items[0].source).toEqual({
      type: 'registry',
      registryReference: expected.registryReference,
      localOverrides: { usageRole: 'server' },
    })
    expect(systems.items[0].tags).toHaveLength(1)
    expect(systems.items[0].customFields).toHaveLength(1)
  })

  it('never includes private fields and excludes metadata by default', async () => {
    const projector = new ShareProjector({ publicIds: new SharingPublicIdService({ key: Buffer.alloc(32, 8) }) })
    const projected = await projector.project(input({ metadata: false }))
    const bytes = `${projected.manifestJson}${projected.blobs.map(({ contentJson }) => contentJson).join('')}`
    expect(bytes).not.toMatch(/PRIVATE|serial|agentCredentials|notes/iu)
    expect(bytes).not.toMatch(/customFields|"tags"/u)
    const custom = projected.blobs[1].value.items.find(({ source }) => source.type === 'custom')
    expect(custom.source.definition).toEqual(expected.customDefinition)
  })

  it('produces the exact canonical bytes used by persisted publication', async () => {
    const projector = new ShareProjector({ publicIds: new SharingPublicIdService({ key: Buffer.alloc(32, 9) }) })
    const projected = await projector.project(input())
    expect(Buffer.byteLength(projected.manifestJson)).toBeGreaterThan(0)
    expect(projected.blobs.every(({ contentJson, contentHash }) => contentJson.length > 0 && /^[a-f0-9]{64}$/u.test(contentHash))).toBe(true)
    expect(projected.byteLength).toBe(Buffer.byteLength(projected.manifestJson) + projected.blobs.reduce((total, blob) => total + Buffer.byteLength(blob.contentJson), 0))
  })
})
