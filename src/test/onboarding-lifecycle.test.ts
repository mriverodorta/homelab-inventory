import { describe, expect, it } from 'vitest'
import { assertInventoryStoreShape, assertProjectStoreShape } from '../../server/db/validation.mjs'
import { EXAMPLE_WORKSPACE_TEMPLATE } from '../../server/onboarding/example-workspace.mjs'
import {
  finishExampleInDraft,
  loadExampleIntoDraft,
  onboardingNeedsReconciliation,
  reconcileOnboardingDraft,
  sampleRemovalImpact,
} from '../../server/onboarding/lifecycle.mjs'
import { createOnboardingState } from '../../server/onboarding/model.mjs'
import {
  getCanvasItemHeight,
  getCanvasItemWidth,
} from '@/lib/project'
import type { ProjectState } from '@/types/inventory'

const tables = [
  'servers', 'pcBuilds', 'cpus', 'ram', 'storage', 'networkCards', 'gpus', 'motherboards',
  'cpuCoolers', 'cases', 'powerSupplies', 'soundCards', 'wirelessCards', 'powerAdapters',
  'nas', 'switches', 'patchPanels', 'monitors', 'upsSystems', 'powerStrips',
]

function emptyDraft(): any {
  return {
    meta: { onboarding: createOnboardingState('available') },
    inventory: Object.fromEntries(tables.map((table) => [table, []])),
    project: {
      id: 'default', revision: 1,
      metadata: { name: 'Test', version: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
      placements: [], assignments: [], connections: [],
      compatibilityPolicy: { disabledHosts: [], ignoredWarningIds: [] },
    },
    agents: { enrollments: {}, devices: {} },
    agentStatus: { servers: {} },
  }
}

describe('example workspace lifecycle', () => {
  it('ships only the approved fictional shape', () => {
    expect(EXAMPLE_WORKSPACE_TEMPLATE.inventory).toHaveLength(9)
    expect(EXAMPLE_WORKSPACE_TEMPLATE.assignments).toHaveLength(4)
    expect(EXAMPLE_WORKSPACE_TEMPLATE.placements).toHaveLength(5)
    expect(EXAMPLE_WORKSPACE_TEMPLATE.connections).toHaveLength(4)
    expect(JSON.stringify(EXAMPLE_WORKSPACE_TEMPLATE)).not.toMatch(/ipAddress|macAddress|serial|token/i)
  })

  it('ships a readable sample layout with clear space between every canvas item', () => {
    const items = Object.fromEntries(EXAMPLE_WORKSPACE_TEMPLATE.inventory.map((item) => [
      `${item.type}:${item.id}`,
      { ...item, key: `${item.type}:${item.id}` },
    ]))
    const project = {
      id: 'default',
      revision: 1,
      metadata: { name: 'Example', version: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
      items,
      placements: EXAMPLE_WORKSPACE_TEMPLATE.placements.map((placement) => ({
        serverId: `${placement.itemType}:${placement.itemId}`,
        x: placement.x,
        y: placement.y,
      })),
      assignments: EXAMPLE_WORKSPACE_TEMPLATE.assignments.map((assignment) => ({
        ...assignment,
        serverId: `${assignment.hostType}:${assignment.hostId}`,
        itemId: `${assignment.itemType}:${assignment.itemId}`,
      })),
      connections: [],
      compatibilityPolicy: { disabledHosts: [], ignoredWarningIds: [] },
    } as ProjectState
    const rectangles = project.placements.map((placement) => ({
      id: placement.serverId,
      left: placement.x,
      top: placement.y,
      right: placement.x + getCanvasItemWidth(project, placement.serverId),
      bottom: placement.y + getCanvasItemHeight(project, placement.serverId),
    }))

    for (const [index, rectangle] of rectangles.entries()) {
      for (const candidate of rectangles.slice(index + 1)) {
        const separated = rectangle.right + 48 <= candidate.left
          || candidate.right + 48 <= rectangle.left
          || rectangle.bottom + 48 <= candidate.top
          || candidate.bottom + 48 <= rectangle.top
        expect(separated, `${rectangle.id} overlaps or crowds ${candidate.id}`).toBe(true)
      }
    }
  })

  it('loads a valid sample manifest with fresh ids once', () => {
    const draft = emptyDraft()
    draft.inventory.servers.push({ id: 7, name: 'Removed before import' })
    draft.inventory.servers = []

    expect(loadExampleIntoDraft(draft, '2026-07-25T00:00:00.000Z')).toBe(true)
    expect(loadExampleIntoDraft(draft, '2026-07-25T00:00:01.000Z')).toBe(false)
    expect(draft.meta.onboarding.sampleInventoryRefs).toHaveLength(9)
    expect(draft.project.assignments).toHaveLength(4)
    expect(draft.project.connections).toHaveLength(4)
    expect(draft.project.placements).toHaveLength(5)
    expect(() => assertInventoryStoreShape(draft.inventory)).not.toThrow()
    expect(() => assertProjectStoreShape(draft.project, { requireRevision: true })).not.toThrow()
  })

  it('reports and removes cross-boundary relationships without deleting user inventory', () => {
    const draft = emptyDraft()
    loadExampleIntoDraft(draft)
    draft.inventory.servers.push({ id: 2, name: 'User server', ports: [] })
    draft.project.connections.push({
      id: 5,
      from: { itemType: 'server', itemId: 2, portId: 1 },
      to: { itemType: 'switch', itemId: 1, portId: 2 },
      type: 'network',
      createdAt: '2026-07-25T00:00:00.000Z',
    })

    expect(sampleRemovalImpact(draft).additionalRelationships).toBe(1)
    finishExampleInDraft(draft, 'remove')

    expect(draft.inventory.servers).toEqual([{ id: 2, name: 'User server', ports: [] }])
    expect(draft.project.connections).toEqual([])
    expect(draft.meta.onboarding.status).toBe('checklist_active')
  })

  it('keeps sample records while clearing ownership metadata', () => {
    const draft = emptyDraft()
    loadExampleIntoDraft(draft)
    finishExampleInDraft(draft, 'keep', '2026-07-25T00:00:00.000Z')

    expect(draft.inventory.servers).toHaveLength(1)
    expect(draft.meta.onboarding).toMatchObject({
      status: 'completed',
      sampleBatchId: null,
      sampleInventoryRefs: [],
    })
  })

  it('reconciles an interrupted sample without adopting user records', () => {
    const draft = emptyDraft()
    loadExampleIntoDraft(draft)
    draft.inventory.servers = []

    expect(onboardingNeedsReconciliation(draft)).toBe(true)
    reconcileOnboardingDraft(draft)

    expect(draft.meta.onboarding.sampleInventoryRefs).not.toContainEqual({ type: 'server', id: 1 })
    expect(draft.project.assignments).toEqual([])
    expect(draft.project.connections.some((connection: any) =>
      connection.from.itemType === 'server' || connection.to.itemType === 'server',
    )).toBe(false)
  })
})
