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

  it('keeps network capability and speed enrichment eligible for automatic updates', () => {
    expect(classifyCatalogUpdate({
      itemType: 'network',
      changes: [
        { path: 'ports[1].speedBps', impact: 'capability', current: 1_000_000_000, next: 10_000_000_000 },
        { path: 'specs.capabilities.ptp', impact: 'product-definition', current: undefined, next: true },
      ],
      beforeFindings: [],
      afterFindings: [],
    })).toEqual({ classification: 'safe', reasons: ['verified-compatible'], introducedFindings: [] })
  })

  it('requires review for network attachment, host-interface, and radio changes', () => {
    for (const changes of [
      [{ path: 'ports[1].type', impact: 'attachment', current: 'sfp-plus', next: 'sfp28' }],
      [{ path: 'specs.hostInterface.family', impact: 'product-definition', current: 'pcie', next: 'ocp' }],
      [{ path: 'specs.frequencyBandsGhz', impact: 'product-definition', current: [2.4], next: [2.4, 5] }],
    ]) {
      expect(classifyCatalogUpdate({
        itemType: 'network',
        changes,
        beforeFindings: [],
        afterFindings: [],
      })).toMatchObject({ classification: 'review-required' })
    }
  })

  it('treats lowering or omitting an electrical minimum as a safe relaxation', () => {
    for (const next of [4, undefined]) {
      expect(classifyCatalogUpdate({
        itemType: 'network',
        changes: [
          { path: 'specs.hostInterface.minimumElectricalLanes', impact: 'product-definition', current: 8, next },
          { path: 'compatibility.requirements.expansion.minimumElectricalLanes', impact: 'product-definition', current: 8, next },
        ],
        beforeFindings: [{
          assignmentId: 1,
          findings: [{ code: 'expansion.minimum-lanes.insufficient', severity: 'error' }],
        }],
        afterFindings: [],
      })).toEqual({ classification: 'safe', reasons: ['verified-compatible'], introducedFindings: [] })
    }
  })

  it('still requires review when an electrical minimum is added or increased', () => {
    for (const [current, next] of [[undefined, 4], [4, 8]]) {
      expect(classifyCatalogUpdate({
        itemType: 'network',
        changes: [{
          path: 'specs.hostInterface.minimumElectricalLanes',
          impact: 'product-definition',
          current,
          next,
        }],
        beforeFindings: [],
        afterFindings: [],
      })).toMatchObject({ classification: 'review-required', reasons: ['network-host-interface-change'] })
    }
  })
})
