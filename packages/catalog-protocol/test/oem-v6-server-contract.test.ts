import fs from 'node:fs/promises'
import path from 'node:path'
import {
  CATALOG_SCHEMA_VERSION,
  digestCatalogTemplate,
  MANUFACTURER_ALIAS_VERSION,
  SERVER_FINGERPRINT_VERSION,
  type CatalogProductFamily,
  type CatalogTemplateItem,
  type CatalogVariantEvidence,
} from '@homelab-inventory/catalog-protocol'
import { describe, expect, it } from 'vitest'

interface ServerCase {
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

interface ServerContractFixture {
  schemaVersion: number
  protocol: {
    catalogSchemaVersion: number
    fingerprintVersion: number
    manufacturerAliasVersion: number
    requiredApplicationOemContractVersion: number
  }
  platformCases: ServerCase[]
}

const fixturePath = path.resolve(
  'test/fixtures/catalog-import/oem/server-specs-inventory-server-v6.json',
)
const privateKeys = new Set([
  'serialNumber', 'ipAddress', 'macAddress', 'hostname', 'room', 'rack',
  'assignments', 'placements', 'connections', 'agent', 'services', 'customLabel', 'notes',
  'localRole', 'installedComponents',
])

async function fixture(): Promise<ServerContractFixture> {
  return JSON.parse(await fs.readFile(fixturePath, 'utf8')) as ServerContractFixture
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
    cpu?: { socketCount?: number }
    storageSlots?: Array<{ id?: number, controllerSlotIds?: number[] }>
    expansionSlots?: Array<{ id?: number, requiredCpuSockets?: number }>
    optionalModuleSlots?: Array<{ id?: number }>
    controllerSlots?: Array<{ id?: number, requiredCpuSockets?: number }>
    bootDeviceSlots?: Array<{ id?: number, controllerSlotId?: number, requiredCpuSockets?: number }>
    coolingProfiles?: Array<{ id?: number }>
    constraintGroups?: Array<{
      id?: number
      members?: Array<{ resourceType?: string, resourceId?: number }>
    }>
  } | undefined
  const resources = {
    'storage-slot': new Set(host?.storageSlots?.map(({ id }) => id) ?? []),
    'expansion-slot': new Set(host?.expansionSlots?.map(({ id }) => id) ?? []),
    'optional-module-slot': new Set(host?.optionalModuleSlots?.map(({ id }) => id) ?? []),
    'controller-slot': new Set(host?.controllerSlots?.map(({ id }) => id) ?? []),
    'boot-device-slot': new Set(host?.bootDeviceSlots?.map(({ id }) => id) ?? []),
    'cooling-profile': new Set(host?.coolingProfiles?.map(({ id }) => id) ?? []),
  }
  const collections = [
    item.ports ?? [], host?.storageSlots ?? [], host?.expansionSlots ?? [],
    host?.optionalModuleSlots ?? [], host?.controllerSlots ?? [],
    host?.bootDeviceSlots ?? [], host?.coolingProfiles ?? [],
  ]
  for (const collection of collections) {
    for (const resource of collection) {
      expect(Number.isSafeInteger(resource.id)).toBe(true)
      expect(resource.id).toBeGreaterThan(0)
    }
  }

  const controllerIds = resources['controller-slot']
  for (const slot of host?.storageSlots ?? []) {
    for (const controllerId of slot.controllerSlotIds ?? []) expect(controllerIds.has(controllerId)).toBe(true)
  }
  for (const slot of host?.bootDeviceSlots ?? []) {
    if (slot.controllerSlotId !== undefined) expect(controllerIds.has(slot.controllerSlotId)).toBe(true)
  }
  const cpuDependent = [
    ...(host?.expansionSlots ?? []), ...(host?.controllerSlots ?? []), ...(host?.bootDeviceSlots ?? []),
  ]
  for (const resource of cpuDependent) {
    if (resource.requiredCpuSockets !== undefined) {
      expect(resource.requiredCpuSockets).toBeGreaterThan(0)
      expect(resource.requiredCpuSockets).toBeLessThanOrEqual(host?.cpu?.socketCount ?? 0)
    }
  }
  for (const group of host?.constraintGroups ?? []) {
    expect(Number.isSafeInteger(group.id)).toBe(true)
    expect(group.id).toBeGreaterThan(0)
    for (const member of group.members ?? []) {
      expect(resources[member.resourceType as keyof typeof resources]?.has(member.resourceId)).toBe(true)
    }
  }
}

describe('ServerSpecsInventory conventional server OEM v6 contract', () => {
  it('pins protocol versions and the complete representative cross-vendor case set', async () => {
    const contract = await fixture()
    expect(contract.schemaVersion).toBe(1)
    expect(contract.protocol).toEqual({
      catalogSchemaVersion: CATALOG_SCHEMA_VERSION,
      fingerprintVersion: SERVER_FINGERPRINT_VERSION,
      manufacturerAliasVersion: MANUFACTURER_ALIAS_VERSION,
      requiredApplicationOemContractVersion: 6,
    })
    expect(contract.platformCases).toHaveLength(15)
    expect(new Set(contract.platformCases.map(({ item }) => item.manufacturer))).toEqual(
      new Set(['Dell', 'HP', 'Lenovo']),
    )
    expect(new Set(contract.platformCases.map(({ item }) => item.family))).toEqual(
      new Set(['PowerEdge', 'ProLiant', 'ThinkSystem']),
    )
    expect(contract.platformCases.every(({ templateKey, item }) => (
      typeof item.manufacturer === 'string'
      && typeof item.family === 'string'
      && templateKey.startsWith(`server-${item.manufacturer.toLowerCase()}-${item.family.toLowerCase()}-`)
    ))).toBe(true)
  })

  it('recomputes every topology-sensitive identity and content hash', async () => {
    const contract = await fixture()
    for (const testCase of contract.platformCases) {
      const projection = await digestCatalogTemplate(testCase.item, {
        fingerprintVersion: SERVER_FINGERPRINT_VERSION,
      })
      expect(projection.item, testCase.caseId).toEqual(testCase.item)
      expect(projection.productFamily, testCase.caseId).toEqual(testCase.productFamily)
      expect(projection.variantEvidence, testCase.caseId).toEqual(testCase.variantEvidence)
      expect(projection.identityHash, testCase.caseId).toBe(testCase.identityHash)
      expect(projection.contentHash, testCase.caseId).toBe(testCase.contentHash)
    }
    expect(new Set(contract.platformCases.map(({ identityHash }) => identityHash)).size)
      .toBe(contract.platformCases.length)
    expect(new Set(contract.platformCases.map(({ contentHash }) => contentHash)).size)
      .toBe(contract.platformCases.length)
  })

  it('covers conventional server forms and material topology variants', async () => {
    const cases = (await fixture()).platformCases
    expect(new Set(cases.map(({ item }) => item.specs?.formFactor))).toEqual(
      new Set(['MicroServer', 'Tower Server', 'Rack Server']),
    )
    expect(new Set(cases.filter(({ item }) => item.specs?.formFactor === 'Rack Server')
      .map(({ item }) => item.specs?.rackUnits))).toEqual(new Set([1, 2]))
    expect(cases.every(({ item, productFamily }) => (
      item.type === 'server' && productFamily.physicalClass === 'server'
    ))).toBe(true)

    for (const model of ['R740', 'DL380 Gen10', 'SR650']) {
      const variants = cases.filter(({ item }) => item.model === model)
      expect(variants, model).toHaveLength(2)
      expect(new Set(variants.map(({ identityHash }) => identityHash)).size, model).toBe(2)
    }
  })

  it('preserves complete server topology without private instance data', async () => {
    for (const testCase of (await fixture()).platformCases) {
      const host = testCase.item.compatibility?.host as {
        cpu?: { socketCount?: number, populationModes?: number[] }
        memory?: { slots?: number, slotsPerCpu?: number, moduleTypes?: string[] }
        controllerSlots?: unknown[]
        bootDeviceSlots?: unknown[]
        coolingProfiles?: unknown[]
        management?: unknown
        power?: { psuBayCount?: number, psuType?: string, redundancyModes?: string[] }
      } | undefined
      expect(host?.cpu?.populationModes?.length, testCase.caseId).toBeGreaterThan(0)
      expect(host?.memory?.slots, testCase.caseId)
        .toBe((host?.memory?.slotsPerCpu ?? 0) * (host?.cpu?.socketCount ?? 0))
      expect(host?.memory?.moduleTypes?.length, testCase.caseId).toBeGreaterThan(0)
      expect(host?.controllerSlots, testCase.caseId).toBeInstanceOf(Array)
      expect(host?.bootDeviceSlots, testCase.caseId).toBeInstanceOf(Array)
      expect(host?.coolingProfiles?.length, testCase.caseId).toBeGreaterThan(0)
      expect(host?.management, testCase.caseId).toBeTruthy()
      expect(host?.power?.psuBayCount, testCase.caseId).toBeGreaterThan(0)
      expect(host?.power?.psuType, testCase.caseId).toMatch(/fixed|cabled|hot-plug/)
      expect(host?.power?.redundancyModes?.length, testCase.caseId).toBeGreaterThan(0)
      expect(collectKeys(testCase.item).filter((key) => privateKeys.has(key)), testCase.caseId).toEqual([])
      expectPositiveIdsAndReferences(testCase.item)
    }
  })
})
