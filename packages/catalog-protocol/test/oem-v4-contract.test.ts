import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertCatalogProtocolContract,
  CATALOG_SCHEMA_VERSION,
  digestCatalogTemplate,
  MANUFACTURER_ALIAS_VERSION,
  OEM_FINGERPRINT_VERSION,
  type CatalogProductFamily,
  type CatalogTemplateItem,
  type CatalogVariantEvidence,
} from '../src'

type ProjectionExpectation = {
  fingerprintVersion: number
  productFamily: CatalogProductFamily
  variantEvidence: CatalogVariantEvidence
  identityHash: string
  contentHash: string
}

type CatalogCandidate = ProjectionExpectation & { templateKey: string }

type PlatformCase = ProjectionExpectation & {
  caseId: string
  item: CatalogTemplateItem
}

type LinkingCase = {
  caseId: string
  localItem: CatalogTemplateItem
  localProjection: ProjectionExpectation
  catalogCandidates: CatalogCandidate[]
  expected: {
    outcome: 'auto-link' | 'detached'
    templateKey: string | null
  }
}

type ContractFixture = {
  schemaVersion: number
  protocol: {
    catalogSchemaVersion: number
    fingerprintVersion: number
    manufacturerAliasVersion: number
  }
  platformCases: PlatformCase[]
  linkingCases: LinkingCase[]
}

const fixturePath = path.resolve('test/fixtures/catalog-import/oem/server-specs-inventory-contract.json')
const allowedItemKeys = new Set([
  'type', 'name', 'subtype', 'manufacturer', 'secondaryManufacturer', 'family', 'model',
  'number', 'specs', 'ports', 'compatibility',
])
const privateRelationshipKeys = new Set([
  'serialNumber', 'ipAddress', 'macAddress', 'hostname', 'room', 'rack', 'location',
  'assignments', 'placements', 'connections', 'agent', 'services', 'customLabel', 'notes',
])

async function loadFixture(): Promise<ContractFixture> {
  return JSON.parse(await fs.readFile(fixturePath, 'utf8')) as ContractFixture
}

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, keys)
    return keys
  }
  if (!value || typeof value !== 'object') return keys
  for (const [key, entry] of Object.entries(value)) {
    keys.push(key)
    collectKeys(entry, keys)
  }
  return keys
}

function expectPositiveRelationshipIds(item: CatalogTemplateItem): void {
  const host = item.compatibility?.host as Record<string, unknown> | undefined
  const groups = [
    item.ports ?? [],
    ...['storageSlots', 'expansionSlots', 'optionalModuleSlots', 'fixedPorts']
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

function sameFamily(left: CatalogProductFamily, right: CatalogProductFamily): boolean {
  return left.manufacturer === right.manufacturer
    && left.model === right.model
    && left.physicalClass === right.physicalClass
}

function resolveContractLink(testCase: LinkingCase): { outcome: 'auto-link' | 'detached', templateKey: string | null } {
  const exact = testCase.catalogCandidates.filter((candidate) => (
    candidate.fingerprintVersion === testCase.localProjection.fingerprintVersion
    && candidate.identityHash === testCase.localProjection.identityHash
  ))
  if (exact.length === 1) return { outcome: 'auto-link', templateKey: exact[0].templateKey }

  const familyCandidates = testCase.catalogCandidates.filter((candidate) => (
    sameFamily(candidate.productFamily, testCase.localProjection.productFamily)
  ))
  const evidence = testCase.localProjection.variantEvidence
  if ((evidence.source === 'generic' || evidence.completeness !== 'complete') && familyCandidates.length > 1) {
    return { outcome: 'detached', templateKey: null }
  }

  const topologyMatches = familyCandidates.filter((candidate) => (
    evidence.completeness === 'complete'
    && evidence.topologySignature !== undefined
    && candidate.variantEvidence.topologySignature === evidence.topologySignature
  ))
  if (topologyMatches.length === 1) return { outcome: 'auto-link', templateKey: topologyMatches[0].templateKey }
  return { outcome: 'detached', templateKey: null }
}

describe('OEM catalog fingerprint v4 contract', () => {
  it('pins the protocol constants and immutable protocol vectors', async () => {
    const fixture = await loadFixture()
    expect(fixture.schemaVersion).toBe(1)
    expect(fixture.protocol).toEqual({
      catalogSchemaVersion: CATALOG_SCHEMA_VERSION,
      fingerprintVersion: OEM_FINGERPRINT_VERSION,
      manufacturerAliasVersion: MANUFACTURER_ALIAS_VERSION,
    })
    await expect(assertCatalogProtocolContract()).resolves.toBeUndefined()
  })

  it('recomputes every representative OEM platform without dropping fields', async () => {
    const fixture = await loadFixture()
    expect(fixture.platformCases).toHaveLength(6)

    for (const testCase of fixture.platformCases) {
      const projection = await digestCatalogTemplate(testCase.item, {
        fingerprintVersion: OEM_FINGERPRINT_VERSION,
      })
      expect(projection.item, testCase.caseId).toEqual(testCase.item)
      expect(projection.fingerprintVersion, testCase.caseId).toBe(testCase.fingerprintVersion)
      expect(projection.productFamily, testCase.caseId).toEqual(testCase.productFamily)
      expect(projection.variantEvidence, testCase.caseId).toEqual(testCase.variantEvidence)
      expect(projection.identityHash, testCase.caseId).toBe(testCase.identityHash)
      expect(projection.contentHash, testCase.caseId).toBe(testCase.contentHash)
    }
  })

  it('contains only reusable fields and positive relational resource IDs', async () => {
    const fixture = await loadFixture()
    const items = [
      ...fixture.platformCases.map(({ item }) => item),
      ...fixture.linkingCases.map(({ localItem }) => localItem),
    ]

    for (const item of items) {
      expect(Object.keys(item).filter((key) => !allowedItemKeys.has(key))).toEqual([])
      expect(collectKeys(item).filter((key) => privateRelationshipKeys.has(key))).toEqual([])
      expectPositiveRelationshipIds(item)
    }
  })

  it('keeps ambiguous families detached and only auto-links authoritative evidence', async () => {
    const fixture = await loadFixture()
    expect(fixture.linkingCases.map(({ caseId }) => caseId)).toEqual([
      'ambiguous-local-family-detached',
      'exact-board-auto-link',
      'complete-topology-auto-link',
    ])

    for (const testCase of fixture.linkingCases) {
      const projection = await digestCatalogTemplate(testCase.localItem, {
        fingerprintVersion: OEM_FINGERPRINT_VERSION,
      })
      expect(projection.productFamily, testCase.caseId).toEqual(testCase.localProjection.productFamily)
      expect(projection.variantEvidence, testCase.caseId).toEqual(testCase.localProjection.variantEvidence)
      expect(projection.identityHash, testCase.caseId).toBe(testCase.localProjection.identityHash)
      expect(projection.contentHash, testCase.caseId).toBe(testCase.localProjection.contentHash)
      expect(resolveContractLink(testCase), testCase.caseId).toEqual({
        outcome: testCase.expected.outcome,
        templateKey: testCase.expected.templateKey,
      })
    }
  })
})
