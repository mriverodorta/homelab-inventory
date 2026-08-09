import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CATALOG_SCHEMA_VERSION,
  MOTHERBOARD_FINGERPRINT_VERSION,
  digestCatalogTemplate,
  type CatalogProductFamily,
  type CatalogTemplateItem,
  type CatalogVariantEvidence,
} from '../src'

interface MotherboardContractCase {
  caseId: string
  description: string
  sourceRecordKey: string
  fingerprintVersion: number
  productFamily: CatalogProductFamily
  variantEvidence: CatalogVariantEvidence
  identityHash: string
  contentHash: string
  item: CatalogTemplateItem
}

interface MotherboardContractFixture {
  schemaVersion: number
  protocol: { catalogSchemaVersion: number, fingerprintVersion: number }
  cases: MotherboardContractCase[]
}

const fixturePath = path.resolve(
  'packages/catalog-protocol/test/fixtures/motherboard/server-specs-inventory-motherboard-v7.json',
)
const privateKeys = new Set([
  'serialNumber', 'ipAddress', 'macAddress', 'hostname', 'room', 'rack', 'locationName',
  'assignments', 'placements', 'connections', 'agent', 'services', 'customLabel', 'notes',
])

async function fixture(): Promise<MotherboardContractFixture> {
  return JSON.parse(await fs.readFile(fixturePath, 'utf8')) as MotherboardContractFixture
}

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectKeys(entry, keys))
    return keys
  }
  if (!value || typeof value !== 'object') return keys
  for (const [key, entry] of Object.entries(value)) {
    keys.push(key)
    collectKeys(entry, keys)
  }
  return keys
}

function expectPositiveResourceIds(item: CatalogTemplateItem): void {
  const host = item.compatibility?.host as Record<string, unknown> | undefined
  const groups = [
    item.ports ?? [],
    ...['storageSlots', 'expansionSlots', 'powerConnectors']
      .map((key) => host?.[key])
      .filter(Array.isArray),
  ] as Array<Array<Record<string, unknown>>>
  for (const group of groups) {
    for (const resource of group) {
      expect(Number.isSafeInteger(resource.id)).toBe(true)
      expect(resource.id).toBeGreaterThan(0)
    }
  }
}

describe('motherboard v7 contract fixture', () => {
  it('pins protocol constants and deterministic projections', async () => {
    const contract = await fixture()
    expect(contract.schemaVersion).toBe(1)
    expect(contract.protocol).toEqual({
      catalogSchemaVersion: CATALOG_SCHEMA_VERSION,
      fingerprintVersion: MOTHERBOARD_FINGERPRINT_VERSION,
    })

    for (const testCase of contract.cases) {
      const projection = await digestCatalogTemplate(testCase.item, {
        fingerprintVersion: MOTHERBOARD_FINGERPRINT_VERSION,
      })
      expect(projection.item, testCase.caseId).toEqual(testCase.item)
      expect(projection.fingerprintVersion, testCase.caseId).toBe(testCase.fingerprintVersion)
      expect(projection.productFamily, testCase.caseId).toEqual(testCase.productFamily)
      expect(projection.variantEvidence, testCase.caseId).toEqual(testCase.variantEvidence)
      expect(projection.identityHash, testCase.caseId).toBe(testCase.identityHash)
      expect(projection.contentHash, testCase.caseId).toBe(testCase.contentHash)
    }
  })

  it('covers all manufacturers and material topology variants without identity collisions', async () => {
    const contract = await fixture()
    expect(new Set(contract.cases.map(({ item }) => item.manufacturer))).toEqual(
      new Set(['ASUS', 'ASRock', 'MSI', 'Gigabyte']),
    )
    expect(new Set(contract.cases.map(({ identityHash }) => identityHash)).size).toBe(contract.cases.length)
    expect(new Set(contract.cases.map(({ contentHash }) => contentHash)).size).toBe(contract.cases.length)

    const memoryGenerations = contract.cases.flatMap(({ item }) => {
      const host = item.compatibility?.host as Record<string, unknown> | undefined
      const memory = host?.memory as { generations?: string[] } | undefined
      return memory?.generations ?? []
    })
    expect(memoryGenerations).toContain('DDR4')
    expect(memoryGenerations).toContain('DDR5')
    expect(contract.cases.some(({ item }) => item.specs?.wifiGeneration)).toBe(true)
    expect(contract.cases.some(({ item }) => !item.specs?.wifiGeneration)).toBe(true)

    const revisionCases = contract.cases.filter(({ caseId }) => caseId.startsWith('gigabyte-revision-'))
    expect(revisionCases).toHaveLength(2)
    expect(revisionCases[0].identityHash).not.toBe(revisionCases[1].identityHash)
  })

  it('contains reusable catalog data and positive numeric resource IDs', async () => {
    const contract = await fixture()
    for (const { item } of contract.cases) {
      expect(collectKeys(item).filter((key) => privateKeys.has(key))).toEqual([])
      expectPositiveResourceIds(item)
    }
  })
})
