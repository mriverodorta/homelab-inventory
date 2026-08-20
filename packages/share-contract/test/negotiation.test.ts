import { describe, expect, it } from 'vitest'

import { negotiateShareCapabilities } from '../src'

const serverV1 = {
  contractVersion: 1,
  views: { systems: 1, canvas: 1 },
  features: ['deep-links', 'inspector'],
}

describe('share capability negotiation', () => {
  it('accepts the exact supported contract', () => {
    expect(negotiateShareCapabilities(serverV1, serverV1)).toEqual({ ok: true })
  })

  it('rejects unsupported views', () => {
    expect(negotiateShareCapabilities({
      ...serverV1,
      views: { ...serverV1.views, rack: 1 },
    }, serverV1)).toEqual({
      ok: false,
      code: 'unsupported-view',
      viewType: 'rack',
    })
  })

  it('rejects unsupported contract and view versions', () => {
    expect(negotiateShareCapabilities({ ...serverV1, contractVersion: 2 }, serverV1))
      .toMatchObject({ ok: false, code: 'unsupported-contract' })
    expect(negotiateShareCapabilities({
      ...serverV1,
      views: { ...serverV1.views, canvas: 2 },
    }, serverV1)).toMatchObject({
      ok: false,
      code: 'unsupported-view-version',
      viewType: 'canvas',
    })
  })

  it('rejects unsupported renderer features', () => {
    expect(negotiateShareCapabilities({
      ...serverV1,
      features: [...serverV1.features, 'resource-snapshot'],
    }, serverV1)).toEqual({
      ok: false,
      code: 'unsupported-feature',
      feature: 'resource-snapshot',
    })
  })
})
