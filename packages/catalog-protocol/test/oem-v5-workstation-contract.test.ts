import fs from 'node:fs/promises'
import path from 'node:path'
import {
  CATALOG_SCHEMA_VERSION,
  digestCatalogTemplate,
  MANUFACTURER_ALIAS_VERSION,
  projectCatalogItem,
  WORKSTATION_FINGERPRINT_VERSION,
  type CatalogProductFamily,
  type CatalogTemplateItem,
  type CatalogVariantEvidence,
} from '@homelab-inventory/catalog-protocol'
import { describe, expect, it } from 'vitest'

interface WorkstationCase {
  caseId: string
  description: string
  sourceRecordKey: string
  templateKey: string
  fingerprintVersion: number
  productFamily: CatalogProductFamily
  variantEvidence: CatalogVariantEvidence
  identityHash: string
  contentHash: string
  item: CatalogTemplateItem
}

interface WorkstationContractFixture {
  schemaVersion: number
  protocol: {
    catalogSchemaVersion: number
    fingerprintVersion: number
    manufacturerAliasVersion: number
    requiredApplicationOemContractVersion: number
  }
  platformCases: WorkstationCase[]
}

const fixturePath = path.resolve(
  'test/fixtures/catalog-import/oem/server-specs-inventory-workstation-v5.json',
)
const expectedCaseIds = [
  'dell-compact',
  'dell-sff',
  'dell-dual-socket-tower',
  'dell-rack',
  'hp-amd-tower',
  'hp-sff',
  'lenovo-compact-riser-two-slot',
  'lenovo-compact-riser-three-slot',
  'lenovo-dual-socket-tower',
  'lenovo-rack',
]
const privateKeys = new Set([
  'serialNumber', 'ipAddress', 'macAddress', 'hostname', 'room', 'rack',
  'assignments', 'placements', 'connections', 'agent', 'services', 'customLabel', 'notes',
  'localRole', 'installedComponents',
])

async function fixture(): Promise<WorkstationContractFixture> {
  return JSON.parse(await fs.readFile(fixturePath, 'utf8')) as WorkstationContractFixture
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

function expectPositiveIdsAndReferences(item: CatalogTemplateItem): void {
  const host = item.compatibility?.host as {
    storageSlots?: Array<{ id?: number }>
    expansionSlots?: Array<{ id?: number }>
    optionalModuleSlots?: Array<{ id?: number }>
    constraintGroups?: Array<{
      id?: number
      members?: Array<{ resourceType?: string, resourceId?: number }>
    }>
  } | undefined
  const resources = {
    'storage-slot': new Set(host?.storageSlots?.map(({ id }) => id) ?? []),
    'expansion-slot': new Set(host?.expansionSlots?.map(({ id }) => id) ?? []),
    'optional-module-slot': new Set(host?.optionalModuleSlots?.map(({ id }) => id) ?? []),
  }

  for (const collection of [item.ports ?? [], host?.storageSlots ?? [], host?.expansionSlots ?? [], host?.optionalModuleSlots ?? []]) {
    for (const resource of collection) {
      expect(Number.isSafeInteger(resource.id)).toBe(true)
      expect(resource.id).toBeGreaterThan(0)
    }
  }
  for (const group of host?.constraintGroups ?? []) {
    expect(Number.isSafeInteger(group.id)).toBe(true)
    expect(group.id).toBeGreaterThan(0)
    for (const member of group.members ?? []) {
      expect(Number.isSafeInteger(member.resourceId)).toBe(true)
      expect(member.resourceId).toBeGreaterThan(0)
      expect(resources[member.resourceType as keyof typeof resources]?.has(member.resourceId)).toBe(true)
    }
  }
}

describe('ServerSpecsInventory workstation OEM v5 contract', () => {
  it('pins protocol versions and the representative cross-vendor case set', async () => {
    const contract = await fixture()
    expect(contract.schemaVersion).toBe(1)
    expect(contract.protocol).toEqual({
      catalogSchemaVersion: CATALOG_SCHEMA_VERSION,
      fingerprintVersion: WORKSTATION_FINGERPRINT_VERSION,
      manufacturerAliasVersion: MANUFACTURER_ALIAS_VERSION,
      requiredApplicationOemContractVersion: 5,
    })
    expect(contract.platformCases.map(({ caseId }) => caseId)).toEqual(expectedCaseIds)
  })

  it('recomputes every topology-sensitive identity and content hash', async () => {
    const contract = await fixture()
    for (const testCase of contract.platformCases) {
      const projection = await digestCatalogTemplate(testCase.item, {
        fingerprintVersion: WORKSTATION_FINGERPRINT_VERSION,
      })
      expect(projection.item, testCase.caseId).toEqual(testCase.item)
      expect(projection.productFamily, testCase.caseId).toEqual(testCase.productFamily)
      expect(projection.variantEvidence, testCase.caseId).toEqual(testCase.variantEvidence)
      expect(projection.identityHash, testCase.caseId).toBe(testCase.identityHash)
      expect(projection.contentHash, testCase.caseId).toBe(testCase.contentHash)
    }
    expect(new Set(contract.platformCases.map(({ identityHash }) => identityHash)).size)
      .toBe(contract.platformCases.length)
  })

  it('projects a locally server-used workstation as workstation hardware without changing its catalog identity', async () => {
    const testCase = (await fixture()).platformCases[0]
    const projection = await projectCatalogItem({
      ...testCase.item,
      id: 991,
      type: 'server',
      hardwareClass: 'workstation',
      usageRole: 'server',
    }, { fingerprintVersion: WORKSTATION_FINGERPRINT_VERSION })

    expect(projection.status).toBe('eligible')
    if (projection.status !== 'eligible') return
    expect(projection.source).toEqual({ itemType: 'server', itemId: 991 })
    expect(projection.item).toEqual(testCase.item)
    expect(projection.identityHash).toBe(testCase.identityHash)
    expect(projection.contentHash).toBe(testCase.contentHash)
  })

  it('covers all fixed workstation forms and material topology classes', async () => {
    const cases = (await fixture()).platformCases
    expect(new Set(cases.map(({ item }) => item.specs?.formFactor))).toEqual(new Set([
      'Compact', 'SFF', 'Tower', 'Rack Workstation',
    ]))
    expect(cases.every(({ item, productFamily }) => (
      item.type === 'workstation' && productFamily.physicalClass === 'workstation'
    ))).toBe(true)
    expect(cases.some(({ item }) => (
      (item.compatibility?.host as { cpu?: { socketCount?: number } } | undefined)?.cpu?.socketCount === 2
    ))).toBe(true)
    expect(cases.some(({ item }) => (
      ((item.compatibility?.host as { cpu?: { sockets?: string[] } } | undefined)?.cpu?.sockets ?? [])
        .some((socket) => /SP3|sTR5|sWRX8/i.test(socket))
    ))).toBe(true)
    expect(cases.some(({ item }) => (
      ((item.compatibility?.host as { constraintGroups?: unknown[] } | undefined)?.constraintGroups?.length ?? 0) > 0
    ))).toBe(true)
  })

  it('contains only reusable catalog data with valid numeric relationships', async () => {
    for (const testCase of (await fixture()).platformCases) {
      expect(collectKeys(testCase.item).filter((key) => privateKeys.has(key)), testCase.caseId).toEqual([])
      expectPositiveIdsAndReferences(testCase.item)
    }
  })
})
