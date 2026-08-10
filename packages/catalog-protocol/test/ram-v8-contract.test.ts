import fs from 'node:fs/promises'
import path from 'node:path'
import {
  RAM_FINGERPRINT_VERSION,
  digestCatalogTemplate,
  projectCatalogItem,
  validateCatalogSnapshot,
  type CatalogSnapshot,
} from '../src/index'
import { describe, expect, it } from 'vitest'

interface RamAppContractFixture {
  schemaVersion: number
  requiredApplicationCatalogContractVersion: number
  fingerprintVersion: number
  templateKey: string
  identityHash: string
  contentHash: string
  item: CatalogSnapshot['templates'][number]['item']
}

async function loadFixture(): Promise<RamAppContractFixture> {
  return JSON.parse(await fs.readFile(path.join(
    import.meta.dirname,
    'fixtures/ram/server-specs-inventory-ram-v8.json',
  ), 'utf8')) as RamAppContractFixture
}

describe('Homelab Inventory RAM contract v8', () => {
  it('preserves the frozen definition and exact hashes through snapshot validation', async () => {
    const fixture = await loadFixture()
    expect(fixture.requiredApplicationCatalogContractVersion).toBe(8)
    expect(fixture.fingerprintVersion).toBe(RAM_FINGERPRINT_VERSION)

    const projection = await digestCatalogTemplate(fixture.item, {
      fingerprintVersion: RAM_FINGERPRINT_VERSION,
    })
    expect(projection).toMatchObject({
      status: 'eligible',
      identityHash: '82671223adf59660898f7b72eca2545bf594f0e12a6aca796043791dc0b6e947',
      contentHash: '5ccbe806d1d1ff63106dd1123079cc026a64661e06961ddbf888b3d7f631d7d3',
      item: fixture.item,
    })

    const snapshot = await validateCatalogSnapshot({
      schemaVersion: 1,
      catalogRevision: 1,
      generatedAt: '2026-08-09T22:50:00.000Z',
      manufacturerAliases: {},
      templates: [{
        templateKey: fixture.templateKey,
        revision: 1,
        fingerprintVersion: fixture.fingerprintVersion,
        identityHash: fixture.identityHash,
        contentHash: fixture.contentHash,
        item: fixture.item,
      }],
    }, { now: new Date('2026-08-10T00:00:00.000Z') })

    expect(snapshot.templates).toEqual([expect.objectContaining({
      templateKey: fixture.templateKey,
      fingerprintVersion: RAM_FINGERPRINT_VERSION,
      identityHash: fixture.identityHash,
      contentHash: fixture.contentHash,
      item: fixture.item,
    })])
  })

  it.each(['LP-DIMM', 'Onboard'])('keeps %s memory out of registry projection', async (formFactor) => {
    const projection = await projectCatalogItem({
      id: 1,
      type: 'ram',
      name: 'Local memory',
      manufacturer: 'Example',
      number: 'EXACT-PART',
      specs: { formFactor },
    }, { fingerprintVersion: RAM_FINGERPRINT_VERSION })

    expect(projection).toMatchObject({ status: 'ineligible', reason: 'insufficient-identity' })
  })
})
