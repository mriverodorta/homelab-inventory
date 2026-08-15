import { describe, expect, it } from 'vitest'
import { classifyCatalogUpdate } from './catalog-update-policy.mjs'

describe('catalog update safety policy', () => {
  it('accepts a verified metadata repair that introduces no compatibility findings', () => {
    expect(classifyCatalogUpdate({
      changes: [{ field: 'compatibility' }],
      beforeFindings: [],
      afterFindings: [],
    })).toEqual({ classification: 'safe', reasons: ['verified-compatible'], introducedFindings: [] })
  })

  it('requires review for identity and compatibility changes', () => {
    const result = classifyCatalogUpdate({
      changes: [{ field: 'model' }],
      beforeFindings: [],
      afterFindings: [{ assignmentId: 1, findings: [{ code: 'cpu.socket.mismatch', severity: 'error' }] }],
    })
    expect(result.classification).toBe('review-required')
    expect(result.reasons).toEqual(['identity-change', 'new-compatibility-findings'])
  })

  it('never classifies a catalog type change as automatically safe', () => {
    expect(classifyCatalogUpdate({
      changes: [{ field: 'type', current: 'server', next: 'desktop' }],
      beforeFindings: [],
      afterFindings: [],
    })).toMatchObject({ classification: 'review-required', reasons: ['identity-change'] })
  })

  it('blocks connected port and assignment conflicts', () => {
    expect(classifyCatalogUpdate({
      changes: [{ field: 'ports' }],
      dependencyConflicts: [{ assignmentId: 1 }],
      validationError: { code: 'connected-port-change' },
      beforeFindings: [],
      afterFindings: [],
    }).classification).toBe('blocked')
  })

  it('requires review for NAS fixed, replaceable, and power topology changes', () => {
    for (const changes of [
      [{ field: 'fixedComponents', current: [], next: [{ id: 1 }] }],
      [{ field: 'compatibility', current: { host: { memory: { slots: 1 } } }, next: { host: { memory: { slots: 0 } } } }],
      [{ field: 'compatibility', current: { host: { memory: { oemMaxCapacityMib: 6_144 } } }, next: { host: { memory: { oemMaxCapacityMib: 8_192 } } } }],
      [{ field: 'compatibility', current: { host: { power: { configuration: 'external-adapter', adapterDisposition: 'replaceable' } } }, next: { host: { power: { configuration: 'external-adapter', adapterDisposition: 'fixed' } } } }],
    ]) {
      expect(classifyCatalogUpdate({
        itemType: 'nas',
        changes,
        beforeFindings: [],
        afterFindings: [],
      })).toMatchObject({ classification: 'review-required', reasons: ['material-topology-change'] })
    }
  })

  it('keeps non-material NAS metadata repairs eligible for safe updates', () => {
    expect(classifyCatalogUpdate({
      itemType: 'nas',
      changes: [{ field: 'specs', current: { releaseDate: '2020-01-01' }, next: { releaseDate: '2020-01-02' } }],
      beforeFindings: [],
      afterFindings: [],
    })).toEqual({ classification: 'safe', reasons: ['verified-compatible'], introducedFindings: [] })
  })

  it('does not turn missing compatibility evidence into a confirmed conflict', () => {
    expect(classifyCatalogUpdate({
      changes: [{ field: 'compatibility' }],
      beforeFindings: [],
      afterFindings: [{
        assignmentId: 1,
        findings: [{ code: 'cpu.socket.missing', severity: 'unknown', field: 'component.cpu.socket' }],
      }],
    })).toEqual({ classification: 'safe', reasons: ['verified-compatible'], introducedFindings: [] })
  })
})
