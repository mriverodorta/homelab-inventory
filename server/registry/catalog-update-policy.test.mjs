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
})
