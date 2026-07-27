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
})
