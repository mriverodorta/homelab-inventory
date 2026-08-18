import { describe, expect, it } from 'vitest'
import { catalogFieldDiff, mergeCatalogUpdate } from './update-service.mjs'

describe('catalog update service', () => {
  it('diffs catalog fields while preserving local-only fields', () => {
    const current = {
      type: 'server',
      name: 'Example Server',
      model: 'M1',
      specs: { formFactor: 'Mini' },
      properties: { customName: 'Lab node', lanIp: '192.168.1.10' },
      notes: 'Keep this private',
    }
    const next = { type: 'server', name: 'Example Server', model: 'M2', specs: { formFactor: 'Mini' } }
    expect(catalogFieldDiff(current, next)).toEqual([{ field: 'model', current: 'M1', next: 'M2' }])
    expect(mergeCatalogUpdate(current, next)).toMatchObject({
      model: 'M2',
      properties: current.properties,
      notes: current.notes,
    })
  })

  it('includes physical type changes in the catalog diff', () => {
    expect(catalogFieldDiff(
      { type: 'server', name: 'Example host' },
      { type: 'desktop', name: 'Example host' },
    )).toEqual([{ field: 'type', current: 'server', next: 'desktop' }])
  })

  it('preserves an empty WLAN resource reclassification without a false removal or addition', () => {
    const current = {
      type: 'desktop',
      name: 'Example desktop',
      compatibility: {
        host: {
          expansionSlots: [{ id: 1, key: 'm2-ae-slot', count: 1, label: 'M.2 2230 A/E network slot' }],
        },
      },
    }
    const next = {
      type: 'desktop',
      name: 'Example desktop',
      compatibility: {
        host: {
          optionalModuleSlots: [{
            id: 1,
            key: 'wlan-m2',
            count: 1,
            label: 'M.2 2230 WLAN slot',
            acceptedModuleKinds: ['wireless-card'],
          }],
        },
      },
    }

    expect(catalogFieldDiff(current, next, { sourceFingerprintVersion: 4, runtimeCanonicalVersion: 9 })).toEqual([{
      path: 'compatibility.host.resources',
      kind: 'reclassify-resource',
      impact: 'topology',
      operation: 'reclassify-resource',
      from: expect.objectContaining({ resourceType: 'expansion', resourceId: 1, key: 'm2-ae-slot' }),
      to: expect.objectContaining({ resourceType: 'optionalModule', resourceId: 1, key: 'wlan-m2' }),
    }])
  })

  it('preserves structured RAM requirements during catalog updates', () => {
    const current = {
      type: 'ram', name: 'Micron RAM', manufacturer: 'Micron', number: 'MTA18ASF2G72AZ-3G2R',
      specs: { capacityGb: 16, generation: 'DDR4', speedMt: 2933, formFactor: 'DIMM', moduleType: 'RDIMM', ecc: true },
      compatibility: { requirements: { memory: {
        capacityGb: 16, generation: 'DDR4', speedMt: 2933, formFactor: 'DIMM', moduleType: 'RDIMM', ecc: true,
      } } },
    }
    expect(() => mergeCatalogUpdate(current, {
      ...current,
      compatibility: { requirements: { memory: {
        capacityGb: 16, generation: 'DDR4', speedMt: 2933, formFactor: 'DIMM', moduleType: 'RDIMM',
      } } },
    })).toThrow('cannot remove memory requirement ecc')
    expect(() => mergeCatalogUpdate(current, {
      ...current,
      compatibility: { requirements: { memory: {
        capacityGb: 16, generation: 'DDR4', speedMt: 3200, formFactor: 'DIMM', moduleType: 'RDIMM', ecc: true,
      } } },
    })).toThrow('memory requirement speedMt contradicts its specification')
  })
})
