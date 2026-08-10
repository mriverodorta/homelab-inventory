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
