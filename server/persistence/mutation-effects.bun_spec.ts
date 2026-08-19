import { describe, expect, test } from 'bun:test'
import type { InventoryItem, ProjectState } from '../../src/types/inventory.ts'
import {
  classifyInventoryMutation,
  compatibilityMutationEffects,
  metadataMutationEffects,
  projectEngineTopologyEqual,
  workbookMutationEffects,
} from './mutation-effects.ts'

function item(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 1,
    type: 'server',
    name: 'Host',
    ports: [{ id: 1, kind: 'network', type: 'rj45', slotNumber: 1 }],
    ...overrides,
  } as InventoryItem
}

function project(current: InventoryItem): ProjectState {
  return {
    id: 'default',
    revision: 7,
    metadata: { name: 'Lab', projectId: 1, workspaceId: 2, schemaVersion: 29 },
    items: { [`${current.type}:${current.id}`]: current },
    assignments: [],
    placements: [{ serverId: `${current.type}:${current.id}`, x: 0, y: 0 }],
    connections: [],
    compatibilityPolicy: { disabledHosts: [], ignoredWarningIds: [] },
  } as ProjectState
}

const context = { projectIds: [1], workspaceIds: [2], connectionIds: [9] }

describe('persistence mutation effects', () => {
  test('excludes project presentation from engine topology equality', () => {
    const current = project(item())
    expect(projectEngineTopologyEqual(current, {
      ...current,
      revision: 99,
      metadata: { ...current.metadata, name: 'Renamed' },
    })).toBe(true)
  })

  test('keeps display names outside topology and geometry', () => {
    const before = item({ properties: { displayName: 'Before' } })
    const after = item({ properties: { displayName: 'After' } })
    expect(classifyInventoryMutation(project(before), project(after), before, after, context)).toEqual({
      topology: false,
      geometry: null,
      compatibility: { projectIds: [1], hostRefs: [{ type: 'server', id: 1 }] },
      presentation: { projectIds: [1], itemRefs: [{ type: 'server', id: 1 }] },
    })
  })

  test('classifies orientation and endpoint row order as geometry-only inventory changes', () => {
    for (const [type, property, beforeValue, afterValue] of [
      ['ups', 'canvasOrientation', 'horizontal', 'vertical'],
      ['ups', 'upsOutletGroupOrder', 'battery-surge', 'surge-battery'],
      ['patchPanel', 'patchPanelRowOrder', 'back-front', 'front-back'],
    ] as const) {
      const before = item({ type, properties: { [property]: beforeValue } } as Partial<InventoryItem>)
      const after = item({ type, properties: { [property]: afterValue } } as Partial<InventoryItem>)
      const effects = classifyInventoryMutation(project(before), project(after), before, after, context)
      expect(effects.topology).toBe(false)
      expect(effects.geometry).toEqual({
        projectIds: [1],
        workspaceIds: [2],
        itemRefs: [{ type, id: 1 }],
        connectionIds: [9],
      })
    }
  })

  test('classifies port changes as topology, geometry, compatibility, and presentation', () => {
    const before = item()
    const after = item({
      ports: [
        { id: 1, kind: 'network', type: 'rj45', slotNumber: 1 },
        { id: 2, kind: 'network', type: 'rj45', slotNumber: 2 },
      ],
    })
    const effects = classifyInventoryMutation(project(before), project(after), before, after, context)
    expect(effects.topology).toBe(true)
    expect(effects.geometry?.itemRefs).toEqual([{ type: 'server', id: 1 }])
    expect(effects.compatibility?.projectIds).toEqual([1])
    expect(effects.presentation?.itemRefs).toEqual([{ type: 'server', id: 1 }])
  })

  test('builds topology-free metadata, compatibility, and workbook effects', () => {
    expect(metadataMutationEffects([2, 1, 2]).topology).toBe(false)
    expect(metadataMutationEffects([2, 1, 2]).presentation?.projectIds).toEqual([1, 2])
    expect(compatibilityMutationEffects(1, [{ type: 'nas', id: 3 }])).toMatchObject({
      topology: false,
      compatibility: { projectIds: [1], hostRefs: [{ type: 'nas', id: 3 }] },
    })
    expect(workbookMutationEffects(1)).toMatchObject({
      topology: false,
      presentation: { projectIds: [1] },
    })
  })
})
