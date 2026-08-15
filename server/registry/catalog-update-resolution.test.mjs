import { describe, expect, it } from 'vitest'
import { applyCatalogResolutionPlan, buildCatalogResolutionPlan } from './catalog-update-resolution.mjs'

function project(overrides = {}) {
  return {
    items: {
      'nas:1': { id: 1, type: 'nas', name: 'NAS' },
      'powerAdapter:22': { id: 22, type: 'powerAdapter', name: 'OEM adapter' },
      'switch:1': { id: 1, type: 'switch', name: 'Switch' },
    },
    assignments: [],
    connections: [],
    placements: [],
    ...overrides,
  }
}

const link = { id: 47, itemType: 'nas', itemId: 1 }

describe('catalog topology update resolution', () => {
  it('moves an external adapter cable to the fixed host endpoint and releases the adapter', () => {
    const current = {
      type: 'nas', specs: { powerConfiguration: 'external-adapter' },
      compatibility: { host: { power: { configuration: 'external-adapter', adapterDisposition: 'replaceable' } } },
      ports: [],
    }
    const next = {
      type: 'nas', specs: { powerConfiguration: 'external-adapter' },
      compatibility: { host: { power: { configuration: 'external-adapter', adapterDisposition: 'fixed' } } },
      ports: [{ id: 1, key: 'ac-input', type: 'ac-input', kind: 'power-port', slotNumber: 1 }],
    }
    const input = project({
      assignments: [{ id: 95, serverId: 'nas:1', itemId: 'powerAdapter:22', type: 'powerAdapter' }],
      connections: [{
        id: 65,
        type: 'power',
        from: { itemId: 'switch:1', portId: 1 },
        to: { itemId: 'nas:1', hostedItemId: 'powerAdapter:22', portId: 1 },
      }],
    })

    const plan = buildCatalogResolutionPlan({ current, next, project: input, link })

    expect(plan).toMatchObject({
      available: true,
      affectedRelationships: { connectionIds: [65], assignmentIds: [95] },
      operations: expect.arrayContaining([
        expect.objectContaining({ kind: 'move-connection-endpoint', connectionId: 65, endpointRole: 'to', to: { itemType: 'nas', itemId: 1, portId: 1 } }),
        expect.objectContaining({ kind: 'unassign-item', assignmentId: 95, returnToInventory: true }),
      ]),
    })
    const resolved = applyCatalogResolutionPlan(input, plan)
    expect(resolved.assignments).toEqual([])
    expect(resolved.connections[0]).toMatchObject({
      from: { itemId: 'switch:1', portId: 1 },
      to: { itemId: 'nas:1', portId: 1 },
    })
    expect(input.assignments).toHaveLength(1)
  })

  it('preserves connected ports when only representation changes', () => {
    const current = { type: 'nas', ports: [{ id: 1, key: 'lan-1', kind: 'server-port', type: 'rj45', slotNumber: 2, speed: '2500M' }] }
    const next = { type: 'nas', ports: [{ id: 1, key: 'lan-1', kind: 'network', type: 'rj45', slotNumber: 1, speed: '2.5G' }] }
    const input = project({ connections: [{ id: 7, from: { itemId: 'nas:1', portId: 1 }, to: { itemId: 'switch:1', portId: 1 } }] })

    expect(buildCatalogResolutionPlan({ current, next, project: input, link })).toMatchObject({
      available: false,
      operations: [],
      reason: 'No relationship migration is required.',
    })
  })

  it('remaps a connected port by unique semantic key when its numeric definition changes', () => {
    const current = { type: 'nas', ports: [{ id: 7, key: 'uplink', kind: 'network', type: 'rj45', slotNumber: 1 }] }
    const next = { type: 'nas', ports: [{ id: 2, key: 'uplink', kind: 'network', type: 'rj45', slotNumber: 1 }] }
    const input = project({ connections: [{ id: 8, from: { itemId: 'nas:1', portId: 7 }, to: { itemId: 'switch:1', portId: 1 } }] })

    expect(buildCatalogResolutionPlan({ current, next, project: input, link })).toMatchObject({
      available: true,
      operations: [expect.objectContaining({ kind: 'move-connection-endpoint', from: { itemType: 'nas', itemId: 1, portId: 7 }, to: { itemType: 'nas', itemId: 1, portId: 2 } })],
    })
  })

  it('refuses an ambiguous semantic-key remap', () => {
    const current = { type: 'nas', ports: [{ id: 7, key: 'uplink', kind: 'network', type: 'rj45', slotNumber: 1 }] }
    const next = { type: 'nas', ports: [
      { id: 2, key: 'uplink', kind: 'network', type: 'rj45', slotNumber: 1 },
      { id: 3, key: 'uplink', kind: 'network', type: 'rj45', slotNumber: 2 },
    ] }
    const input = project({ connections: [{ id: 8, from: { itemId: 'nas:1', portId: 7 }, to: { itemId: 'switch:1', portId: 1 } }] })

    expect(buildCatalogResolutionPlan({ current, next, project: input, link })).toMatchObject({
      available: false,
      operations: [],
      reason: 'Connected port 7 has no unique target in the Registry definition.',
    })
  })

  it('returns a fixed matching component to inventory while preserving unrelated assignments', () => {
    const current = { type: 'nas', fixedComponents: [] }
    const next = { type: 'nas', fixedComponents: [{
      id: 1,
      componentType: 'ram',
      disposition: 'soldered',
      label: 'Memory',
      item: { type: 'ram', manufacturer: 'Example', model: 'MEM-4G' },
    }] }
    const input = project({
      items: {
        ...project().items,
        'ram:4': { id: 4, type: 'ram', manufacturer: 'Example', model: 'MEM-4G' },
        'storage:3': { id: 3, type: 'storage', model: 'SSD' },
      },
      assignments: [
        { id: 10, serverId: 'nas:1', itemId: 'ram:4', type: 'ram' },
        { id: 11, serverId: 'nas:1', itemId: 'storage:3', type: 'storage' },
      ],
    })
    const plan = buildCatalogResolutionPlan({ current, next, project: input, link })
    const resolved = applyCatalogResolutionPlan(input, plan)

    expect(plan.affectedRelationships.assignmentIds).toEqual([10])
    expect(resolved.assignments).toEqual([input.assignments[1]])
  })

  it('does not partially mutate a project when an operation is stale', () => {
    const input = project({
      assignments: [{ id: 95, serverId: 'nas:1', itemId: 'powerAdapter:22', type: 'powerAdapter' }],
      connections: [{ id: 65, from: { itemId: 'switch:1', portId: 1 }, to: { itemId: 'nas:1', hostedItemId: 'powerAdapter:22', portId: 1 } }],
    })
    const before = structuredClone(input)
    const stalePlan = {
      available: true,
      operations: [
        { kind: 'unassign-item', assignmentId: 95, returnToInventory: true },
        { kind: 'move-connection-endpoint', connectionId: 404, endpointRole: 'to', from: { itemType: 'nas', itemId: 1, portId: 1 }, to: { itemType: 'nas', itemId: 1, portId: 2 } },
      ],
    }

    expect(() => applyCatalogResolutionPlan(input, stalePlan)).toThrow('Connection 404 endpoint does not exist.')
    expect(input).toEqual(before)
  })
})
