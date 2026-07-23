import { describe, expect, it } from 'vitest'

import { withCanonicalPowerPorts } from '../../shared/power-ports.mjs'
import {
  applyNasPowerConfigurationChange,
  inspectNasPowerConfigurationChange,
} from './nas-power-configuration.mjs'

const CREATED_AT = '2026-07-22T12:00:00.000Z'

function persisted(item) {
  const normalized = withCanonicalPowerPorts(item)
  delete normalized.type
  delete normalized.key
  return normalized
}

function context(mode = 'external-adapter') {
  return {
    inventory: {
      nas: [persisted({
        id: 1,
        type: 'nas',
        name: 'NAS',
        specs: { powerConfiguration: mode },
        ports: [{ id: 1, kind: 'server-port', type: 'rj45', slotNumber: 1 }],
      })],
      powerAdapters: [persisted({ id: 1, type: 'powerAdapter', name: 'OEM adapter' })],
    },
    project: {
      assignments: mode === 'external-adapter' ? [{
        id: 1,
        hostType: 'nas',
        hostId: 1,
        itemType: 'powerAdapter',
        itemId: 1,
        type: 'powerAdapter',
        assignedAt: CREATED_AT,
      }] : [],
      connections: mode === 'external-adapter' ? [{
        id: 1,
        from: { itemType: 'ups', itemId: 1, portId: 1 },
        to: {
          itemType: 'nas', itemId: 1, hostedItemType: 'powerAdapter', hostedItemId: 1, portId: 1,
        },
        type: 'power',
        label: 'Rack power',
        createdAt: CREATED_AT,
      }] : [{
        id: 1,
        from: { itemType: 'ups', itemId: 1, portId: 1 },
        to: { itemType: 'nas', itemId: 1, portId: 2 },
        type: 'power',
        createdAt: CREATED_AT,
      }],
    },
  }
}

describe('NAS power configuration transitions', () => {
  it('previews external dependencies without mutating stores', () => {
    const draft = context()
    const original = structuredClone(draft)
    const impact = inspectNasPowerConfigurationChange(
      draft,
      { type: 'nas', id: 1 },
      'internal-psu',
    )

    expect(impact.requiresConfirmation).toBe(true)
    expect(impact.publicImpact.connections).toEqual([{ id: 1, label: 'Rack power' }])
    expect(impact.publicImpact.releasedAdapter).toEqual({
      type: 'powerAdapter', id: 1, name: 'OEM adapter',
    })
    expect(draft).toEqual(original)
  })

  it('atomically releases an external adapter and materializes the NAS input', () => {
    const draft = context()
    applyNasPowerConfigurationChange(draft, { type: 'nas', id: 1 }, 'internal-psu')

    expect(draft.project.connections).toEqual([])
    expect(draft.project.assignments).toEqual([])
    expect(draft.inventory.nas[0].specs.powerConfiguration).toBe('internal-psu')
    expect(draft.inventory.nas[0].ports).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 2, key: 'ac-input', type: 'ac-input' }),
    ]))
  })

  it('removes the direct cable and input when switching to an external adapter', () => {
    const draft = context('internal-psu')
    const impact = inspectNasPowerConfigurationChange(
      draft,
      { type: 'nas', id: 1 },
      'external-adapter',
    )
    expect(impact.requiresConfirmation).toBe(true)

    applyNasPowerConfigurationChange(draft, { type: 'nas', id: 1 }, 'external-adapter')
    expect(draft.project.connections).toEqual([])
    expect(draft.inventory.nas[0].ports).toEqual([
      { id: 1, kind: 'server-port', type: 'rj45', slotNumber: 1 },
    ])
  })

  it('applies dependency-free changes immediately and rejects invalid targets', () => {
    const draft = context('internal-psu')
    draft.project.connections = []
    expect(inspectNasPowerConfigurationChange(
      draft,
      { type: 'nas', id: 1 },
      'external-adapter',
    ).requiresConfirmation).toBe(false)
    expect(() => inspectNasPowerConfigurationChange(
      draft,
      { type: 'nas', id: 1 },
      'invalid',
    )).toThrow('valid NAS power configuration')
  })
})
