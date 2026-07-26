import { describe, expect, it } from 'vitest'
import { migrateSchema13To14 } from '../../server/db/migrate-schema-14.mjs'
import {
  assertOnboardingState,
  createOnboardingState,
  deriveOnboardingMilestones,
  workspaceIsEmpty,
} from '../../server/onboarding/model.mjs'

const emptyInventory = {
  servers: [], pcBuilds: [], cpus: [], ram: [], storage: [], networkCards: [], gpus: [],
  motherboards: [], cpuCoolers: [], cases: [], powerSupplies: [], soundCards: [], wirelessCards: [],
  powerAdapters: [], nas: [], switches: [], patchPanels: [], monitors: [], upsSystems: [], powerStrips: [],
}

const emptyProject = {
  placements: [],
  assignments: [],
  connections: [],
}

describe('onboarding persisted model', () => {
  it('migrates an empty workspace to available', () => {
    expect(migrateSchema13To14({
      inventory: emptyInventory,
      project: emptyProject,
      agents: { enrollments: {}, devices: {} },
    })).toEqual(createOnboardingState('available'))
  })

  it('migrates any existing workspace data to dismissed', () => {
    expect(migrateSchema13To14({
      inventory: { ...emptyInventory, servers: [{ id: 1, name: 'Existing server' }] },
      project: emptyProject,
      agents: { enrollments: {}, devices: {} },
    }).status).toBe('dismissed')

    expect(migrateSchema13To14({
      inventory: emptyInventory,
      project: { ...emptyProject, placements: [{ itemType: 'server', itemId: 1, x: 0, y: 0 }] },
      agents: { enrollments: {}, devices: {} },
    }).status).toBe('dismissed')
  })

  it('treats agent enrollment as an existing workspace', () => {
    expect(workspaceIsEmpty(
      emptyInventory,
      emptyProject,
      { enrollments: { 1: { id: 1 } }, devices: {} },
    )).toBe(false)
  })

  it('rejects invalid or duplicate relational references', () => {
    const active = {
      ...createOnboardingState('sample_active'),
      sampleBatchId: 1,
      sampleInventoryRefs: [
        { type: 'server', id: 1 },
        { type: 'server', id: 1 },
      ],
    }

    expect(() => assertOnboardingState(active)).toThrow(/duplicate sample inventory reference/i)
    expect(() => assertOnboardingState({ ...active, sampleInventoryRefs: [{ type: 'server', id: 0 }] }))
      .toThrow(/positive safe integer/i)
  })

  it('derives checklist progress from canonical project state', () => {
    expect(deriveOnboardingMilestones({
      items: { 'server:1': { id: 1, type: 'server', name: 'Host' } },
      placements: [{ serverId: 'server:1', x: 0, y: 0 }],
      assignments: [{ id: 1, serverId: 'server:1', itemId: 'cpu:1', type: 'cpu' }],
      connections: [],
    })).toEqual({ created: true, placed: true, related: true, completed: true })
  })
})
