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

  it('preserves assigned storage when a stable numeric resource ID receives a new semantic key', () => {
    const current = {
      type: 'nas',
      compatibility: { host: { storageSlots: [{ id: 1, key: 'drive-bays', count: 6 }] } },
    }
    const next = {
      type: 'nas',
      compatibility: { host: { storageSlots: [{ id: 1, key: 'sata-bays', count: 6 }] } },
    }
    const assignments = Array.from({ length: 5 }, (_, index) => ({
      id: 14 + index,
      serverId: 'nas:1',
      itemId: `storage:${index + 1}`,
      type: 'storage',
      allocation: {
        resourceType: 'storage',
        resourceKey: 'drive-bays',
        groupId: 1,
        positions: [index],
      },
    }))
    const input = project({
      items: {
        ...project().items,
        ...Object.fromEntries(assignments.map((assignment, index) => [
          assignment.itemId,
          { id: index + 1, type: 'storage', name: `Disk ${index + 1}` },
        ])),
      },
      assignments,
    })

    const plan = buildCatalogResolutionPlan({ current, next, project: input, link })

    expect(plan.operations).toEqual([
      expect.objectContaining({
        kind: 'remap-resource-key',
        resourceType: 'storage',
        resourceId: 1,
        fromKey: 'drive-bays',
        toKey: 'sata-bays',
        assignmentIds: [14, 15, 16, 17, 18],
      }),
    ])
    expect(plan.operations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'unassign-item' }),
    ]))
    const resolved = applyCatalogResolutionPlan(input, plan)
    expect(resolved.assignments.map((assignment) => ({
      id: assignment.id,
      resourceKey: assignment.allocation.resourceKey,
      groupId: assignment.allocation.groupId,
      positions: assignment.allocation.positions,
    }))).toEqual(assignments.map((assignment) => ({
      id: assignment.id,
      resourceKey: 'sata-bays',
      groupId: 1,
      positions: assignment.allocation.positions,
    })))
  })

  it('refuses a stable resource rename when occupied positions exceed the proposed count', () => {
    const current = {
      type: 'nas',
      compatibility: { host: { storageSlots: [{ id: 1, key: 'drive-bays', count: 6 }] } },
    }
    const next = {
      type: 'nas',
      compatibility: { host: { storageSlots: [{ id: 1, key: 'sata-bays', count: 4 }] } },
    }
    const input = project({
      items: { ...project().items, 'storage:1': { id: 1, type: 'storage', name: 'Disk' } },
      assignments: [{
        id: 18,
        serverId: 'nas:1',
        itemId: 'storage:1',
        type: 'storage',
        allocation: { resourceType: 'storage', resourceKey: 'drive-bays', groupId: 1, positions: [4] },
      }],
    })

    expect(buildCatalogResolutionPlan({ current, next, project: input, link })).toMatchObject({
      available: false,
      operations: [],
      reason: 'Assigned resource storage:1 uses position 5, but the proposed resource has 4 slots.',
    })
  })

  it('migrates a legacy M.2 A/E WLAN assignment to the canonical optional module resource', () => {
    const current = {
      type: 'desktop',
      compatibility: { host: { expansionSlots: [
        { id: 7, key: 'm2-ae-slot', count: 1, label: 'M.2 2230 A/E WLAN slot' },
      ] } },
    }
    const next = {
      type: 'desktop',
      compatibility: { host: { optionalModuleSlots: [
        { id: 3, key: 'wlan-m2', count: 1, acceptedModuleKinds: ['wireless-card'] },
      ] } },
    }
    const input = project({
      items: { ...project().items, 'network:9': { id: 9, type: 'network', name: 'WLAN' } },
      assignments: [{
        id: 44,
        serverId: 'nas:1',
        itemId: 'network:9',
        type: 'network',
        allocation: { resourceType: 'expansion', resourceKey: 'm2-ae-slot', groupId: 7, positions: [0] },
      }],
    })

    const plan = buildCatalogResolutionPlan({ current, next, project: input, link })

    expect(plan).toMatchObject({
      available: true,
      affectedRelationships: { assignmentIds: [44] },
      operations: [{
        kind: 'reclassify-resource',
        from: { resourceType: 'expansion', resourceId: 7, key: 'm2-ae-slot' },
        to: { resourceType: 'optionalModule', resourceId: 7, key: 'wlan-m2' },
        assignmentIds: [44],
      }],
    })
    expect(applyCatalogResolutionPlan(input, plan).assignments[0]).toMatchObject({
      id: 44,
      itemId: 'network:9',
      allocation: { resourceType: 'optionalModule', resourceKey: 'wlan-m2', groupId: 7, positions: [0] },
    })
  })

  it('plans an unassigned WLAN resource reclassification as a semantic operation', () => {
    const current = {
      type: 'desktop',
      compatibility: { host: { expansionSlots: [
        { id: 7, key: 'm2-ae-slot', count: 1, label: 'M.2 2230 A/E WLAN slot' },
      ] } },
    }
    const next = {
      type: 'desktop',
      compatibility: { host: { optionalModuleSlots: [
        { id: 7, key: 'wlan-m2', count: 1, label: 'M.2 2230 WLAN slot', acceptedModuleKinds: ['wireless-card'] },
      ] } },
    }

    const plan = buildCatalogResolutionPlan({ current, next, project: project(), link })

    expect(plan).toMatchObject({
      available: true,
      affectedRelationships: { assignmentIds: [] },
      operations: [{
        kind: 'reclassify-resource',
        from: { resourceType: 'expansion', resourceId: 7, key: 'm2-ae-slot' },
        to: { resourceType: 'optionalModule', resourceId: 7, key: 'wlan-m2' },
        assignmentIds: [],
      }],
    })
    expect(applyCatalogResolutionPlan(project(), plan)).toEqual(project())
  })

  it.each([
    ['zero', []],
    ['multiple', [
      { id: 3, key: 'wlan-m2', count: 1, acceptedModuleKinds: ['wireless-card'] },
      { id: 4, key: 'wlan-m2', count: 1, acceptedModuleKinds: ['wireless-card'] },
    ]],
  ])('blocks a legacy WLAN assignment with %s canonical destinations', (_label, destinations) => {
    const current = {
      type: 'desktop',
      compatibility: { host: { expansionSlots: [{ id: 7, key: 'm2-ae-slot', count: 1 }] } },
    }
    const next = {
      type: 'desktop',
      compatibility: { host: { expansionSlots: [], optionalModuleSlots: destinations } },
    }
    const input = project({
      assignments: [{
        id: 44,
        serverId: 'nas:1',
        itemId: 'network:9',
        type: 'network',
        allocation: { resourceType: 'expansion', resourceKey: 'm2-ae-slot', groupId: 7, positions: [0] },
      }],
    })

    expect(buildCatalogResolutionPlan({ current, next, project: input, link })).toMatchObject({
      available: false,
      operations: [],
      reason: expect.stringContaining('optionalModuleSlots.m2-ae-slot'),
    })
  })

  it('blocks an ambiguous WLAN reclassification even when the resource is unassigned', () => {
    const current = {
      type: 'desktop',
      compatibility: { host: { expansionSlots: [{ id: 7, key: 'm2-ae-slot', count: 1 }] } },
    }
    const next = {
      type: 'desktop',
      compatibility: { host: { optionalModuleSlots: [
        { id: 3, key: 'wlan-m2', count: 1, acceptedModuleKinds: ['wireless-card'] },
        { id: 4, key: 'wlan-m2', count: 1, acceptedModuleKinds: ['wireless-card'] },
      ] } },
    }

    expect(buildCatalogResolutionPlan({ current, next, project: project(), link })).toMatchObject({
      available: false,
      operations: [],
      reason: expect.stringContaining('found 2'),
    })
  })

  it('distinguishes overlapping numeric IDs in different resource types', () => {
    const current = {
      type: 'nas',
      compatibility: { host: {
        storageSlots: [{ id: 1, key: 'drive-bays', count: 2 }],
        expansionSlots: [{ id: 1, key: 'pcie-slot', count: 1 }],
      } },
    }
    const next = {
      type: 'nas',
      compatibility: { host: {
        storageSlots: [{ id: 1, key: 'sata-bays', count: 2 }],
        expansionSlots: [{ id: 1, key: 'pcie-slot', count: 1 }],
      } },
    }
    const input = project({
      items: {
        ...project().items,
        'storage:1': { id: 1, type: 'storage', name: 'Disk' },
        'network:1': { id: 1, type: 'network', name: 'NIC' },
      },
      assignments: [
        { id: 1, serverId: 'nas:1', itemId: 'storage:1', type: 'storage', allocation: { resourceType: 'storage', resourceKey: 'drive-bays', groupId: 1, positions: [0] } },
        { id: 2, serverId: 'nas:1', itemId: 'network:1', type: 'network', allocation: { resourceType: 'expansion', resourceKey: 'pcie-slot', groupId: 1, positions: [0] } },
      ],
    })

    expect(buildCatalogResolutionPlan({ current, next, project: input, link }).operations).toEqual([
      expect.objectContaining({ kind: 'remap-resource-key', resourceType: 'storage', assignmentIds: [1] }),
    ])
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
