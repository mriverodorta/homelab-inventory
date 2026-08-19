import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  M2_AE_FINGERPRINT_VERSION,
  digestCatalogTemplate,
  sha256Hex,
  type CatalogIdentityAlias,
  type CatalogProductFamily,
  type CatalogTemplateItem,
  type CatalogVariantEvidence,
  type JsonValue,
} from '../src'

interface ConformanceRecord {
  templateKey: string
  item: CatalogTemplateItem
  identityPayload: Record<string, JsonValue>
  productFamily: CatalogProductFamily | null
  variantEvidence: CatalogVariantEvidence | null
  identityHash: string
  contentHash: string
  identityAliases: CatalogIdentityAlias[]
}

interface ConformanceFixture {
  schemaVersion: number
  catalogContractVersion: number
  fingerprintVersion: number
  publishedCatalogRevision: number
  recordCount: number
  records: ConformanceRecord[]
}

const fixturePath = path.join(
  process.cwd(),
  'test/fixtures/catalog-import/m2-v12/revision-24-conformance.json',
)
const checksumPath = path.join(
  process.cwd(),
  'test/fixtures/catalog-import/m2-v12/revision-24-conformance.sha256',
)

async function fixtureBytes(): Promise<string> {
  return fs.readFile(fixturePath, 'utf8')
}

async function fixture(): Promise<ConformanceFixture> {
  return JSON.parse(await fixtureBytes()) as ConformanceFixture
}

describe('catalog contract v12 revision-24 conformance', () => {
  it('verifies the immutable fixture checksum before projection', async () => {
    const [bytes, checksum] = await Promise.all([
      fixtureBytes(),
      fs.readFile(checksumPath, 'utf8'),
    ])

    expect(await sha256Hex(bytes)).toBe(
      'bb8e589ab79d9205466961a82792a15107b179f878be0f42dfba763cdb337a80',
    )
    expect(checksum).toBe(
      'bb8e589ab79d9205466961a82792a15107b179f878be0f42dfba763cdb337a80  revision-24-conformance.json\n',
    )
  })

  it('reproduces all 44 canonical Registry projections exactly', async () => {
    const conformance = await fixture()
    expect(conformance).toMatchObject({
      schemaVersion: 1,
      catalogContractVersion: 12,
      fingerprintVersion: 12,
      publishedCatalogRevision: 24,
      recordCount: 44,
    })
    expect(conformance.records).toHaveLength(44)

    for (const record of conformance.records) {
      const projection = await digestCatalogTemplate(record.item, {
        fingerprintVersion: M2_AE_FINGERPRINT_VERSION,
      })

      expect(projection.item, record.templateKey).toEqual(record.item)
      expect(projection.identityPayload, record.templateKey).toEqual(record.identityPayload)
      expect(projection.productFamily ?? null, record.templateKey).toEqual(record.productFamily)
      expect(projection.variantEvidence ?? null, record.templateKey).toEqual(record.variantEvidence)
      expect(projection.identityHash, record.templateKey).toBe(record.identityHash)
      expect(projection.contentHash, record.templateKey).toBe(record.contentHash)
    }
  })

  it('retains every historical alias, including both Dell 7090 v2 identities', async () => {
    const records = (await fixture()).records
    const aliases = records.flatMap((record) => record.identityAliases.map((alias) => ({
      templateKey: record.templateKey,
      ...alias,
    })))

    expect(aliases).toHaveLength(records.reduce((total, record) => total + record.identityAliases.length, 0))
    expect(aliases.filter((alias) => alias.fingerprintVersion === 2)).toEqual([
      {
        templateKey: 'desktop-dell-optiplex-micro-7090-pcie-riser',
        fingerprintVersion: 2,
        identityHash: '0c01aec304fa3e53b2366fc7a3b3573b7cfa4747ad8e9da5d3c6393e14a01b46',
      },
      {
        templateKey: 'desktop-dell-optiplex-micro-7090-standard',
        fingerprintVersion: 2,
        identityHash: '0f8d09bfdfa534308a1e0ce4ec88471b82214d1f46111b993335acb4d6865104',
      },
    ])
  })

  it('keeps descriptive resource fields out of identity while retaining them in content', async () => {
    const record = (await fixture()).records.find(
      (entry) => entry.templateKey === 'desktop-dell-optiplex-micro-3000-standard',
    )
    expect(record).toBeDefined()
    const baseline = await digestCatalogTemplate(record!.item, {
      fingerprintVersion: M2_AE_FINGERPRINT_VERSION,
    })
    const changes: Array<(item: any) => void> = [
      (item) => { item.compatibility.host.optionalModuleSlots[0].label = 'M.2 Key E module socket' },
      (item) => { item.compatibility.host.optionalModuleSlots[0].keyAliases.push('legacy-wireless-slot') },
      (item) => { item.compatibility.host.optionalModuleSlots[0].intendedModuleKinds = ['wired-network-card'] },
    ]

    for (const change of changes) {
      const item = structuredClone(record!.item) as any
      change(item)
      const projection = await digestCatalogTemplate(item, {
        fingerprintVersion: M2_AE_FINGERPRINT_VERSION,
      })
      expect(projection.identityHash).toBe(baseline.identityHash)
      expect(projection.contentHash).not.toBe(baseline.contentHash)
    }
  })

  it('keeps absent, explicit-empty, and populated bus evidence hash-distinct', async () => {
    const record = (await fixture()).records.find(
      (entry) => entry.templateKey === 'desktop-dell-optiplex-micro-3000-standard',
    )
    expect(record).toBeDefined()
    const variants = [
      undefined,
      [],
      [{ family: 'pcie', lanes: 1, pcieGeneration: 3 }],
    ] as const
    const projections = []

    for (const availableBuses of variants) {
      const item = structuredClone(record!.item) as any
      const resource = item.compatibility.host.optionalModuleSlots[0]
      if (availableBuses === undefined) delete resource.availableBuses
      else resource.availableBuses = availableBuses
      projections.push(await digestCatalogTemplate(item, {
        fingerprintVersion: M2_AE_FINGERPRINT_VERSION,
      }))
    }

    expect(new Set(projections.map((projection) => projection.identityHash)).size).toBe(3)
    expect(new Set(projections.map((projection) => projection.contentHash)).size).toBe(3)
    expect(projections[0]!.item.compatibility?.host?.optionalModuleSlots?.[0]).not.toHaveProperty('availableBuses')
    expect(projections[1]!.item.compatibility?.host?.optionalModuleSlots?.[0]).toMatchObject({ availableBuses: [] })
  })
})
